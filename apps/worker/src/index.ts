import './env.js';

import { prisma, syncChannels } from '@cupons/db';
import { publishQueue, tickScheduler } from './scheduler.js';
import { createPublishWorker } from './worker.js';
import { createCurateWorker, curateQueue, scheduleDiscovery } from './curation.js';
import { startMirror, stopMirror } from './mirror.js';
import { couponPostQueue, createCouponPostWorker, expireCoupons } from './coupons.js';

// canais (Telegram/WhatsApp) e seus limites vêm do .env
const channels = await syncChannels(process.env as Record<string, string | undefined>);
console.log(`[worker] canais ativos: ${channels.map((c) => `${c.name} (${c.postsPerHour}/h, teto ${c.postsPerDay || 'livre'}/dia)`).join(', ') || 'nenhum'}`);

const worker = createPublishWorker();
console.log('[worker] publish worker iniciado');

const curateWorker = createCurateWorker();
void scheduleDiscovery().catch((err) => console.error('[curadoria] erro ao agendar descoberta:', err));

// espelhamento de grupos do Telegram (a conversão do link roda no serviço linker) + grupos de cupons
startMirror();
const couponWorker = createCouponPostWorker();

// scheduler: tick a cada 60s
setInterval(() => {
  void tickScheduler().catch((err) => console.error('[scheduler] erro:', err));
  void expireCoupons().catch((err) => console.error('[cupons] erro ao vencer:', err));
}, 60_000);
void tickScheduler().catch((err) => console.error('[scheduler] erro:', err));

const shutdown = async () => {
  console.log('[worker] shutdown');
  await worker.close();
  await curateWorker.close();
  await publishQueue.close();
  await curateQueue.close();
  await stopMirror();
  await couponWorker.close();
  await couponPostQueue.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);