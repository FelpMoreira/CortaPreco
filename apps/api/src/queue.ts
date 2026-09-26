import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { MIRROR_STATUS_KEYS } from '@cupons/shared';
import { config } from './config.js';

/** Fila de curadoria: a API só enfileira; quem busca produtos e chama a IA é o worker. */
export const curateQueue = new Queue('curate', { connection: { url: config.redisUrl } });

export type CurateJob = { kind: 'urls'; urls: string[] } | { kind: 'discover' } | { kind: 'source'; sourceId: string };

/** Mesma fila de envio que o scheduler do worker usa. */
export const publishQueue = new Queue('publish', { connection: { url: config.redisUrl } });

/** jobId único por tentativa: um job antigo com falha no Redis não pode bloquear o reenvio. */
export function enqueuePublish(postId: string) {
  return publishQueue.add(
    'publish',
    { postId },
    {
      jobId: `${postId}-${Date.now()}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
      removeOnFail: 100,
    },
  );
}

/**
 * Status do espelhamento que o worker (ouvinte do Telegram) e o linker (navegador) publicam no Redis
 * com validade de 3 min. Chave ausente = serviço fora do ar (ou nunca ligou).
 */
export async function mirrorStatus(): Promise<{ listener: Record<string, unknown> | null; linker: Record<string, unknown> | null }> {
  try {
    const redis = (await curateQueue.client) as unknown as Redis;
    const [listener, linker] = await redis.mget(MIRROR_STATUS_KEYS.listener, MIRROR_STATUS_KEYS.linker);
    const parse = (v: string | null) => (v ? (JSON.parse(v) as Record<string, unknown>) : null);
    return { listener: parse(listener ?? null), linker: parse(linker ?? null) };
  } catch {
    return { listener: null, linker: null };
  }
}
