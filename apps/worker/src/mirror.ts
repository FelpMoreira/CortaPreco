import { randomInt } from 'node:crypto';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { TelegramClient } from 'telegram';
import { NewMessage, type NewMessageEvent } from 'telegram/events/index.js';
import { getPeerId } from 'telegram/Utils.js';
import { prisma } from '@cupons/db';
import {
  MIRROR_LINK_TYPE_KEYS,
  MIRROR_QUEUE,
  MIRROR_STATUS_KEYS,
  mirrorLinkType,
  type MirrorJob,
  type MirrorLinkType,
} from '@cupons/shared';
import { config } from './config.js';
import { extractLinks, type MessageLike } from './telegramLinks.js';
import { entityById, getClient, readerConfigured, whenClientCreated } from './telegramReader.js';

/**
 * Espelhamento — parte 1 (worker): ouve os grupos observados com a conta dedicada do Telegram.
 * Para cada mensagem nova com link tratável (meli.la, amzn.to…), cria um SourceEvent e manda para a
 * fila `mirror`, onde o linker (navegador logado) converte para o NOSSO link e agenda o post.
 * Fluxo completo e decisões: cofre/10 - Espelhamento Mercado Livre.md
 */
export const mirrorQueue = new Queue<MirrorJob>(MIRROR_QUEUE, { connection: { url: config.redisUrl } });

/** Recarrega a lista de grupos e confere mensagens que o evento em tempo real possa ter perdido. */
const REFRESH_MS = 60_000;
/** Mensagem mais velha que isso não é espelhada (ex.: worker ficou fora do ar): post atrasado vira ruído. */
const MAX_MESSAGE_AGE_MS = 10 * 60_000;
/** Marca "já processada" no Redis: evento em tempo real e conferência periódica nunca duplicam. */
const SEEN_TTL_SEC = 3 * 24 * 3600;

interface Watched {
  sourceId: string;
  chat: string;
  input: unknown;
  linkTypes: MirrorLinkType[];
  maxDelaySec: number;
}

/** id marcado do chat (ex.: -1001234567890) → fontes que o observam (um grupo pode alimentar vários canais). */
let watched = new Map<string, Watched[]>();
/** Resolução @grupo → entidade, por fonte+chat: evita chamar a API do Telegram a cada minuto. */
const resolved = new Map<string, { input: unknown; peerId: string; title: string }>();
const withHandler = new WeakSet<TelegramClient>();

/** Conexão Redis da própria fila (o tipo do BullMQ é uma união que esconde as opções do SET). */
const redisClient = async () => (await mirrorQueue.client) as unknown as Redis;

async function setStatus(status: Record<string, unknown>): Promise<void> {
  const redis = await redisClient();
  await redis.set(MIRROR_STATUS_KEYS.listener, JSON.stringify({ ...status, at: new Date().toISOString() }), 'EX', 180);
}

function ensureHandler(tg: TelegramClient): void {
  if (withHandler.has(tg)) return;
  withHandler.add(tg);
  tg.addEventHandler((event: NewMessageEvent) => void onNewMessage(event), new NewMessage({}));
}

async function onNewMessage(event: NewMessageEvent): Promise<void> {
  const msg = event.message;
  const list = watched.get(getPeerId(msg.peerId));
  if (!list) return;
  for (const w of list) {
    await handleMessage(w, msg as unknown as TgMessage).catch((err) => console.error(`[espelho] fonte ${w.sourceId}, msg ${msg.id}:`, err));
  }
}

type TgMessage = { id: number; date: number } & MessageLike;

async function handleMessage(w: Watched, msg: TgMessage): Promise<void> {
  const redis = await redisClient();
  const first = await redis.set(`mirror:seen:${w.sourceId}:${msg.id}`, '1', 'EX', SEEN_TTL_SEC, 'NX');
  if (!first) return;

  // a conferência periódica continua daqui (só avança, nunca volta)
  await prisma.channelSource.updateMany({
    where: { id: w.sourceId, OR: [{ lastMessageId: null }, { lastMessageId: { lt: BigInt(msg.id) } }] },
    data: { lastMessageId: BigInt(msg.id) },
  });

  if (Date.now() - msg.date * 1000 > MAX_MESSAGE_AGE_MS) return;

  // só o PRIMEIRO link tratável da mensagem: uma mensagem do grupo = no máximo um post nosso
  const link = extractLinks(msg).find((l) => {
    const type = mirrorLinkType(l);
    return type !== null && w.linkTypes.includes(type);
  });
  if (!link) return;

  // atraso aleatório de 0 a maxDelaySec, contado da mensagem ORIGINAL (não de quando a vimos)
  const postAt = new Date(msg.date * 1000 + randomInt(0, w.maxDelaySec * 1000 + 1));
  const event = await prisma.sourceEvent.create({
    data: {
      sourceId: w.sourceId,
      messageId: BigInt(msg.id),
      link,
      linkType: mirrorLinkType(link)!,
      postAt,
    },
  });
  await mirrorQueue.add('convert', { eventId: event.id }, { jobId: `mirror-${event.id}`, removeOnComplete: true, removeOnFail: 200 });
  await prisma.channelSource.update({ where: { id: w.sourceId }, data: { lastRunAt: new Date() } });
  console.log(`[espelho] ${w.chat} msg ${msg.id}: ${link} → conversão (post às ${postAt.toISOString()})`);
}

