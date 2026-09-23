import { Queue } from 'bullmq';
import { config } from './config.js';

/** Fila do pipeline. Worker roda no app `worker`. */
export const publishQueue = new Queue('publish', { connection: { url: config.redisUrl } });