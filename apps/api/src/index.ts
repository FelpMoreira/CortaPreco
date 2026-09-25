import './env.js';

import { prisma, syncChannels } from '@cupons/db';
import { assertSafeConfig, config } from './config.js';
import { buildServer } from './server.js';
import { startAutoApprove } from './autoApprove.js';

assertSafeConfig();
// canais (Telegram/WhatsApp) vêm do .env: o agendamento cria um post por canal ativo
await syncChannels(process.env as Record<string, string | undefined>);
const app = buildServer();

const shutdown = async () => {
  app.log.info('shutdown');
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

try {
  await app.listen({ port: config.port, host: config.host });
  startAutoApprove(app.log);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}