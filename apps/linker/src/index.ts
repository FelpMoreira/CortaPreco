import './env.js';

import { Worker } from 'bullmq';
import { prisma } from '@cupons/db';
import { MIRROR_QUEUE, type MirrorJob } from '@cupons/shared';
import { closeBrowser } from './browser.js';
import { config } from './config.js';
import { closeCouponTest, testCoupon } from './couponTest.js';
import { closeMirror, processMirrorEvent } from './mirror.js';
import { startStatus, stopStatus } from './status.js';

// Um navegador, uma conversão por vez: volume humano na conta de afiliado.
const worker = new Worker<MirrorJob>(
  MIRROR_QUEUE,
  // espelhamento (converter oferta) ou grupo de cupons (testar cupom do ML) — cofre/10 e cofre/11
  async (job) => ('couponId' in job.data ? testCoupon(job.data.couponId) : processMirrorEvent(job.data.eventId)),
  {
    connection: { url: config.redisUrl },
    concurrency: 1,
  },
);
worker.on('failed', (job, err) => console.error(`[linker] job ${job?.id} falhou:`, err.message));
startStatus();
console.log(`[linker] conversor iniciado (dados em ${config.dataDir})`);

const shutdown = async () => {
  console.log('[linker] shutdown');
  await worker.close();
  await stopStatus();
  await closeMirror();
  await closeCouponTest();
  await closeBrowser();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
