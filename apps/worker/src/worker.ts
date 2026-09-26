import { Worker } from 'bullmq';
import { prisma } from '@cupons/db';
import { config } from './config.js';
import { ChatMigratedError, sendTelegramMessage, sendTelegramPhoto } from './sender.js';
import { sendWhatsApp } from './whatsapp.js';
import { verifyBeforePosting } from './verify.js';

/**
 * Grupo migrou para supergrupo: atualiza o canal para o ID novo (todos os canais com o ID antigo) e
 * devolve o ID novo para reenviar na hora. Fica registrado na auditoria.
 */
export async function followMigration(err: ChatMigratedError): Promise<string> {
  const moved = await prisma.channel.updateMany({ where: { platform: 'TELEGRAM', target: err.oldChatId }, data: { target: err.newChatId } });
  if (moved.count) {
    await prisma.auditLog
      .create({ data: { action: 'channel.migrated', target: err.newChatId, detail: `grupo virou supergrupo: ${err.oldChatId} → ${err.newChatId}` } })
      .catch(() => undefined);
    console.warn(`[worker] grupo virou supergrupo: ${err.oldChatId} → ${err.newChatId} (canal atualizado)`);
  }
  return err.newChatId;
}

/** Telegram: foto + legenda (HTML); se a imagem falhar, só texto. Segue migração para supergrupo. */
async function sendTelegram(target: string, message: string, imageUrl: string | null): Promise<number | null> {
  try {
    return await sendTelegramOnce(target, message, imageUrl);
  } catch (err) {
    if (!(err instanceof ChatMigratedError)) throw err;
    return sendTelegramOnce(await followMigration(err), message, imageUrl);
  }
}

async function sendTelegramOnce(target: string, message: string, imageUrl: string | null): Promise<number | null> {
  if (imageUrl) {
    try {
      return (await sendTelegramPhoto(target, imageUrl, message)).messageId ?? null;
    } catch (err) {
      if (err instanceof ChatMigratedError) throw err; // não é problema da imagem
      // imagem inacessível p/ o Telegram → cai pra texto
    }
  }
  return (await sendTelegramMessage(target, message)).messageId ?? null;
}

export function createPublishWorker(): Worker {
  const worker = new Worker(
    'publish',
    async (job) => {
      const { postId } = job.data as { postId: string };
      const post = await prisma.post.findUnique({
        where: { id: postId },
        include: { product: true, channel: true },
      });
      if (!post) throw new Error(`Post ${postId} não encontrado`);
      // só processa quem o scheduler reivindicou; retry depois de um envio que deu certo
      // (ex.: falha só no update abaixo) encontra POSTED e não duplica no canal
      if (post.status !== 'POSTING') return;

      // oferta ainda vale? (preço/estoque na loja agora). Cancelar libera a vez para o próximo da fila.
      const verdict = await verifyBeforePosting(post);
      if (verdict.action === 'cancel') {
        console.log(`[worker] post ${postId} cancelado: ${verdict.reason}`);
        await prisma.post.update({ where: { id: postId }, data: { status: 'CANCELED', lastError: verdict.reason } });
        return;
      }
      if (verdict.action === 'retry') {
        console.warn(`[worker] post ${postId} volta para a fila: ${verdict.reason}`);
        await prisma.post.update({
          where: { id: postId },
          data: { status: 'SCHEDULED', lastError: verdict.reason, checkErrors: { increment: 1 } },
        });
        return;
      }
      if (verdict.note) console.log(`[worker] post ${postId}: ${verdict.note}`);
      const message = verdict.message;

      // pacing: evita rajada ao mesmo chat (~1 msg/s já é seguro p/ a Bot API)
      await new Promise((r) => setTimeout(r, 1200 + Math.floor(Math.random() * 800)));

      const platform = post.channel?.platform ?? 'TELEGRAM';
      let telegramMessageId: number | null = null;
      if (platform === 'WHATSAPP') {
        if (!post.channel) throw new Error('Post de WhatsApp sem canal');
        await sendWhatsApp(post.channel.target, message, post.product.imageUrl);
      } else {
        const target = post.channel?.target ?? config.telegramChannel;
        if (!target) throw new Error('TELEGRAM_CHANNEL não configurado');
        telegramMessageId = await sendTelegram(target, message, post.product.imageUrl);
      }

      await prisma.post.update({
        where: { id: postId },
        data: { status: 'POSTED', postedAt: new Date(), telegramMessageId, lastError: null, message },
      });

      // produto também vai pra POSTED-equivalente (expirações futuras tratam o resto)
      await prisma.product.updateMany({
        where: { id: post.productId, status: { in: ['NEW', 'READY'] } },
        data: { status: 'EXPIRED' },
      });
    },
    { connection: { url: config.redisUrl } },
  );

  worker.on('failed', async (job, err) => {
    if (!job) return;
    const final = job.attemptsMade >= (job.opts.attempts ?? 1);
    console.error(`[worker] post ${job.data.postId} falhou (tentativa ${job.attemptsMade}${final ? ', desistindo' : ''}): ${err.message}`);
    // o evento dispara a cada tentativa; só marca FAILED quando não há mais retry
    if (!final) return;
    await prisma.post
      .update({
        where: { id: job.data.postId as string },
        data: { status: 'FAILED', lastError: err.message.slice(0, 500) },
      })
      .catch(() => undefined);
  });

  return worker;
}