import { Queue } from 'bullmq';
import { channelPacing, prisma, type Channel } from '@cupons/db';
import { config } from './config.js';

export const publishQueue = new Queue('publish', { connection: { url: config.redisUrl } });

// regras de ritmo (silêncio, intervalo com jitter, tetos) ficam em @cupons/db/pacing:
// o painel mostra "próximo post às…" com a mesma conta.
export { inQuietHours, minGapMs } from '@cupons/db';

const QUEUE_MAX_AGE_MS = 24 * 3_600_000;

/**
 * Tick (a cada minuto): para cada canal ativo, pega o post agendado de maior nota e
 * enfileira o envio, respeitando o ritmo do canal (por hora, por dia, silêncio, jitter).
 */
export async function tickScheduler(): Promise<void> {
  const now = Date.now();

  // post preso em POSTING (worker caiu no meio) travaria a fila: marca FAILED p/ revisão manual,
  // sem reenviar sozinho — pode ter chegado ao canal
  await prisma.post.updateMany({
    where: {
      status: 'POSTING',
      updatedAt: { lt: new Date(now - 15 * 60 * 1000) },
      // espelhamento com horário reservado ainda não chegou: está esperando a vez, não travado
      OR: [{ sendAt: null }, { sendAt: { lt: new Date(now - 15 * 60 * 1000) } }],
    },
    data: { status: 'FAILED', lastError: 'Envio interrompido (worker caiu?). Confira o canal antes de reenviar.' },
  });

  // a fila sai pela nota: o que ficou 24h sem sair (sempre havia oferta melhor) já envelheceu.
  // O que alguém agendou à mão (prioridade 100) não expira sozinho.
  await prisma.post.updateMany({
    where: { status: 'SCHEDULED', priority: { lt: 100 }, createdAt: { lt: new Date(now - QUEUE_MAX_AGE_MS) } },
    data: { status: 'CANCELED', lastError: 'Expirou: 24h na fila sem sair (ofertas melhores passaram na frente)' },
  });

  const channels = await prisma.channel.findMany({ where: { enabled: true } });
  for (const channel of channels) {
    await tickChannel(channel, now).catch((err) => console.error(`[scheduler] ${channel.name}:`, err));
  }
}

async function tickChannel(channel: Channel, now: number): Promise<void> {
  const pacing = await channelPacing(channel, now);
  if (!pacing.ready) return;

  const where = { channelId: channel.id };
  const pending = await prisma.post.findFirst({
    where: { ...where, status: 'SCHEDULED' },
    // melhor oferta primeiro; empate → a mais antiga
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
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
