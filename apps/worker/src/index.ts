import './env.js';

import { prisma } from '@cupons/db';
import { publishQueue, tickScheduler } from './scheduler.js';
import { createPublishWorker } from './worker.js';

const worker = createPublishWorker();
console.log('[worker] publish worker iniciado');

// scheduler: tick a cada 60s
setInterval(() => {
  void tickScheduler().catch((err) => console.error('[scheduler] erro:', err));
}, 60_000);
void tickScheduler().catch((err) => console.error('[scheduler] erro:', err));

const shutdown = async () => {
  console.log('[worker] shutdown');
  await worker.close();
  await publishQueue.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);