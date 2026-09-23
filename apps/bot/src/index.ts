import { config as loadEnv } from 'dotenv';
loadEnv({ path: new URL('../../../.env', import.meta.url) });

import { Bot, Composer } from 'grammy';
import { prisma } from '@cupons/db';

const token = process.env.TELEGRAM_BOT_TOKEN || '';
const adminIds = (process.env.TELEGRAM_ADMIN_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map(Number);
const channel = process.env.TELEGRAM_CHANNEL || '';

if (!token) {
  console.error('TELEGRAM_BOT_TOKEN não configurado — bot não inicia');
  process.exit(1);
}

const bot = new Bot(token);

/** Middleware de admin: só quem está em TELEGRAM_ADMIN_IDS comanda o bot. */
const adminOnly =
  () =>
  (ctx: { from?: { id: number } }, next: () => Promise<unknown>): Promise<unknown> => {
    const id = ctx.from?.id;
    if (!id || !adminIds.includes(id)) {
      return Promise.resolve(); // ignora silenciosamente não-admins
    }
    return next();
  };

const app = new Composer();

// públicos: funcionam para qualquer pessoa (precisamos do /whoami para descobrir admins)
app.command('start', (ctx) =>
  ctx.reply('Bot do pipeline de ofertas. Comandos: /stats', { parse_mode: 'HTML' }),
);

app.command('whoami', (ctx) =>
  ctx.reply(`Seu ID: ${ctx.from?.id}${adminIds.includes(ctx.from?.id ?? -1) ? ' ✅ admin' : ' ❌ sem acesso'}`),
);

app.use(adminOnly());

app.command('stats', async (ctx) => {
  const [products, posted, scheduled, clicks, dayPosts] = await Promise.all([
    prisma.product.count(),
    prisma.post.count({ where: { status: 'POSTED' } }),
    prisma.post.count({ where: { status: 'SCHEDULED' } }),
    prisma.click.count(),
    prisma.post.count({
      where: { status: 'POSTED', postedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    }),
  ]);
  await ctx.reply(
    [
      '📊 <b>Pipeline</b>',
      `Produtos: ${products}`,
      `Posts publicados: ${posted} (hoje: ${dayPosts})`,
      `Agendados: ${scheduled}`,
      `Cliques rastreados: ${clicks}`,
    ].join('\n'),
    { parse_mode: 'HTML' },
  );
});

app.command('whoami', (ctx) =>
  ctx.reply(`Seu ID: ${ctx.from?.id}${adminIds.includes(ctx.from?.id ?? -1) ? ' ✅ admin' : ' ❌ sem acesso'}`),
);

app.command('channel', (ctx) => ctx.reply(`Canal configurado: ${channel || '(não configurado)'}`));

bot.use(app);

console.log(`[bot] iniciando long polling (admins: ${adminIds.join(', ')})`);
await bot.start();

const shutdown = async () => {
  await bot.stop();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);