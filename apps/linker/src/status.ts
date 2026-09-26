import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { MIRROR_QUEUE, MIRROR_STATUS_KEYS } from '@cupons/shared';
import { hasMlSession, withPage } from './browser.js';
import { config } from './config.js';
import { checkMlSession } from './mercadolivre.js';

/**
 * Status do linker no Redis (com validade de 3 min): o painel mostra "conversor no ar" e se a
 * sessão do Mercado Livre está valendo. Sem batimento → o painel entende que o serviço caiu.
 */
type Session = 'ok' | 'expired' | 'blocked' | 'missing' | 'unknown';

const statusQueue = new Queue(MIRROR_QUEUE, { connection: { url: config.redisUrl } });
const state: { session: Session; sessionCheckedAt: string | null; lastError: string | null; lastOkAt: string | null } = {
  session: 'unknown',
  sessionCheckedAt: null,
  lastError: null,
  lastOkAt: null,
};

/** Conferência ativa da sessão (abre o gerador sem gerar nada): no início e a cada 6 h. */
const SESSION_CHECK_MS = 6 * 3_600_000;

async function publish(): Promise<void> {
  const redis = (await statusQueue.client) as unknown as Redis;
  await redis.set(
    MIRROR_STATUS_KEYS.linker,
    JSON.stringify({ online: true, ...state, session: hasMlSession() ? state.session : 'missing', at: new Date().toISOString() }),
    'EX',
    180,
  );
}

/** Resultado de uma conversão real atualiza o status (sem precisar de conferência extra). */
export async function reportConversion(session: Session | null, error: string | null): Promise<void> {
  if (session) {
    state.session = session;
    state.sessionCheckedAt = new Date().toISOString();
  }
  if (error) state.lastError = error;
  else state.lastOkAt = new Date().toISOString();
  await publish().catch(() => undefined);
}

async function checkSession(): Promise<void> {
  if (!hasMlSession()) {
    state.session = 'missing';
  } else {
    try {
      state.session = await withPage({ session: true }, (page) => checkMlSession(page));
    } catch (err) {
      state.session = 'unknown';
      state.lastError = `conferência da sessão: ${(err as Error).message.split('\n')[0]}`;
    }
  }
  state.sessionCheckedAt = new Date().toISOString();
  console.log(`[linker] sessão do Mercado Livre: ${state.session}`);
  await publish();
}

export function startStatus(): void {
  void checkSession().catch((err) => console.error('[linker] status:', err));
  setInterval(() => void publish().catch(() => undefined), 60_000).unref();
  setInterval(() => void checkSession().catch(() => undefined), SESSION_CHECK_MS).unref();
}

export async function stopStatus(): Promise<void> {
  const redis = (await statusQueue.client) as unknown as Redis;
  await redis.del(MIRROR_STATUS_KEYS.linker).catch(() => undefined);
  await statusQueue.close();
}
