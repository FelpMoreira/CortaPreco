import type { Channel } from '@prisma/client';
import { dailyCap } from './channels.js';
import { prisma } from './client.js';

const HOUR = 60 * 60 * 1000;
const brHour = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hourCycle: 'h23' });

/** true dentro da janela de silêncio (ex.: "23-7" = das 23h às 6h59, horário de Brasília). */
export function inQuietHours(spec: string, date = new Date()): boolean {
  const m = spec.trim().match(/^(\d{1,2})\s*-\s*(\d{1,2})$/);
  if (!m) return false;
  const [start, end] = [Number(m[1]) % 24, Number(m[2]) % 24];
  if (start === end) return false;
  const h = Number(brHour.format(date));
  return start < end ? h >= start && h < end : h >= start || h < end;
}

/** Primeiro instante fora da janela de silêncio a partir de `from` (precisão de 1 min). */
export function afterQuietHours(spec: string, from: Date): Date {
  let t = new Date(from);
  for (let i = 0; i < 26 * 60 && inQuietHours(spec, t); i++) t = new Date(t.getTime() + 60_000);
  return t;
}

/**
 * Intervalo mínimo até o próximo post do canal. Com jitter, varia de forma estável
 * por post (derivada do id do último), para não soar como relógio.
 */
export function minGapMs(channel: Pick<Channel, 'postsPerHour' | 'jitterPct'>, lastPostId: string): number {
  const base = HOUR / Math.max(channel.postsPerHour, 1);
  if (!channel.jitterPct) return base;
  // FNV-1a: espalha bem até ids quase iguais (cuids sequenciais)
  let h = 0x811c9dc5;
  for (let i = 0; i < lastPostId.length; i++) h = Math.imul(h ^ lastPostId.charCodeAt(i), 0x01000193) >>> 0;
  const unit = (h % 2001) / 1000 - 1; // -1..1
  return base * (1 + (unit * channel.jitterPct) / 100);
}

/** Folga entre um post da fila e um post do espelhamento com horário reservado. */
const RESERVE_MARGIN_MS = 3 * 60_000;

export type WaitReason = 'ready' | 'empty' | 'sending' | 'gap' | 'hourly' | 'daily' | 'quiet';

export interface ChannelPacing {
  /** Pode enviar o próximo agora (o scheduler age no tick seguinte). */
  ready: boolean;
  /** Quando o próximo post pode sair (null = fila vazia). */
  nextAt: Date | null;
  reason: WaitReason;
  scheduled: number;
  postedLastHour: number;
  postedLast24h: number;
  dailyCap: number | null;
  lastPostId: string | null;
}

/**
 * Situação de ritmo do canal — a MESMA conta que o scheduler usa para decidir o envio
 * e que o painel usa para mostrar "próximo post às…". Uma fonte só de verdade.
 */
export async function channelPacing(channel: Channel, now = Date.now()): Promise<ChannelPacing> {
  const where = { channelId: channel.id };
  const [inFlight, reserved, scheduled, recent] = await Promise.all([
    // enviando de fato: POSTING sem horário reservado ou com o horário já chegado
    prisma.post.count({ where: { ...where, status: 'POSTING', OR: [{ sendAt: null }, { sendAt: { lte: new Date(now) } }] } }),
    // espelhamento esperando a vez (job atrasado): reserva um horário no canal
    prisma.post.findMany({
      where: { ...where, status: 'POSTING', sendAt: { gt: new Date(now) } },
      orderBy: { sendAt: 'asc' },
      select: { sendAt: true },
    }),
    prisma.post.count({ where: { ...where, status: 'SCHEDULED' } }),
    prisma.post.findMany({
      where: { ...where, status: 'POSTED', postedAt: { gte: new Date(now - 24 * HOUR) } },
      orderBy: { postedAt: 'asc' },
      select: { id: true, postedAt: true },
    }),
  ]);
  const cap = dailyCap(channel, now);
  const lastHour = recent.filter((p) => p.postedAt!.getTime() >= now - HOUR);
  const last = recent.at(-1);
  const base = {
    scheduled,
    postedLastHour: lastHour.length,
    postedLast24h: recent.length,
    dailyCap: Number.isFinite(cap) ? cap : null,
    lastPostId: last?.id ?? null,
  };

  if (inFlight > 0) return { ...base, ready: false, nextAt: new Date(now), reason: 'sending' };

  // cada restrição dá um "a partir de quando"; vale a mais tardia
  const limits: [WaitReason, number][] = [];
  if (last) limits.push(['gap', last.postedAt!.getTime() + minGapMs(channel, last.id)]);
  // não encosta num post do espelhamento já reservado: reserva a menos de 3 min → espera ela sair + 3 min
  const nearReserve = reserved.find((r) => r.sendAt!.getTime() - now < RESERVE_MARGIN_MS);
  if (nearReserve) limits.push(['sending', nearReserve.sendAt!.getTime() + RESERVE_MARGIN_MS]);
  if (lastHour.length >= channel.postsPerHour) {
    // libera quando o post que estourou o limite sair da janela de 1h
    limits.push(['hourly', lastHour[lastHour.length - channel.postsPerHour]!.postedAt!.getTime() + HOUR]);
  }
  if (recent.length >= cap) limits.push(['daily', recent[recent.length - cap]!.postedAt!.getTime() + 24 * HOUR]);

  let reason: WaitReason = 'ready';
  let at = now;
  for (const [r, t] of limits) {
    if (t > at) {
      at = t;
      reason = r;
    }
  }
  if (channel.quietHours && inQuietHours(channel.quietHours, new Date(at))) {
    at = afterQuietHours(channel.quietHours, new Date(at)).getTime();
    reason = 'quiet';
  }

  if (scheduled === 0) return { ...base, ready: false, nextAt: null, reason: 'empty' };
  return { ...base, ready: at <= now, nextAt: new Date(at), reason: at <= now ? 'ready' : reason };
}
