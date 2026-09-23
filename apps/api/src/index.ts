import './env.js';

import { prisma } from '@cupons/db';
import { assertSafeConfig, config } from './config.js';
import { buildServer } from './server.js';

assertSafeConfig();
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
} catch (err) {
  app.log.error(err);
  process.exit(1);
}