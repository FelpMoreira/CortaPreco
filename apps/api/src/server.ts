import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { prisma } from '@cupons/db';
import { renderMessage } from '@cupons/shared';
import { config } from './config.js';
import { createProductFromUrl, schedulePostForProduct } from './services/deals.js';

function requireAdminKey(request: { headers: { authorization?: string | string[] | undefined } }): void {
  const auth = request.headers.authorization;
  const bearer = Array.isArray(auth) ? auth[0] : auth;
  if (!config.adminApiKey) {
    throw new Error('ADMIN_API_KEY não configurada no .env');
  }
  if (bearer !== `Bearer ${config.adminApiKey}`) {
    throw new Error('Não autorizado');
  }
}

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: true });
  void app.register(cors, { origin: true });

  // ---------- saúde ----------
  app.get('/api/health', async () => ({ ok: true }));

  // ---------- catálogo público (site) ----------
  app.get('/api/public/catalog', async () => {
    const posts = await prisma.post.findMany({
      where: { status: 'POSTED' },
      orderBy: { postedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        message: true,
        postedAt: true,
        product: {
          select: { id: true, store: true, title: true, imageUrl: true, price: true, oldPrice: true, discountPct: true, coupon: true, url: true },
        },
      },
    });
    return {
      base: `${config.publicBaseUrl}/c/`,
      posts,
    };
  });

  // ---------- preview (admin) ----------
  app.post('/api/preview', async (req, reply) => {
    try {
      void requireAdminKey(req);
    } catch (e) {
      return reply.code(401).send({ ok: false, error: (e as Error).message });
    }
    const { url, messageOverride } = req.body as { url: string; messageOverride?: string };
    if (!url) return reply.code(400).send({ ok: false, error: 'URL obrigatória' });

    try {
      const product = await createProductFromUrl(url);
      const message =
        messageOverride ??
        renderMessage({
          store: product.store as 'SHOPEE' | 'ALIEXPRESS' | 'AMAZON',
          title: product.title,
          price: Number(product.price),
          oldPrice: product.oldPrice ? Number(product.oldPrice) : null,
          coupon: product.coupon,
          discountPct: product.discountPct,
          affiliateUrl: 'link-afiliado-ser-gerado-no-agendamento',
        });
      return { ok: true, product, message };
    } catch (e) {
      return reply.code(400).send({ ok: false, error: (e as Error).message });
    }
  });

  // ---------- produtos (admin) ----------
  app.get('/api/products', async (req) => {
    try {
      void requireAdminKey(req);
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    const products = await prisma.product.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { ok: true, products };
  });

  // ---------- posts (admin) ----------
  app.get('/api/posts', async (req) => {
    try {
      void requireAdminKey(req);
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    const posts = await prisma.post.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { product: true, _count: { select: { clicks: true } } },
    });
    return { ok: true, posts };
  });

  // agenda um post (gera link de afiliado + mensagem)
  app.post('/api/posts', async (req, reply) => {
    try {
      void requireAdminKey(req);
    } catch (e) {
      return reply.code(401).send({ ok: false, error: (e as Error).message });
    }
    const { productId, messageOverride } = req.body as { productId: string; messageOverride?: string };
    try {
      const post = await schedulePostForProduct(productId, { messageOverride });
      return { ok: true, post };
    } catch (e) {
      return reply.code(400).send({ ok: false, error: (e as Error).message });
    }
  });

  // ---------- métricas (admin) ----------
  app.get('/api/stats', async (req) => {
    try {
      void requireAdminKey(req);
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    const [clicks, scheduled, posted, postsGroup] = await Promise.all([
      prisma.click.count(),
      prisma.post.count({ where: { status: 'SCHEDULED' } }),
      prisma.post.count({ where: { status: 'POSTED' } }),
      prisma.post.groupBy({ by: ['productId'], _count: { id: true } }),
    ]);
    return { ok: true, clicks, scheduled, posted, postedWithClicks: postsGroup.filter((p) => p._count.id > 0).length };
  });

  // ---------- redirector de cliques (público) ----------
  app.get('/c/:postId', async (req, reply) => {
    const { postId } = req.params as { postId: string };
    const post = await prisma.post.findUnique({ where: { id: postId } });
    if (!post) return reply.code(404).send('Post não encontrado');

    void prisma.click
      .create({ data: { postId, referrer: req.headers.referer ?? null } })
      .catch(() => undefined);

    return reply.redirect(post.affiliateUrl);
  });

  return app;
}