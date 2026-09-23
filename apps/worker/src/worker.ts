import { Worker } from 'bullmq';
import { prisma } from '@cupons/db';
import { config } from './config.js';
import { sendTelegramMessage } from './sender.js';

export function createPublishWorker(): Worker {
  const worker = new Worker(
    'publish',
    async (job) => {
      const { postId } = job.data as { postId: string };
      const post = await prisma.post.findUnique({ where: { id: postId } });
      if (!post) throw new Error(`Post ${postId} não encontrado`);

      if (!config.telegramChannel) throw new Error('TELEGRAM_CHANNEL não configurado');

      // pacing: evita rajada ao mesmo chat (~1 msg/s já é seguro p/ a Bot API)
      await new Promise((r) => setTimeout(r, 1200 + Math.floor(Math.random() * 800)));

      const result = await sendTelegramMessage(config.telegramChannel, post.message);

      await prisma.post.update({
        where: { id: postId },
        data: { status: 'POSTED', postedAt: new Date(), telegramMessageId: result.messageId ?? null },
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
    console.error(`[worker] post ${job?.data.postId} falhou:`);
    console.error(err.message);
    await prisma.post
      .update({
        where: { id: job.data.postId as string },
        data: { status: 'FAILED' },
      })
      .catch(() => undefined);
  });

  return worker;
}