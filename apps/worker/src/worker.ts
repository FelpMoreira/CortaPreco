import { Worker } from 'bullmq';
import { prisma } from '@cupons/db';
import { config } from './config.js';
import { sendTelegramMessage, sendTelegramPhoto } from './sender.js';
import { sendWhatsApp } from './whatsapp.js';

/** Telegram: foto + legenda (HTML); se a imagem falhar, só texto. */
async function sendTelegram(target: string, message: string, imageUrl: string | null): Promise<number | null> {
  if (imageUrl) {
    try {
      return (await sendTelegramPhoto(target, imageUrl, message)).messageId ?? null;
    } catch {
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

      // pacing: evita rajada ao mesmo chat (~1 msg/s já é seguro p/ a Bot API)
      await new Promise((r) => setTimeout(r, 1200 + Math.floor(Math.random() * 800)));

      const platform = post.channel?.platform ?? 'TELEGRAM';
      let telegramMessageId: number | null = null;
      if (platform === 'WHATSAPP') {
        if (!post.channel) throw new Error('Post de WhatsApp sem canal');
        await sendWhatsApp(post.channel.target, post.message, post.product.imageUrl);
      } else {
        const target = post.channel?.target ?? config.telegramChannel;
        if (!target) throw new Error('TELEGRAM_CHANNEL não configurado');
        telegramMessageId = await sendTelegram(target, post.message, post.product.imageUrl);
      }

      await prisma.post.update({
        where: { id: postId },
        data: { status: 'POSTED', postedAt: new Date(), telegramMessageId, lastError: null },
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