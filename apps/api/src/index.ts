import { config as loadEnv } from 'dotenv';
loadEnv({ path: new URL('../../../.env', import.meta.url) });

import { prisma } from '@cupons/db';
import { config } from './config.js';
import { buildServer } from './server.js';

const app = buildServer();

const shutdown = async () => {
  app.log.info('shutdown');
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}