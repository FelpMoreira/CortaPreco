import { timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { afterQuietHours, channelPacing, Prisma, prisma, type Channel } from '@cupons/db';
import { curatorFromEnv } from '@cupons/curator';
import { config } from './config.js';
import { registerAuth } from './auth/routes.js';
import { isProtectedApi } from './routeGuard.js';
import { audit } from './auth/sessions.js';
import { checkTelegramChat, sendTelegramTest } from './telegram.js';
import {
  CATEGORIES,
  MIRROR_DEFAULT_MAX_DELAY_SEC,
  MIRROR_LINK_TYPE_KEYS,
  MIRROR_LINK_TYPES,
  MIRROR_MAX_DELAY_LIMIT_SEC,
  SEARCH_TERMS,
} from '@cupons/shared';
import { curateQueue, mirrorQueue, mirrorStatus, type CurateJob } from './queue.js';
import {
  approveSuggestion,
  cancelPost,
  publishNow,
  createProductFromUrl,
  couponForPost,
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

/** Fonte para o JSON: lastMessageId é BigInt (o JSON.stringify não serializa). */
const publicSource = <T extends { lastMessageId: bigint | null }>(src: T) => ({ ...src, lastMessageId: src.lastMessageId?.toString() ?? null });

/**
 * Ritmo do canal + fila com horário previsto: o primeiro sai em `nextAt`; os seguintes, a cada
 * intervalo base, pulando o silêncio. É estimativa (um "postar agora" ou aprovação nova mudam a ordem).
 */
async function channelQueue(ch: Channel, now: number, take: number) {
  const pacing = await channelPacing(ch, now);
  const queue = await prisma.post.findMany({
    where: { channelId: ch.id, status: 'SCHEDULED' },
    // mesma ordem do scheduler: maior nota primeiro
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    take,
    select: { id: true, priority: true, product: { select: { title: true, store: true, imageUrl: true } } },
  });
  const step = (60 * 60 * 1000) / Math.max(ch.postsPerHour, 1);
  let eta = pacing.nextAt ? Math.max(pacing.nextAt.getTime(), now) : now;
  const upcoming = queue.map((q, i) => {
    if (i > 0) eta += step;
    if (ch.quietHours) eta = afterQuietHours(ch.quietHours, new Date(eta)).getTime();
    return { ...q, eta: new Date(eta) };
  });
  return {
    id: ch.id,
    name: ch.name,
    platform: ch.platform,
    postsPerHour: ch.postsPerHour,
    quietHours: ch.quietHours,
    ...pacing,
    upcoming,
  };
}

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: true, trustProxy: config.trustProxy, bodyLimit: 64 * 1024 });

  // só o servidor do Next chama a API (sem CORS): o navegador nunca vê a ADMIN_API_KEY
  void app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' });

  // auth de admin para tudo em /api/*, exceto as rotas públicas
  app.addHook('onRequest', async (req, reply) => {
    if (!isProtectedApi(req)) return;
    if (!isAdminKey(req.headers.authorization)) {
      return reply.code(401).send({ ok: false, error: 'Não autorizado' });
    }
  });

  // quem é o usuário (sessão) e o que o perfil dele pode fazer — ver auth/routes.ts
  registerAuth(app);

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
  // catálogo público paginado: um card por produto (o post mais recente dele), filtro por loja
  const CATALOG_PER_PAGE = 24;
  app.get(
    '/api/public/catalog',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            page: { type: 'integer', minimum: 1, maximum: 1000, default: 1 },
            store: { type: 'string', enum: ['SHOPEE', 'ALIEXPRESS', 'AMAZON', 'MERCADOLIVRE'] },
          },
        },
      },
    },
    async (req) => {
      const { page = 1, store } = req.query as { page?: number; store?: string };
      const byStore = store ? Prisma.sql`and pr.store = ${store}` : Prisma.empty;
      type Row = {
        id: string;
        postedAt: Date | null;
        store: string;
        title: string;
        imageUrl: string | null;
        price: Prisma.Decimal;
        oldPrice: Prisma.Decimal | null;
        discountPct: number | null;
        coupon: string | null;
      };
      // DISTINCT ON loja + título: o mesmo produto postado de novo (ou em outro canal) — e anúncios diferentes com o
      // mesmo título (comum no AliExpress) — aparecem uma vez, com o post mais recente
      const latest = Prisma.sql`
        select distinct on (pr.store, lower(pr.title)) p.id, p."productId", p."postedAt"
        from "Post" p join "Product" pr on pr.id = p."productId"
        where p.status = 'POSTED' and p."postedAt" is not null
        order by pr.store, lower(pr.title), p."postedAt" desc`;
      const [rows, totalRows, featured] = await Promise.all([
        prisma.$queryRaw<Row[]>`
          select x.id, x."postedAt", pr.store, pr.title, pr."imageUrl", pr.price, pr."oldPrice", pr."discountPct", pr.coupon
          from (${latest}) x join "Product" pr on pr.id = x."productId"
          where true ${byStore}
          order by x."postedAt" desc
          limit ${CATALOG_PER_PAGE} offset ${(page - 1) * CATALOG_PER_PAGE}`,
        prisma.$queryRaw<{ total: number }[]>`
          select count(*)::int as total from (${latest}) x join "Product" pr on pr.id = x."productId" where true ${byStore}`,
        // destaque do topo do site: oferta mais recente com foto, de qualquer loja
        prisma.post.findFirst({
          where: { status: 'POSTED', product: { imageUrl: { not: null } } },
          orderBy: { postedAt: 'desc' },
          select: {
            id: true,
            postedAt: true,
            product: { select: { store: true, title: true, imageUrl: true, price: true, oldPrice: true, discountPct: true, coupon: true } },
          },
        }),
      ]);
      const posts = rows.map(({ id, postedAt, ...product }) => ({ id, postedAt, product }));
      const total = totalRows[0]?.total ?? 0;

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
        page,
        perPage: CATALOG_PER_PAGE,
        total,
        pages: Math.max(1, Math.ceil(total / CATALOG_PER_PAGE)),
        featured,
        posts,
      };
    },
  );

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
        return { ok: true, product, message: defaultMessage(product, null, (await couponForPost(product))?.line) };
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
            category: { type: 'string', enum: CATEGORIES.map((c) => c.slug) },
          },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        const product = await updateProduct(id, req.body as ProductPatch);
        await audit(req, 'product.update', id, JSON.stringify(req.body).slice(0, 300));
        return { ok: true, product, message: defaultMessage(product, null, (await couponForPost(product))?.line) };
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
        querystring: {
          type: 'object',
          properties: { status: { type: 'string', enum: POST_STATUSES }, channelId: { type: 'string', pattern: ID_PATTERN } },
        },
      },
    },
    async (req) => {
      const { status, channelId } = req.query as { status?: string; channelId?: string };
      const posts = await prisma.post.findMany({
        where: { ...(status ? { status } : {}), ...(channelId ? { channelId } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: {
          product: { select: { id: true, store: true, title: true, imageUrl: true } },
          channel: { select: { platform: true, name: true } },
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
            publishNow: { type: 'boolean' },
          },
        },
      },
    },
    async (req, reply) => {
      const { productId, messageOverride, publishNow: now } = req.body as {
        productId: string;
        messageOverride?: string;
        publishNow?: boolean;
      };
      try {
        const post = await schedulePostForProduct(productId, { messageOverride, publishNow: now });
        await audit(req, now ? 'post.publish_now' : 'post.schedule', post.id, `produto ${productId}`);
        return { ok: true, post };
      } catch (e) {
        return reply.code(400).send({ ok: false, error: (e as Error).message });
      }
    },
  );

  app.post('/api/posts/:id/cancel', { schema: { params: idParams } }, async (req, reply) => {
    try {
      await cancelPost((req.params as { id: string }).id);
      await audit(req, 'post.cancel', (req.params as { id: string }).id);
      return { ok: true };
    } catch (e) {
      return reply.code(400).send({ ok: false, error: (e as Error).message });
    }
  });

  app.post('/api/posts/:id/publish', { schema: { params: idParams } }, async (req, reply) => {
    try {
      await publishNow((req.params as { id: string }).id);
      await audit(req, 'post.publish_now', (req.params as { id: string }).id);
      return { ok: true };
    } catch (e) {
      return reply.code(400).send({ ok: false, error: (e as Error).message });
    }
  });

  app.post('/api/posts/:id/requeue', { schema: { params: idParams } }, async (req, reply) => {
    try {
      await requeuePost((req.params as { id: string }).id);
      await audit(req, 'post.requeue', (req.params as { id: string }).id);
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
          properties: {
            status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED'] },
            channelId: { type: 'string', pattern: ID_PATTERN },
          },
        },
      },
    },
    async (req) => {
      const { status = 'PENDING', channelId } = req.query as { status?: string; channelId?: string };
      const suggestions = await prisma.suggestion.findMany({
        where: { status, ...(channelId ? { channelId } : {}) },
        orderBy: status === 'PENDING' ? [{ score: 'desc' }, { createdAt: 'desc' }] : { decidedAt: 'desc' },
        take: 100,
        include: {
          decidedBy: { select: { name: true } },
          channel: { select: { id: true, name: true } },
          origin: { select: { kind: true, label: true } },
          product: {
            select: {
              id: true, store: true, title: true, imageUrl: true, price: true, oldPrice: true,
              discountPct: true, coupon: true, url: true, rating: true, sales: true, category: true,
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
      await audit(req, 'suggestions.batch', null, `${urls.length} link(s)`);
      const job = await curateQueue.add('urls', { kind: 'urls', urls } satisfies CurateJob, {
        removeOnComplete: 50,
        removeOnFail: 50,
      });
      return { ok: true, jobId: job.id, count: urls.length };
    },
  );

  app.post('/api/suggestions/discover', async (req, reply) => {
    if (!registry.list().some((p) => p.discover)) {
      return reply.code(400).send({ ok: false, error: 'Nenhuma rede com API de descoberta configurada (Shopee/AliExpress)' });
    }
    await audit(req, 'suggestions.discover');
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
          ...(await approveSuggestion(id, body.hook === '' ? null : body.hook, {
            publishNow: body.publishNow,
            userId: req.admin!.id,
          }).then(async (r) => {
            await audit(req, body.publishNow ? 'suggestion.approve_publish' : 'suggestion.approve', id, `post ${r.postId}`);
            return r;
          })),
        };
      } catch (e) {
        return reply.code(400).send({ ok: false, error: (e as Error).message });
      }
    },
  );

  app.post('/api/suggestions/:id/reject', { schema: { params: idParams } }, async (req, reply) => {
    try {
      await rejectSuggestion((req.params as { id: string }).id, req.admin!.id);
      await audit(req, 'suggestion.reject', (req.params as { id: string }).id);
      return { ok: true };
    } catch (e) {
      return reply.code(400).send({ ok: false, error: (e as Error).message });
    }
  });

  // ---------- canais (listar: todos; criar/editar/testar: DEV) ----------
  const channelBody = {
    type: 'object',
    additionalProperties: false,
    properties: {
      name: { type: 'string', minLength: 2, maxLength: 60 },
      platform: { type: 'string', enum: ['TELEGRAM', 'WHATSAPP'] },
      target: { type: 'string', minLength: 2, maxLength: 120, pattern: '^(-?\\d{5,20}|@[A-Za-z0-9_]{4,64}|[0-9]{5,30}@(g\\.us|newsletter))$' },
      categories: { type: 'array', maxItems: 20, uniqueItems: true, items: { type: 'string', enum: CATEGORIES.map((c) => c.slug) } },
      postsPerHour: { type: 'integer', minimum: 1, maximum: 30 },
      postsPerDay: { type: 'integer', minimum: 0, maximum: 500 },
      quietHours: { type: 'string', maxLength: 5, pattern: '^(\\d{1,2}-\\d{1,2})?$' },
      jitterPct: { type: 'integer', minimum: 0, maximum: 80 },
      warmupDays: { type: 'integer', minimum: 0, maximum: 60 },
      generalMinScore: { type: 'integer', minimum: 0, maximum: 101 },
      routeNiche: { type: 'boolean' },
      enabled: { type: 'boolean' },
    },
  } as const;
  type ChannelInput = {
    name?: string; platform?: 'TELEGRAM' | 'WHATSAPP'; target?: string; categories?: string[];
    postsPerHour?: number; postsPerDay?: number; quietHours?: string; jitterPct?: number; warmupDays?: number;
    generalMinScore?: number; routeNiche?: boolean; enabled?: boolean;
  };

  app.get('/api/channels', async () => {
    const channels = await prisma.channel.findMany({
      orderBy: [{ enabled: 'desc' }, { createdAt: 'asc' }],
      include: {
        _count: { select: { posts: { where: { status: 'SCHEDULED' } } } },
        sources: { orderBy: { createdAt: 'asc' } },
      },
    });
    // lastMessageId é BigInt: vira texto para o JSON
    const out = channels.map((c) => ({ ...c, sources: c.sources.map(publicSource) }));
    return { ok: true, channels: out, categories: CATEGORIES.map(({ slug, label }) => ({ slug, label })) };
  });

  app.post(
    '/api/channels',
    { config: { roles: ['DEV'] }, schema: { body: { ...channelBody, required: ['name', 'platform', 'target'] } } },
    async (req, reply) => {
      const body = req.body as Required<Pick<ChannelInput, 'name' | 'platform' | 'target'>> & ChannelInput;
      if (await prisma.channel.findUnique({ where: { platform_target: { platform: body.platform, target: body.target } } })) {
        return reply.code(409).send({ ok: false, error: 'Esse grupo/canal já está cadastrado.' });
      }
      let detail = '';
      if (body.platform === 'TELEGRAM') {
        try {
          const chat = await checkTelegramChat(body.target);
          detail = `${chat.title} (${chat.type})`;
        } catch (e) {
          return reply.code(400).send({ ok: false, error: (e as Error).message });
        }
      }
      // WhatsApp: padrões conservadores (API não oficial)
      const wa = body.platform === 'WHATSAPP';
      const channel = await prisma.channel.create({
        data: {
          name: body.name.trim(),
          platform: body.platform,
          target: body.target,
          categories: body.categories ?? [],
          postsPerHour: body.postsPerHour ?? (wa ? 2 : 3),
          postsPerDay: body.postsPerDay ?? (wa ? 15 : 0),
          quietHours: body.quietHours ?? (wa ? '22-8' : '23-7'),
          jitterPct: body.jitterPct ?? (wa ? 35 : 0),
          warmupDays: body.warmupDays ?? (wa ? 14 : 0),
        },
      });
      await audit(req, 'channel.create', channel.id, `${channel.name} · ${body.target} ${detail}`);
      return { ok: true, channel, chat: detail || null };
    },
  );

  app.patch(
    '/api/channels/:id',
    { config: { roles: ['DEV'] }, schema: { params: idParams, body: { ...channelBody, minProperties: 1 } } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as ChannelInput;
      const current = await prisma.channel.findUnique({ where: { id } });
      if (!current) return reply.code(404).send({ ok: false, error: 'Canal não encontrado.' });
      if (body.target && body.target !== current.target && (body.platform ?? current.platform) === 'TELEGRAM') {
        try {
          await checkTelegramChat(body.target);
        } catch (e) {
          return reply.code(400).send({ ok: false, error: (e as Error).message });
        }
      }
      const channel = await prisma.channel.update({ where: { id }, data: { ...body, name: body.name?.trim() } });
      await audit(req, 'channel.update', id, JSON.stringify(body).slice(0, 300));
      return { ok: true, channel };
    },
  );

  // ---------- fontes de ofertas de cada canal ----------
  const sourceBody = {
    type: 'object',
    additionalProperties: false,
    properties: {
      kind: { type: 'string', enum: ['API', 'TELEGRAM', 'MIRROR', 'COUPONS'] },
      label: { type: 'string', minLength: 2, maxLength: 60 },
      enabled: { type: 'boolean' },
      stores: { type: 'array', maxItems: 4, uniqueItems: true, items: { type: 'string', enum: ['ALIEXPRESS', 'SHOPEE', 'AMAZON', 'MERCADOLIVRE'] } },
      keywords: { type: 'array', maxItems: 30, items: { type: 'string', minLength: 2, maxLength: 60 } },
      promos: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 2, maxLength: 120 } },
      telegramChat: { type: 'string', maxLength: 120, pattern: '^(@[A-Za-z0-9_]{4,64}|-?\\d{5,20})$' },
      minDiscount: { type: 'integer', minimum: 0, maximum: 95 },
      minRating: { type: ['number', 'null'], minimum: 0, maximum: 5 },
      minPrice: { type: ['number', 'null'], minimum: 0, maximum: 1_000_000 },
      maxPrice: { type: ['number', 'null'], minimum: 0, maximum: 1_000_000 },
      excludeWords: { type: 'array', maxItems: 50, items: { type: 'string', minLength: 2, maxLength: 60 } },
      maxPerRun: { type: 'integer', minimum: 1, maximum: 20 },
      intervalMin: { type: 'integer', minimum: 10, maximum: 1440 },
      autoApprove: { type: 'boolean' },
      autoMinScore: { type: 'integer', minimum: 0, maximum: 100 },
      // espelhamento (MIRROR): tipos de link, atraso aleatório e silêncio de madrugada
      linkTypes: { type: 'array', maxItems: 5, uniqueItems: true, items: { type: 'string', enum: MIRROR_LINK_TYPE_KEYS } },
      maxDelaySec: { type: 'integer', minimum: 0, maximum: MIRROR_MAX_DELAY_LIMIT_SEC },
      respectQuiet: { type: 'boolean' },
      minGapSec: { type: 'integer', minimum: 0, maximum: 3600 },
      // grupo de cupons (COUPONS): publicar os cupons válidos neste canal
      postCoupons: { type: 'boolean' },
    },
  } as const;
  type SourceInput = Record<string, unknown> & {
    kind?: 'API' | 'TELEGRAM' | 'MIRROR' | 'COUPONS';
    telegramChat?: string;
    stores?: string[];
    linkTypes?: string[];
  };
  /** Regras por tipo, sobre o estado FINAL da fonte (criação ou edição). Devolve o erro ou null. */
  const sourceProblem = (
    f: { kind: string; stores: string[]; chat: string; linkTypes: string[]; postCoupons?: boolean },
    platform: string,
  ): string | null => {
    if (f.kind === 'API' && !f.stores.length) return 'Escolha pelo menos uma loja.';
    if (f.kind === 'API' && f.stores.includes('MERCADOLIVRE')) return 'Mercado Livre não tem busca por API: use o espelhamento.';
    if ((f.kind === 'TELEGRAM' || f.kind === 'MIRROR' || f.kind === 'COUPONS') && !f.chat) return 'Informe o @ ou o ID do grupo/canal observado.';
    if (f.kind === 'COUPONS' && !f.stores.length) return 'Escolha de quais lojas os cupons interessam.';
    if (f.kind === 'COUPONS' && f.postCoupons && platform !== 'TELEGRAM') return 'Publicar cupons só em canal do Telegram.';
    if (f.kind === 'MIRROR' && !f.linkTypes.length) return 'Escolha que tipo de link o espelhamento pega.';
    if (f.kind === 'MIRROR' && f.linkTypes.includes('AMAZON') && !process.env.AMAZON_PARTNER_TAG) {
      return 'Para links da Amazon, configure AMAZON_PARTNER_TAG (a nossa tag de afiliado) no .env.';
    }
    // rajada de posts no WhatsApp = risco de ban do número (D18)
    if (f.kind === 'MIRROR' && platform !== 'TELEGRAM') return 'Espelhamento só para canais do Telegram.';
    return null;
  };
  const cleanList = (l: unknown) => (Array.isArray(l) ? [...new Set(l.map((x) => String(x).trim()).filter(Boolean))] : undefined);
  const sourceData = (b: SourceInput) => ({
    ...b,
    keywords: cleanList(b.keywords),
    promos: cleanList(b.promos),
    excludeWords: cleanList(b.excludeWords),
    telegramChat: b.telegramChat?.trim(),
  });

  // termos prontos por categoria e promoções do AliExpress disponíveis (para montar o formulário)
  app.get('/api/sources/presets', async () => {
    const ali = registry.list().find((p) => p.store === 'ALIEXPRESS') as { promotions?: () => Promise<string[]> } | undefined;
    const promos = ali?.promotions ? await ali.promotions().catch(() => []) : [];
    return {
      ok: true,
      searchTerms: SEARCH_TERMS,
      promos,
      stores: {
        ALIEXPRESS: registry.list().some((p) => p.store === 'ALIEXPRESS'),
        SHOPEE: registry.list().some((p) => p.store === 'SHOPEE'),
        AMAZON: false, // busca automática só com a Creators API
      },
      telegramReader: Boolean(process.env.TELEGRAM_API_ID && process.env.TELEGRAM_API_HASH && process.env.TELEGRAM_USER_SESSION),
      mirror: {
        linkTypes: MIRROR_LINK_TYPES,
        defaultMaxDelaySec: MIRROR_DEFAULT_MAX_DELAY_SEC,
        amazonTag: Boolean(process.env.AMAZON_PARTNER_TAG),
        ...(await mirrorStatus()),
      },
    };
  });

  app.post(
    '/api/channels/:id/sources',
    { config: { roles: ['DEV'] }, schema: { params: idParams, body: { ...sourceBody, required: ['kind', 'label'] } } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as SourceInput;
      const channel = await prisma.channel.findUnique({ where: { id } });
      if (!channel) return reply.code(404).send({ ok: false, error: 'Canal não encontrado.' });
      const problem = sourceProblem(
        { kind: body.kind!, stores: body.stores ?? [], chat: (body.telegramChat ?? '').trim(), linkTypes: body.linkTypes ?? [], postCoupons: body.postCoupons as boolean | undefined },
        channel.platform,
      );
      if (problem) return reply.code(400).send({ ok: false, error: problem });
      const source = await prisma.channelSource.create({ data: { ...(sourceData(body) as object), channelId: id } as never });
      await audit(req, 'source.create', source.id, `${source.kind} · ${source.label}${source.telegramChat ? ` · ${source.telegramChat}` : ''}`);
      return { ok: true, source: publicSource(source) };
    },
  );

  app.patch(
    '/api/sources/:id',
    { config: { roles: ['DEV'] }, schema: { params: idParams, body: { ...sourceBody, minProperties: 1 } } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as SourceInput;
      const current = await prisma.channelSource.findUnique({ where: { id }, include: { channel: { select: { platform: true } } } });
      if (!current) return reply.code(404).send({ ok: false, error: 'Fonte não encontrada.' });
      // valida o estado FINAL (o que já existe + o que mudou), como na criação
      const kind = body.kind ?? current.kind;
      const chat = (body.telegramChat ?? current.telegramChat ?? '').trim();
      const problem = sourceProblem(
        {
          kind,
          stores: body.stores ?? current.stores,
          chat,
          linkTypes: body.linkTypes ?? current.linkTypes,
          postCoupons: (body.postCoupons as boolean | undefined) ?? current.postCoupons,
        },
        current.channel.platform,
      );
      if (problem) return reply.code(400).send({ ok: false, error: problem });
      // o número das mensagens é por grupo: trocou o grupo (ou o tipo), volta a ler do começo
      // (no espelhamento, "do começo" = a partir da próxima mensagem; o histórico não é repostado)
      const restart = kind !== current.kind || chat !== (current.telegramChat ?? '');
      // religou o espelhamento: não despeja o que o grupo postou enquanto estava desligado
      const reenabled = kind === 'MIRROR' && body.enabled === true && !current.enabled;
      const source = await prisma.channelSource.update({
        where: { id },
        data: {
          ...(sourceData(body) as object),
          ...(restart || reenabled ? { lastMessageId: null } : {}),
          ...(restart ? { chatTitle: null } : {}),
        } as never,
      });
      await audit(req, 'source.update', id, JSON.stringify(body).slice(0, 300));
      return { ok: true, source: publicSource(source) };
    },
  );

  // ---------- cupons coletados dos grupos de cupons (cofre/11) ----------
  const COUPON_STATUSES = ['NEW', 'VALID', 'RESTRICTED', 'INVALID', 'EXPIRED'] as const;
  const publicCoupon = <T extends { messageId: bigint | null }>(c: T) => ({ ...c, messageId: c.messageId?.toString() ?? null });

  app.get(
    '/api/coupons',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            status: { type: 'string', enum: [...COUPON_STATUSES] },
            store: { type: 'string', enum: ['MERCADOLIVRE', 'AMAZON', 'SHOPEE', 'ALIEXPRESS'] },
          },
        },
      },
    },
    async (req) => {
      const { status, store } = req.query as { status?: string; store?: string };
      const where = { ...(status ? { status } : {}), ...(store ? { store } : {}) };
      const [coupons, counts] = await Promise.all([
        prisma.coupon.findMany({
          where,
          orderBy: [{ lastSeenAt: 'desc' }],
          take: 200,
          include: { source: { select: { label: true, chatTitle: true, telegramChat: true, channel: { select: { name: true } } } } },
        }),
        prisma.coupon.groupBy({ by: ['status'], _count: true }),
      ]);
      return {
        ok: true,
        coupons: coupons.map(publicCoupon),
        counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
      };
    },
  );

  // corrigir à mão: marcar válido/inválido e decidir se vai junto dos posts de produto
  app.patch(
    '/api/coupons/:id',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          properties: { status: { type: 'string', enum: ['VALID', 'INVALID'] }, attachable: { type: 'boolean' } },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as { status?: 'VALID' | 'INVALID'; attachable?: boolean };
      if (!(await prisma.coupon.findUnique({ where: { id }, select: { id: true } }))) {
        return reply.code(404).send({ ok: false, error: 'Cupom não encontrado.' });
      }
      const coupon = await prisma.coupon.update({
        where: { id },
        data: { ...body, ...(body.status ? { statusDetail: `marcado ${body.status === 'VALID' ? 'válido' : 'inválido'} no painel` } : {}) },
      });
      await audit(req, 'coupon.update', id, `${coupon.store}:${coupon.code} ${JSON.stringify(body)}`);
      return { ok: true, coupon: publicCoupon(coupon) };
    },
  );

  // testar de novo na conta de afiliado (só Mercado Livre)
  app.post('/api/coupons/:id/test', { schema: { params: idParams } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const coupon = await prisma.coupon.findUnique({ where: { id }, select: { store: true, code: true } });
    if (!coupon) return reply.code(404).send({ ok: false, error: 'Cupom não encontrado.' });
    if (coupon.store !== 'MERCADOLIVRE') return reply.code(400).send({ ok: false, error: 'Teste automático só para cupons do Mercado Livre.' });
    await mirrorQueue.add('coupon-test', { couponId: id }, { jobId: `coupon-test-${id}-${Date.now()}`, removeOnComplete: true, removeOnFail: 50 });
    await audit(req, 'coupon.test', id, coupon.code);
    return { ok: true };
  });

  // remover uma fonte (cadastrada errada, grupo que não interessa mais). Leva junto o histórico do espelhamento
  // e os links vistos; sugestões e cupons que ela trouxe ficam (sem a fonte). Posts já agendados continuam.
  app.delete('/api/sources/:id', { config: { roles: ['DEV'] }, schema: { params: idParams } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const source = await prisma.channelSource.findUnique({ where: { id }, include: { channel: { select: { name: true } } } });
    if (!source) return reply.code(404).send({ ok: false, error: 'Fonte não encontrada.' });
    await prisma.channelSource.delete({ where: { id } });
    await audit(req, 'source.delete', id, `${source.kind} · ${source.label}${source.telegramChat ? ` · ${source.telegramChat}` : ''} (canal ${source.channel.name})`);
    return { ok: true };
  });

  // histórico do espelhamento: o que chegou do grupo e o que virou (post, falha, ignorado)
  app.get('/api/sources/:id/events', { schema: { params: idParams } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await prisma.channelSource.findUnique({ where: { id }, select: { id: true } }))) {
      return reply.code(404).send({ ok: false, error: 'Fonte não encontrada.' });
    }
    const events = await prisma.sourceEvent.findMany({ where: { sourceId: id }, orderBy: { createdAt: 'desc' }, take: 30 });
    const posts = await prisma.post.findMany({
      where: { id: { in: events.flatMap((e) => (e.postId ? [e.postId] : [])) } },
      select: { id: true, status: true, postedAt: true, lastError: true },
    });
    return {
      ok: true,
      events: events.map((e) => ({
        ...e,
        messageId: e.messageId?.toString() ?? null,
        post: posts.find((p) => p.id === e.postId) ?? null,
      })),
    };
  });

  // alerta visto: some do painel (o histórico continua em eventos/auditoria). Qualquer perfil pode dispensar.
  app.post('/api/sources/:id/dismiss-alert', { schema: { params: idParams } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const current = await prisma.channelSource.findUnique({ where: { id }, select: { alert: true } });
    if (!current) return reply.code(404).send({ ok: false, error: 'Fonte não encontrada.' });
    await prisma.channelSource.update({ where: { id }, data: { alert: null, alertAt: null, alertCount: 0 } });
    await audit(req, 'source.dismiss_alert', id, current.alert?.slice(0, 300) ?? null);
    return { ok: true };
  });

  app.post('/api/sources/:id/run', { config: { roles: ['DEV'] }, schema: { params: idParams } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const found = await prisma.channelSource.findUnique({ where: { id }, select: { kind: true } });
    if (!found) return reply.code(404).send({ ok: false, error: 'Fonte não encontrada.' });
    if (found.kind === 'MIRROR') return reply.code(400).send({ ok: false, error: 'O espelhamento roda sozinho, a cada mensagem do grupo.' });
    await curateQueue.add('source', { kind: 'source', sourceId: id } satisfies CurateJob, {
      jobId: `source-${id}`,
      removeOnComplete: true,
      removeOnFail: true,
    });
    await audit(req, 'source.run', id);
    return { ok: true };
  });

  app.post('/api/channels/:id/test', { config: { roles: ['DEV'] }, schema: { params: idParams } }, async (req, reply) => {
    const channel = await prisma.channel.findUnique({ where: { id: (req.params as { id: string }).id } });
    if (!channel) return reply.code(404).send({ ok: false, error: 'Canal não encontrado.' });
    if (channel.platform !== 'TELEGRAM') {
      return reply.code(400).send({ ok: false, error: 'Teste disponível só para Telegram por enquanto.' });
    }
    try {
      const chat = await checkTelegramChat(channel.target);
      await sendTelegramTest(channel.target, `✅ <b>CortaPreço</b> conectado a este ${chat.type === 'channel' ? 'canal' : 'grupo'}.`);
      await audit(req, 'channel.test', channel.id, chat.title);
      return { ok: true, chat: chat.title };
    } catch (e) {
      return reply.code(400).send({ ok: false, error: (e as Error).message });
    }
  });

  // ---------- filas: uma por canal, completa, com as fontes que a abastecem ----------
  app.get('/api/queues', async () => {
    const now = Date.now();
    const channels = await prisma.channel.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        sources: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            kind: true,
            label: true,
            enabled: true,
            autoApprove: true,
            autoMinScore: true,
            lastRunAt: true,
            lastResult: true,
            telegramChat: true,
            chatTitle: true,
            linkTypes: true,
            alert: true,
          },
        },
        _count: { select: { suggestions: { where: { status: 'PENDING' } } } },
      },
    });
    const queues = await Promise.all(
      channels.map(async (ch) => ({
        ...(await channelQueue(ch, now, 50)),
        enabled: ch.enabled,
        categories: ch.categories,
        pendingSuggestions: ch._count.suggestions,
        sources: ch.sources,
      })),
    );
    return { ok: true, now: new Date(now), queues };
  });

  // ---------- visão geral (admin): números + ritmo de cada canal + previsão da fila ----------
  app.get('/api/overview', async () => {
    const now = Date.now();
    const dayAgo = new Date(now - 24 * 60 * 60 * 1000);
    const channels = await prisma.channel.findMany({ where: { enabled: true }, orderBy: { createdAt: 'asc' } });

    const channelInfo = await Promise.all(channels.map((ch) => channelQueue(ch, now, 8)));

    const [clicks24h, posted24h, failed, pendingSuggestions, recent] = await Promise.all([
      prisma.click.count({ where: { createdAt: { gte: dayAgo } } }),
      prisma.post.count({ where: { status: 'POSTED', postedAt: { gte: dayAgo } } }),
      prisma.post.count({ where: { status: 'FAILED' } }),
      prisma.suggestion.count({ where: { status: 'PENDING' } }),
      prisma.post.findMany({
        where: { status: 'POSTED' },
        orderBy: { postedAt: 'desc' },
        take: 6,
        select: {
          id: true,
          postedAt: true,
          channel: { select: { name: true, platform: true } },
          product: { select: { title: true, store: true, imageUrl: true } },
          _count: { select: { clicks: true } },
        },
      }),
    ]);

    return {
      ok: true,
      now: new Date(now),
      stats: {
        clicks24h,
        posted24h,
        scheduled: channelInfo.reduce((n, c) => n + c.scheduled, 0),
        failed,
        pendingSuggestions,
      },
      channels: channelInfo,
      recent,
      // alertas das fontes (ex.: conversão de link do espelhamento falhou): ficam até alguém dispensar
      alerts: await prisma.channelSource.findMany({
        where: { alert: { not: null } },
        orderBy: { alertAt: 'desc' },
        take: 10,
        select: { id: true, kind: true, label: true, alert: true, alertAt: true, alertCount: true, channel: { select: { id: true, name: true } } },
      }),
    };
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
