import './env.js';

import { prisma } from '@cupons/db';
import { publishQueue, tickScheduler } from './scheduler.js';
import { createPublishWorker } from './worker.js';
import { createCurateWorker, curateQueue, scheduleDiscovery } from './curation.js';

const worker = createPublishWorker();
console.log('[worker] publish worker iniciado');

const curateWorker = createCurateWorker();
void scheduleDiscovery().catch((err) => console.error('[curadoria] erro ao agendar descoberta:', err));

// scheduler: tick a cada 60s
setInterval(() => {
  void tickScheduler().catch((err) => console.error('[scheduler] erro:', err));
}, 60_000);
void tickScheduler().catch((err) => console.error('[scheduler] erro:', err));

const shutdown = async () => {
  console.log('[worker] shutdown');
  await worker.close();
  await curateWorker.close();
  await publishQueue.close();
  await curateQueue.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);