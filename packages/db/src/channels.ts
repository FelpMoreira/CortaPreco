import type { Channel } from '@prisma/client';
import { prisma } from './client.js';

type Env = Record<string, string | undefined>;

export interface ChannelConfig {
  platform: 'TELEGRAM' | 'WHATSAPP';
  name: string;
  target: string;
  postsPerHour: number;
  postsPerDay: number;
  quietHours: string;
  jitterPct: number;
  warmupDays: number;
}

const int = (v: string | undefined, d: number) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : d);

/**
 * Canais a partir do .env. Padrões do WhatsApp são conservadores de propósito:
 * API não oficial, sem limite "seguro" conhecido — ritmo humano reduz o risco de ban.
 */
export function channelsFromEnv(env: Env): ChannelConfig[] {
  const out: ChannelConfig[] = [];
  if (env.TELEGRAM_CHANNEL) {
    out.push({
      platform: 'TELEGRAM',
      name: 'Telegram',
      target: env.TELEGRAM_CHANNEL,
      postsPerHour: int(env.POSTS_PER_HOUR, 3),
      postsPerDay: int(env.POSTS_PER_DAY, 0),
      quietHours: env.QUIET_HOURS ?? '',
      jitterPct: int(env.TELEGRAM_JITTER_PCT, 0),
      warmupDays: 0,
    });
  }
  if (env.WHATSAPP_ENABLED === 'true' && env.WHATSAPP_TARGET) {
    out.push({
      platform: 'WHATSAPP',
      name: 'WhatsApp',
      target: env.WHATSAPP_TARGET,
      postsPerHour: int(env.WHATSAPP_POSTS_PER_HOUR, 2),
      postsPerDay: int(env.WHATSAPP_POSTS_PER_DAY, 15),
      quietHours: env.WHATSAPP_QUIET_HOURS ?? '22-8',
      jitterPct: int(env.WHATSAPP_JITTER_PCT, 35),
      warmupDays: int(env.WHATSAPP_WARMUP_DAYS, 14),
    });
  }
  return out;
}

/**
 * Semeia os canais do .env só quando o banco ainda não tem NENHUM canal. Depois disso, tudo (inclusive
 * o ID do grupo) é gerido pelo painel. Antes semeava "se o ID do .env não existia": quando o grupo virou
 * supergrupo e o ID mudou (2026-09-26), isso recriaria o canal com o ID morto a cada reinício.
 */
export async function syncChannels(env: Env): Promise<Channel[]> {
  const seeds = (await prisma.channel.count()) === 0 ? channelsFromEnv(env) : [];
  for (const c of seeds) {
    const { platform, target, ...limits } = c;
    const exists = await prisma.channel.findUnique({ where: { platform_target: { platform, target } } });
    if (!exists) await prisma.channel.create({ data: { platform, target, ...limits, enabled: true } });
  }
  const active = await prisma.channel.findMany({ where: { enabled: true }, orderBy: { createdAt: 'asc' } });
  // posts de antes dos canais existirem eram todos do primeiro Telegram
  const telegram = active.find((c) => c.platform === 'TELEGRAM');
  if (telegram) await prisma.post.updateMany({ where: { channelId: null }, data: { channelId: telegram.id } });
  return active;
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * Teto diário efetivo (0/ausente = sem teto). Em aquecimento, o volume sobe aos poucos:
 * do 1º dia (mín. 2 posts) até o teto normal ao fim de `warmupDays`.
 */
export function dailyCap(channel: Pick<Channel, 'postsPerDay' | 'postsPerHour' | 'warmupDays' | 'createdAt'>, now = Date.now()): number {
  const base = channel.postsPerDay > 0 ? channel.postsPerDay : Infinity;
  if (channel.warmupDays <= 0) return base;
  const age = Math.floor((now - channel.createdAt.getTime()) / DAY);
  if (age >= channel.warmupDays) return base;
  const target = Number.isFinite(base) ? base : channel.postsPerHour * 15;
  return Math.max(2, Math.ceil((target * (age + 1)) / channel.warmupDays));
}
