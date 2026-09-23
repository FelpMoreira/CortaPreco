import { Queue } from 'bullmq';
import { prisma } from '@cupons/db';
import { config } from './config.js';

export const publishQueue = new Queue('publish', { connection: { url: config.redisUrl } });

/**
 * Cron (a cada minuto): pega o post SCHEDULED mais antigo e enfileira o envio,
 * respeitando teto por hora/dia e um intervalo mínimo entre posts (espalha os
 * envios na hora em vez de disparar em rajada).
 */
export async function tickScheduler(): Promise<void> {
  const now = Date.now();
  const hourAgo = new Date(now - 60 * 60 * 1000);
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000);
  const minGapMs = (60 * 60 * 1000) / Math.max(config.postsPerHour, 1);

  // post preso em POSTING (worker caiu no meio) travaria a fila: marca FAILED p/ revisão manual,
  // sem reenviar sozinho — pode ter chegado ao canal
  await prisma.post.updateMany({
    where: { status: 'POSTING', updatedAt: { lt: new Date(now - 15 * 60 * 1000) } },
    data: { status: 'FAILED', lastError: 'Envio interrompido (worker caiu?). Confira o canal antes de reenviar.' },
  });

  const [inFlight, perHour, perDay, last] = await Promise.all([
    prisma.post.count({ where: { status: 'POSTING' } }),
    prisma.post.count({ where: { status: 'POSTED', postedAt: { gte: hourAgo } } }),
    prisma.post.count({ where: { status: 'POSTED', postedAt: { gte: dayAgo } } }),
    prisma.post.findFirst({ where: { status: 'POSTED' }, orderBy: { postedAt: 'desc' }, select: { postedAt: true } }),
  ]);

  if (inFlight > 0) return;
  if (perHour >= config.postsPerHour || perDay >= config.postsPerDay) return;
  if (last?.postedAt && now - last.postedAt.getTime() < minGapMs) return;

  const pending = await prisma.post.findFirst({
    where: { status: 'SCHEDULED' },
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
      jobId: pending.id,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
      removeOnFail: 100,
    },
  );
}
