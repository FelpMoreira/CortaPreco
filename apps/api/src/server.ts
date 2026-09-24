import { timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { prisma } from '@cupons/db';
import { curatorFromEnv } from '@cupons/curator';
import { config } from './config.js';
import { curateQueue, type CurateJob } from './queue.js';
import {
  approveSuggestion,
  cancelPost,
  publishNow,
  createProductFromUrl,
  defaultMessage,
  registry,
  rejectSuggestion,
  requeuePost,
  schedulePostForProduct,
  updateProduct,
  type ProductPatch,
} from './services/deals.js';

function isAdminKey(authorization: string | undefined): boolean {
  if (!config.adminApiKey || !authorization) return false;
  const given = Buffer.from(authorization);
  const expected = Buffer.from(`Bearer ${config.adminApiKey}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Rotas /api/* que não exigem a chave de admin. */
const PUBLIC_API = ['/api/health', '/api/public/'];

/** Ids gerados pelo Prisma (cuid): barra lixo antes de ir ao banco. */
const ID_PATTERN = '^[a-z0-9]{20,40}$';
const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', pattern: ID_PATTERN } },
} as const;

/** Robôs que abrem o link para gerar preview — não são cliques de gente. */
const PREVIEW_BOTS = /TelegramBot|WhatsApp|facebookexternalhit|Twitterbot|Slackbot|Discordbot|bot\b|crawler|spider/i;

const POST_STATUSES = ['SCHEDULED', 'POSTING', 'POSTED', 'FAILED', 'CANCELED'];

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: true, trustProxy: config.trustProxy, bodyLimit: 64 * 1024 });

  // só o servidor do Next chama a API (sem CORS): o navegador nunca vê a ADMIN_API_KEY
  void app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' });

  // auth de admin para tudo em /api/*, exceto as rotas públicas
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/') || PUBLIC_API.some((p) => req.url.startsWith(p))) return;
    if (!isAdminKey(req.headers.authorization)) {
      return reply.code(401).send({ ok: false, error: 'Não autorizado' });
    }
  });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
  });

  // erro inesperado não vaza stack/detalhe de banco para o cliente
  app.setErrorHandler((err: FastifyError, req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    const message = err.validation ? `Dados inválidos: ${err.message}` : status >= 500 ? 'Erro interno' : err.message;
    return reply.code(status).send({ ok: false, error: message });
  });

  // ---------- saúde ----------
  app.get('/api/health', async () => ({ ok: true }));

  // ---------- catálogo público (site) ----------
  app.get('/api/public/catalog', async () => {
    const posts = await prisma.post.findMany({
      where: { status: 'POSTED' },
      orderBy: { postedAt: 'desc' },
      take: 60,
      select: {
        id: true,
        postedAt: true,
        product: {
          select: { store: true, title: true, imageUrl: true, price: true, oldPrice: true, discountPct: true, coupon: true },
        },
      },
    });
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [totalPosted, best, week] = await Promise.all([
      prisma.post.count({ where: { status: 'POSTED' } }),
      prisma.product.aggregate({
        where: { posts: { some: { status: 'POSTED', postedAt: { gte: weekAgo } } } },
        _max: { discountPct: true },
      }),
      prisma.post.count({ where: { status: 'POSTED', postedAt: { gte: weekAgo } } }),
    ]);
    return {
      ok: true,
      base: `${config.publicBaseUrl || `http://localhost:${config.port}`}/c/`,
      stats: { totalPosted, postedThisWeek: week, bestDiscountWeek: best._max.discountPct ?? null },
      posts,
    };
  });

  // ---------- preview (admin) ----------
  app.post(
    '/api/preview',
    {
      schema: {
        body: {
          type: 'object',
          required: ['url'],
          properties: { url: { type: 'string', minLength: 10, maxLength: 2048, pattern: '^https?://' } },
        },
      },
    },
    async (req, reply) => {
      const { url } = req.body as { url: string };
      try {
        const product = await createProductFromUrl(url);
        return { ok: true, product, message: defaultMessage(product) };
      } catch (e) {
        return reply.code(400).send({ ok: false, error: (e as Error).message });
      }
    },
  );

  // ---------- produtos (admin) ----------
  app.get('/api/products', async () => {
    const products = await prisma.product.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 100,
      include: { _count: { select: { posts: true } } },
    });
    return { ok: true, products };
  });

  app.patch(
    '/api/products/:id',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          properties: {
            title: { type: 'string', minLength: 3, maxLength: 300 },
            price: { type: 'number', exclusiveMinimum: 0, maximum: 1_000_000 },
            oldPrice: { type: ['number', 'null'], exclusiveMinimum: 0, maximum: 1_000_000 },
            coupon: { type: ['string', 'null'], maxLength: 60 },
            imageUrl: { type: ['string', 'null'], maxLength: 2048, pattern: '^(https://.*)?$' },
            status: { type: 'string', enum: ['NEW', 'READY', 'FILTERED', 'EXPIRED'] },
          },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        const product = await updateProduct(id, req.body as ProductPatch);
        return { ok: true, product, message: defaultMessage(product) };
      } catch (e) {
        return reply.code(400).send({ ok: false, error: (e as Error).message });
      }
    },
  );

  // ---------- posts (admin) ----------
  app.get(
    '/api/posts',
    {
      schema: {
        querystring: { type: 'object', properties: { status: { type: 'string', enum: POST_STATUSES } } },
      },
    },
    async (req) => {
      const { status } = req.query as { status?: string };
      const posts = await prisma.post.findMany({
        where: status ? { status } : undefined,
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: {
          product: { select: { id: true, store: true, title: true, imageUrl: true } },
          _count: { select: { clicks: true } },
        },
      });
      return { ok: true, posts, publicBaseUrl: config.publicBaseUrl || null };
    },
  );

  // agenda um post (gera link de afiliado + mensagem)
  app.post(
    '/api/posts',
    {
      schema: {
        body: {
          type: 'object',
          required: ['productId'],
          properties: {
            productId: { type: 'string', pattern: ID_PATTERN },
            // limite do caption de foto no Telegram é 1024; texto puro vai até 4096
            messageOverride: { type: 'string', maxLength: 3500 },
          },
        },
      },
    },
    async (req, reply) => {
      const { productId, messageOverride } = req.body as { productId: string; messageOverride?: string };
      try {
        const post = await schedulePostForProduct(productId, { messageOverride });
        return { ok: true, post };
      } catch (e) {
        return reply.code(400).send({ ok: false, error: (e as Error).message });
      }
    },
  );

  app.post('/api/posts/:id/cancel', { schema: { params: idParams } }, async (req, reply) => {
    try {
      await cancelPost((req.params as { id: string }).id);
      return { ok: true };
    } catch (e) {
      return reply.code(400).send({ ok: false, error: (e as Error).message });
    }
  });

  app.post('/api/posts/:id/publish', { schema: { params: idParams } }, async (req, reply) => {
    try {
      await publishNow((req.params as { id: string }).id);
      return { ok: true };
    } catch (e) {
      return reply.code(400).send({ ok: false, error: (e as Error).message });
    }
  });

  app.post('/api/posts/:id/requeue', { schema: { params: idParams } }, async (req, reply) => {
    try {
      await requeuePost((req.params as { id: string }).id);
      return { ok: true };
    } catch (e) {
      return reply.code(400).send({ ok: false, error: (e as Error).message });
    }
  });

  // ---------- sugestões da curadoria (admin) ----------
  const curatorName = curatorFromEnv(process.env as Record<string, string | undefined>).name;

  app.get(
    '/api/suggestions',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: { status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED'] } },
        },
      },
    },
    async (req) => {
      const { status = 'PENDING' } = req.query as { status?: string };
      const suggestions = await prisma.suggestion.findMany({
        where: { status },
        orderBy: status === 'PENDING' ? [{ score: 'desc' }, { createdAt: 'desc' }] : { decidedAt: 'desc' },
        take: 100,
        include: {
          product: {
            select: {
              id: true, store: true, title: true, imageUrl: true, price: true, oldPrice: true,
              discountPct: true, coupon: true, url: true, rating: true, sales: true,
            },
          },
        },
      });
      const [waiting, active] = await Promise.all([curateQueue.getWaitingCount(), curateQueue.getActiveCount()]);
      return {
        ok: true,
        suggestions,
        curator: curatorName,
        discoverSources: registry.list().filter((p) => p.discover).map((p) => p.store),
        running: waiting + active,
      };
    },
  );

  // lote de links colados pelo admin → worker busca devagar e a curadoria escolhe
  app.post(
    '/api/suggestions/batch',
    {
      schema: {
        body: {
          type: 'object',
          required: ['urls'],
          additionalProperties: false,
          properties: {
            urls: {
              type: 'array',
              minItems: 1,
              maxItems: 15,
              items: { type: 'string', minLength: 10, maxLength: 2048, pattern: '^https?://' },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const urls = [...new Set((req.body as { urls: string[] }).urls.map((u) => u.trim()))];
      const unknown = urls.filter((u) => {
        try {
          registry.providerFor(u);
          return false;
        } catch {
          return true;
        }
      });
      if (unknown.length) {
        return reply.code(400).send({ ok: false, error: `Loja não configurada para: ${unknown.slice(0, 3).join(', ')}` });
      }
      const job = await curateQueue.add('urls', { kind: 'urls', urls } satisfies CurateJob, {
        removeOnComplete: 50,
        removeOnFail: 50,
      });
      return { ok: true, jobId: job.id, count: urls.length };
    },
  );

  app.post('/api/suggestions/discover', async (_req, reply) => {
    if (!registry.list().some((p) => p.discover)) {
      return reply.code(400).send({ ok: false, error: 'Nenhuma rede com API de descoberta configurada (Shopee/AliExpress)' });
    }
    const job = await curateQueue.add('discover', { kind: 'discover' } satisfies CurateJob, {
      removeOnComplete: 50,
      removeOnFail: 50,
    });
    return { ok: true, jobId: job.id };
  });

  app.post(
    '/api/suggestions/:id/approve',
    {
      schema: {
        params: idParams,
        body: {
          type: ['object', 'null'],
          additionalProperties: false,
          properties: {
            hook: { type: ['string', 'null'], maxLength: 200 },
            publishNow: { type: 'boolean' },
          },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as { hook?: string | null; publishNow?: boolean };
      try {
        return {
          ok: true,
          ...(await approveSuggestion(id, body.hook === '' ? null : body.hook, { publishNow: body.publishNow })),
        };
      } catch (e) {
        return reply.code(400).send({ ok: false, error: (e as Error).message });
      }
    },
  );

  app.post('/api/suggestions/:id/reject', { schema: { params: idParams } }, async (req, reply) => {
    try {
      await rejectSuggestion((req.params as { id: string }).id);
      return { ok: true };
    } catch (e) {
      return reply.code(400).send({ ok: false, error: (e as Error).message });
    }
  });

  // ---------- métricas (admin) ----------
  app.get('/api/stats', async () => {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [clicks, clicks24h, scheduled, posted, posted24h, failed, postedWithClicks, top] = await Promise.all([
      prisma.click.count(),
      prisma.click.count({ where: { createdAt: { gte: dayAgo } } }),
      prisma.post.count({ where: { status: 'SCHEDULED' } }),
      prisma.post.count({ where: { status: 'POSTED' } }),
      prisma.post.count({ where: { status: 'POSTED', postedAt: { gte: dayAgo } } }),
      prisma.post.count({ where: { status: 'FAILED' } }),
      prisma.post.count({ where: { status: 'POSTED', clicks: { some: {} } } }),
      prisma.post.findMany({
        where: { status: 'POSTED', clicks: { some: {} } },
        orderBy: { clicks: { _count: 'desc' } },
        take: 5,
        select: { id: true, product: { select: { title: true, store: true } }, _count: { select: { clicks: true } } },
      }),
    ]);
    return { ok: true, clicks, clicks24h, scheduled, posted, posted24h, failed, postedWithClicks, top };
  });

  // ---------- redirector de cliques (público) ----------
  app.get(
    '/c/:postId',
    {
      schema: { params: { type: 'object', properties: { postId: { type: 'string', pattern: ID_PATTERN } } } },
      // generoso: operadoras móveis põem muita gente atrás do mesmo IP (CGNAT)
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { postId } = req.params as { postId: string };
      const post = await prisma.post.findUnique({ where: { id: postId }, select: { affiliateUrl: true, status: true } });
      if (!post || post.status === 'CANCELED') return reply.code(404).send('Oferta não encontrada');

      const ua = req.headers['user-agent'] ?? '';
      if (post.status === 'POSTED' && ua && !PREVIEW_BOTS.test(ua)) {
        void prisma.click
          .create({ data: { postId, referrer: req.headers.referer?.slice(0, 500) ?? null } })
          .catch((err) => req.log.warn({ err }, 'falha ao registrar clique'));
      }

      reply.header('Cache-Control', 'no-store');
      return reply.redirect(post.affiliateUrl, 302);
    },
  );

  return app;
}
