import { Queue } from 'bullmq';
import { prisma } from '@cupons/db';
import { config } from './config.js';

export const publishQueue = new Queue('publish', { connection: { url: config.redisUrl } });

/**
 * Cron (a cada minuto): pega o post SCHEDULED mais antigo e enfileira o envio,
 * respeitando teto por hora/dia e um intervalo mínimo entre posts (espalha os
 * envios na hora em vez de disparar em rajada).
 */
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
  // madrugada: ninguém quer notificação; o "postar agora" do painel ignora isso de propósito
  if (config.quietHours && inQuietHours(config.quietHours)) return;
  // teto diário é opcional (0 = sem teto): o Telegram só limita velocidade, não volume por dia
  if (perHour >= config.postsPerHour || (config.postsPerDay > 0 && perDay >= config.postsPerDay)) return;
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
      // único por tentativa: um job antigo com falha no Redis não pode bloquear o reenvio
      jobId: `${pending.id}-${Date.now()}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
      removeOnFail: 100,
    },
  );
}
