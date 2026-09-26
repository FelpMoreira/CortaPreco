import { createHash } from 'node:crypto';
import { TelegramClient } from 'telegram';
import { returnBigInt } from 'telegram/Helpers.js';
import { StringSession } from 'telegram/sessions/index.js';
import { canonicalProductUrl, extractLinks, isAllowedHop, SHORTENERS, type MessageLike } from './telegramLinks.js';

/**
 * Leitura de outros grupos/canais do Telegram com uma CONTA DE USUÁRIO dedicada (bot não lê
 * canais de terceiros). Só leitura. Credenciais: TELEGRAM_API_ID/HASH + TELEGRAM_USER_SESSION
 * (gerada por `npm run telegram:login`).
 */
let client: TelegramClient | null = null;
/** Cache de entidades do cliente atual já foi preenchido com os diálogos? */
let dialogsLoaded = false;

export function readerConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_API_ID && process.env.TELEGRAM_API_HASH && process.env.TELEGRAM_USER_SESSION);
}

/** Avisados a cada cliente novo (reconexão): o espelhamento registra de novo o ouvinte de mensagens. */
const onNewClient: Array<(c: TelegramClient) => void> = [];
export function whenClientCreated(cb: (c: TelegramClient) => void): void {
  onNewClient.push(cb);
}

/** Cliente único do processo: a mesma sessão em duas conexões simultâneas derruba ambas. */
export async function getClient(): Promise<TelegramClient> {
  if (client?.connected) return client;
  dialogsLoaded = false;
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
  for (const cb of onNewClient) cb(client);
  return client;
}

export const linkHash = (sourceId: string, url: string) => createHash('sha256').update(`${sourceId}|${url}`).digest('hex');

const MAX_HOPS = 5;
const HOP_TIMEOUT_MS = 8_000;
/** Teto de links resolvidos por rodada: a fila de curadoria roda um job por vez e não pode travar. */
const MAX_LINKS_PER_RUN = 30;

/**
 * Segue encurtadores até a página da loja, um salto por vez (`redirect: 'manual'`), conferindo
 * cada destino com `isAllowedHop` antes de requisitar. Nunca baixa a página da loja.
 */
export async function resolveLink(url: string): Promise<string> {
  let current = new URL(url);
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    if (!isAllowedHop(current)) throw new Error(`destino não permitido: ${current.hostname}`);
    if (!SHORTENERS.test(current.hostname)) return current.href; // chegou na loja
    const res = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(HOP_TIMEOUT_MS) });
    await res.body?.cancel().catch(() => undefined);
    const location = res.headers.get('location');
    if (res.status < 300 || res.status >= 400 || !location) return current.href;
    current = new URL(location, current);
  }
  throw new Error('redirecionamentos demais');
}

/**
 * Grupo informado pelo ID numérico: o GramJS só acha pelo ID o que já está no cache de entidades,
 * que começa vazio numa sessão nova. Carregar os diálogos uma vez preenche o cache
 * (a conta precisa ser membro do grupo, o que já é exigido para ler).
 */
export async function entityById(tg: TelegramClient, chat: string) {
  const id = returnBigInt(chat);
  try {
    return await tg.getInputEntity(id);
  } catch {
    if (!dialogsLoaded) {
      await tg.getDialogs({ limit: 500 });
      dialogsLoaded = true;
    }
    try {
      return await tg.getInputEntity(id);
    } catch {
      throw new Error(`grupo ${chat} não encontrado: a conta dedicada precisa ser membro (ou use o @usuario)`);
    }
  }
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
  const entity = /^-?\d+$/.test(chat) ? await entityById(tg, chat) : chat;
  const msgs = await tg.getMessages(entity as never, lastMessageId ? { minId: Number(lastMessageId), limit: 100 } : { limit: 20 });
  const productUrls: ReadResult['productUrls'] = [];
  let maxId = lastMessageId ? Number(lastMessageId) : 0;
  const links = new Set<string>();
  for (const m of msgs) {
    maxId = Math.max(maxId, m.id);
    for (const link of extractLinks(m as unknown as MessageLike)) links.add(link);
  }
  const seen = new Set<string>();
  for (const link of [...links].slice(0, MAX_LINKS_PER_RUN)) {
    try {
      const canonical = canonicalProductUrl(await resolveLink(link));
      if (canonical && !seen.has(canonical)) {
        seen.add(canonical);
        productUrls.push({ original: link, canonical });
      }
    } catch {
      /* link quebrado, fora do ar ou destino não permitido: ignora */
    }
  }
  return { productUrls, lastMessageId: maxId || null, messages: msgs.length };
}
