import { createHash } from 'node:crypto';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { canonicalProductUrl, extractLinks, SHORTENERS, type MessageLike } from './telegramLinks.js';

/**
 * Leitura de outros grupos/canais do Telegram com uma CONTA DE USUÁRIO dedicada (bot não lê
 * canais de terceiros). Só leitura. Credenciais: TELEGRAM_API_ID/HASH + TELEGRAM_USER_SESSION
 * (gerada por `npm run telegram:login`).
 */
let client: TelegramClient | null = null;

export function readerConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_API_ID && process.env.TELEGRAM_API_HASH && process.env.TELEGRAM_USER_SESSION);
}

async function getClient(): Promise<TelegramClient> {
  if (client?.connected) return client;
  client = new TelegramClient(
    new StringSession(process.env.TELEGRAM_USER_SESSION ?? ''),
    Number(process.env.TELEGRAM_API_ID),
    process.env.TELEGRAM_API_HASH ?? '',
    // FLOOD_WAIT de até 2 min: espera sozinho em vez de falhar
    { connectionRetries: 3, floodSleepThreshold: 120 },
  );
  client.setLogLevel('error' as never);
  await client.connect();
  if (!(await client.checkAuthorization())) throw new Error('Sessão do Telegram inválida: rode npm run telegram:login de novo');
  return client;
}

export const linkHash = (sourceId: string, url: string) => createHash('sha256').update(`${sourceId}|${url}`).digest('hex');

/** Segue encurtadores até a página da loja (sem baixar a página inteira quando possível). */
export async function resolveLink(url: string): Promise<string> {
  const host = new URL(url).hostname.toLowerCase();
  if (!SHORTENERS.test(host)) return url;
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15_000) });
  await res.body?.cancel().catch(() => undefined);
  return res.url || url;
}

export interface ReadResult {
  /** URLs de produto já limpas (sem o rastreio de quem postou). */
  productUrls: { original: string; canonical: string }[];
  lastMessageId: number | null;
  messages: number;
}

/**
 * Mensagens novas desde `lastMessageId` (na 1ª vez, só as 20 últimas) e os links de produto delas.
 * Nunca guardamos nem reaproveitamos texto/imagem da mensagem de origem.
 */
export async function readSource(chat: string, lastMessageId: bigint | null): Promise<ReadResult> {
  const tg = await getClient();
  const entity = /^-?\d+$/.test(chat) ? BigInt(chat) : chat;
  const msgs = await tg.getMessages(entity as never, lastMessageId ? { minId: Number(lastMessageId), limit: 100 } : { limit: 20 });
  const productUrls: ReadResult['productUrls'] = [];
  let maxId = lastMessageId ? Number(lastMessageId) : 0;
  for (const m of msgs) {
    maxId = Math.max(maxId, m.id);
    for (const link of extractLinks(m as unknown as MessageLike)) {
      try {
        const canonical = canonicalProductUrl(await resolveLink(link));
        if (canonical) productUrls.push({ original: link, canonical });
      } catch {
        /* link quebrado ou fora do ar: ignora */
      }
    }
  }
  return { productUrls, lastMessageId: maxId || null, messages: msgs.length };
}
