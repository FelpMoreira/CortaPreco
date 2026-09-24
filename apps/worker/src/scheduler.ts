import { Queue } from 'bullmq';
import { dailyCap, prisma, type Channel } from '@cupons/db';
import { config } from './config.js';

export const publishQueue = new Queue('publish', { connection: { url: config.redisUrl } });

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

/**
 * Intervalo mínimo até o próximo post do canal. Com jitter, varia de forma estável
 * por post (derivada do id do último), para não soar como relógio.
 */
export function minGapMs(channel: Pick<Channel, 'postsPerHour' | 'jitterPct'>, lastPostId: string): number {
  const base = (60 * 60 * 1000) / Math.max(channel.postsPerHour, 1);
  if (!channel.jitterPct) return base;
  // FNV-1a: espalha bem até ids quase iguais (cuids sequenciais)
  let h = 0x811c9dc5;
  for (let i = 0; i < lastPostId.length; i++) h = Math.imul(h ^ lastPostId.charCodeAt(i), 0x01000193) >>> 0;
  const unit = (h % 2001) / 1000 - 1; // -1..1
  return base * (1 + (unit * channel.jitterPct) / 100);
}

const HOUR = 60 * 60 * 1000;

/**
 * Tick (a cada minuto): para cada canal ativo, pega o post agendado mais antigo e
 * enfileira o envio, respeitando o ritmo do canal (por hora, por dia, silêncio, jitter).
 */
export async function tickScheduler(): Promise<void> {
  const now = Date.now();

  // post preso em POSTING (worker caiu no meio) travaria a fila: marca FAILED p/ revisão manual,
  // sem reenviar sozinho — pode ter chegado ao canal
  await prisma.post.updateMany({
    where: { status: 'POSTING', updatedAt: { lt: new Date(now - 15 * 60 * 1000) } },
    data: { status: 'FAILED', lastError: 'Envio interrompido (worker caiu?). Confira o canal antes de reenviar.' },
  });

  const channels = await prisma.channel.findMany({ where: { enabled: true } });
  for (const channel of channels) {
    await tickChannel(channel, now).catch((err) => console.error(`[scheduler] ${channel.name}:`, err));
  }
}

async function tickChannel(channel: Channel, now: number): Promise<void> {
  // madrugada: ninguém quer notificação; o "postar agora" do painel ignora isso de propósito
  if (channel.quietHours && inQuietHours(channel.quietHours, new Date(now))) return;

  const where = { channelId: channel.id };
  const [inFlight, perHour, perDay, last] = await Promise.all([
    prisma.post.count({ where: { ...where, status: 'POSTING' } }),
    prisma.post.count({ where: { ...where, status: 'POSTED', postedAt: { gte: new Date(now - HOUR) } } }),
    prisma.post.count({ where: { ...where, status: 'POSTED', postedAt: { gte: new Date(now - 24 * HOUR) } } }),
    prisma.post.findFirst({
      where: { ...where, status: 'POSTED' },
      orderBy: { postedAt: 'desc' },
      select: { id: true, postedAt: true },
    }),
  ]);

  if (inFlight > 0) return;
  if (perHour >= channel.postsPerHour) return;
  if (perDay >= dailyCap(channel, now)) return;
  if (last?.postedAt && now - last.postedAt.getTime() < minGapMs(channel, last.id)) return;

  const pending = await prisma.post.findFirst({
    where: { ...where, status: 'SCHEDULED' },
    orderBy: { createdAt: 'asc' },
  });
  if (!pending) return;

  // claim atômico: só enfileira quem conseguiu mudar SCHEDULED → POSTING
  const claimed = await prisma.post.updateMany({
    where: { id: pending.id, status: 'SCHEDULED' },
    data: { status: 'POSTING' },
  });
  if (claimed.count === 0) return;

  await publishQueue.add(
    'publish',
    { postId: pending.id },
    {
      // único por tentativa: um job antigo com falha no Redis não pode bloquear o reenvio
      jobId: `${pending.id}-${Date.now()}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
      removeOnFail: 100,
    },
  );
}
