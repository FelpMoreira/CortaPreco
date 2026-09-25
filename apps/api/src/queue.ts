import { Queue } from 'bullmq';
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