/** Alerta no painel só quando muda (não incrementa o contador a cada minuto com o mesmo problema). */
async function raiseAlert(sourceId: string, text: string): Promise<void> {
  await prisma.channelSource.updateMany({
    where: { id: sourceId, OR: [{ alert: null }, { alert: { not: text } }] },
    data: { alert: text, alertAt: new Date(), alertCount: { increment: 1 } },
  });
}

async function refresh(): Promise<void> {
  const sources = await prisma.channelSource.findMany({
    where: { kind: 'MIRROR', enabled: true, channel: { enabled: true } },
    select: { id: true, telegramChat: true, chatTitle: true, linkTypes: true, maxDelaySec: true, lastMessageId: true },
  });
  if (sources.length === 0) {
    watched = new Map();
    await setStatus({ ok: true, watching: [] });
    return;
  }

  const tg = await getClient();
  ensureHandler(tg);

  const next = new Map<string, Watched[]>();
  const watching: { sourceId: string; title: string }[] = [];
  for (const s of sources) {
    const chat = (s.telegramChat ?? '').trim();
    if (!chat) continue;
    try {
      const key = `${s.id}|${chat}`;
      let r = resolved.get(key);
      if (!r) {
        const input = /^-?\d+$/.test(chat) ? await entityById(tg, chat) : await tg.getInputEntity(chat);
        const entity = await tg.getEntity(input as never);
        const title =
          ('title' in entity && entity.title) || ('username' in entity && entity.username ? `@${entity.username}` : chat);
        r = { input, peerId: getPeerId(entity), title: String(title) };
        resolved.set(key, r);
      }
      if (r.title !== s.chatTitle) await prisma.channelSource.update({ where: { id: s.id }, data: { chatTitle: r.title } });

      const w: Watched = {
        sourceId: s.id,
        chat,
        input: r.input,
        linkTypes: s.linkTypes.filter((t): t is MirrorLinkType => (MIRROR_LINK_TYPE_KEYS as string[]).includes(t)),
        maxDelaySec: s.maxDelaySec,
      };
      next.set(r.peerId, [...(next.get(r.peerId) ?? []), w]);
      watching.push({ sourceId: s.id, title: r.title });

      if (s.lastMessageId === null) {
        // ativou agora: começa das PRÓXIMAS mensagens (não espelha o histórico do grupo)
        const [latest] = await tg.getMessages(r.input as never, { limit: 1 });
        await prisma.channelSource.update({ where: { id: s.id }, data: { lastMessageId: BigInt(latest?.id ?? 0) } });
        continue;
      }
      // rede de segurança: pega o que o evento em tempo real não entregou (reconexão, lacuna de updates)
      const missed = await tg.getMessages(r.input as never, { minId: Number(s.lastMessageId), limit: 50 });
      for (const m of [...missed].sort((a, b) => a.id - b.id)) await handleMessage(w, m as unknown as TgMessage);
    } catch (err) {
      resolved.delete(`${s.id}|${chat}`);
      const reason = `Não consegui ler o grupo ${chat}: ${(err as Error).message}`.slice(0, 300);
      console.error(`[espelho] ${reason}`);
      await raiseAlert(s.id, reason);
    }
  }
  watched = next;
  await setStatus({ ok: true, watching });
}

/** Liga o ouvinte (se a conta dedicada do Telegram estiver configurada). */
export function startMirror(): void {
  if (!readerConfigured()) {
    const off = () =>
      setStatus({ ok: false, reason: 'Conta dedicada do Telegram não conectada (TELEGRAM_API_ID/HASH/USER_SESSION).' }).catch(
        () => undefined,
      );
    void off();
    setInterval(off, REFRESH_MS).unref();
    console.log('[espelho] conta do Telegram não conectada: espelhamento desligado');
    return;
  }
  whenClientCreated(ensureHandler);
  let running = false;
  const tick = async () => {
    if (running) return; // conferência anterior ainda rodando (Telegram lento): não empilha
    running = true;
    try {
      await refresh();
    } catch (err) {
      console.error('[espelho] erro:', err);
      await setStatus({ ok: false, reason: (err as Error).message.slice(0, 300) }).catch(() => undefined);
    } finally {
      running = false;
    }
  };
  void tick();
  setInterval(tick, REFRESH_MS).unref();
  console.log('[espelho] ouvinte do Telegram iniciado');
}

export async function stopMirror(): Promise<void> {
  await mirrorQueue.close();
}
