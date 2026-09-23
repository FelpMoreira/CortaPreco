import { Queue } from 'bullmq';
import { prisma } from '@cupons/db';
import { config } from './config.js';

export const publishQueue = new Queue('publish', { connection: { url: config.redisUrl } });

/**
 * Cron (a cada minuto): pega posts SCHEDULED e enfileira envio, respeitando
 * teto por hora e por dia (evita disparo em massa / ban).
 */
export async function tickScheduler(): Promise<void> {
  const now = new Date();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [perHour, perDay] = await Promise.all([
    prisma.post.count({ where: { status: 'POSTED', postedAt: { gte: hourAgo } } }),
    prisma.post.count({ where: { status: 'POSTED', postedAt: { gte: dayAgo } } }),
  ]);

  if (perHour >= config.postsPerHour || perDay >= config.postsPerDay) return;

  const pending = await prisma.post.findFirst({
    where: { status: 'SCHEDULED' },
    orderBy: { createdAt: 'asc' },
  });
  if (!pending) return;

  await publishQueue.add('publish', { postId: pending.id }, { attempts: 3, backoff: { type: 'exponential', delay: 5000 } });
  // marca como "em processamento" para não enfileirar de novo no próximo tick
  await prisma.post.update({
    where: { id: pending.id },
    data: { status: 'POSTING' },
  });
}