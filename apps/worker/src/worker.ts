import { Worker } from 'bullmq';
import { prisma } from '@cupons/db';
import { config } from './config.js';
import { sendTelegramMessage, sendTelegramPhoto } from './sender.js';

export function createPublishWorker(): Worker {
  const worker = new Worker(
    'publish',
    async (job) => {
      const { postId } = job.data as { postId: string };
      const post = await prisma.post.findUnique({
        where: { id: postId },
        include: { product: true },
      });
      if (!post) throw new Error(`Post ${postId} não encontrado`);
      // só processa quem o scheduler reivindicou; retry depois de um envio que deu certo
      // (ex.: falha só no update abaixo) encontra POSTED e não duplica no canal
      if (post.status !== 'POSTING') return;

      if (!config.telegramChannel) throw new Error('TELEGRAM_CHANNEL não configurado');

      // pacing: evita rajada ao mesmo chat (~1 msg/s já é seguro p/ a Bot API)
      await new Promise((r) => setTimeout(r, 1200 + Math.floor(Math.random() * 800)));

      let result;
      if (post.product.imageUrl) {
        try {
          result = await sendTelegramPhoto(config.telegramChannel, post.product.imageUrl, post.message);
        } catch {
          // imagem inacessível p/ o Telegram → cai pra texto
          result = await sendTelegramMessage(config.telegramChannel, post.message);
        }
      } else {
        result = await sendTelegramMessage(config.telegramChannel, post.message);
      }

      await prisma.post.update({
        where: { id: postId },
        data: { status: 'POSTED', postedAt: new Date(), telegramMessageId: result.messageId ?? null, lastError: null },
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