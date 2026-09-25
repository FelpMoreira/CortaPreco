import { randomBytes } from 'node:crypto';
import { escapeHtml, LINK_PLACEHOLDER, renderMessageHtml, telegramHtmlToWhatsApp } from '@cupons/shared';
import { ProviderRegistry } from '@cupons/affiliates';
import { dailyCap, prisma, recordPrice, upsertProduct, type Product as PrismaProduct } from '@cupons/db';
import { sanitizeHook } from '@cupons/curator';
import { config } from '../config.js';
import { enqueuePublish } from '../queue.js';

export const registry = ProviderRegistry.fromEnv(process.env as Record<string, string | undefined>);

/** Enriquece uma URL e faz upsert do produto (dedup por loja + storeProductId). */
export async function createProductFromUrl(rawUrl: string): Promise<PrismaProduct> {
  const url = rawUrl.trim();
  const provider = registry.providerFor(url);
  const data = await provider.enrich(url);
  return upsertProduct({ ...data, store: provider.store, url });
}

/** Mensagem padrão do produto, com o marcador no lugar do link (e a frase da curadoria, se houver). */
export function defaultMessage(product: PrismaProduct, hook?: string | null): string {
  return renderMessageHtml({
    store: product.store as 'SHOPEE' | 'ALIEXPRESS' | 'AMAZON',
    title: product.title,
    price: Number(product.price),
    oldPrice: product.oldPrice ? Number(product.oldPrice) : null,
    coupon: product.coupon,
    discountPct: product.discountPct,
    affiliateUrl: LINK_PLACEHOLDER,
    hook,
  });
}

export interface ProductPatch {
  title?: string;
  price?: number;
  oldPrice?: number | null;
  coupon?: string | null;
  imageUrl?: string | null;
  status?: 'NEW' | 'READY' | 'FILTERED' | 'EXPIRED';
  category?: string;
}

/** Correção manual dos dados (o enrich por scrape erra). Recalcula o desconto. */
export async function updateProduct(id: string, patch: ProductPatch): Promise<PrismaProduct> {
  const current = await prisma.product.findUnique({ where: { id } });
  if (!current) throw new Error('Produto não encontrado');

  const price = patch.price ?? Number(current.price);
  const oldPrice = patch.oldPrice === undefined ? (current.oldPrice ? Number(current.oldPrice) : null) : patch.oldPrice;
  const discountPct = oldPrice && oldPrice > price ? Math.round(((oldPrice - price) / oldPrice) * 100) : null;

  if (patch.price !== undefined) await recordPrice(id, patch.price);
  return prisma.product.update({
    where: { id },
    data: {
      title: patch.title?.trim() || undefined,
      price: patch.price,
      oldPrice: patch.oldPrice,
      discountPct,
      coupon: patch.coupon === undefined ? undefined : patch.coupon?.trim() || null,
      imageUrl: patch.imageUrl === undefined ? undefined : patch.imageUrl || null,
      status: patch.status,
      category: patch.category,
    },
  });
}

/** Cancela um post que ainda não saiu. */
export async function cancelPost(id: string): Promise<void> {
  const { count } = await prisma.post.updateMany({ where: { id, status: 'SCHEDULED' }, data: { status: 'CANCELED' } });
  if (count === 0) throw new Error('Só dá pra cancelar post agendado (SCHEDULED)');
}

/**
 * Publica já um post agendado: pula a fila, o intervalo e o horário de silêncio,
 * mas respeita o teto diário do canal (e a rampa de aquecimento do WhatsApp).
 */
export async function publishNow(id: string): Promise<void> {
  const post = await prisma.post.findUnique({ where: { id }, include: { channel: true } });
  if (!post) throw new Error('Post não encontrado');
  if (post.channel) {
    const cap = dailyCap(post.channel);
    if (Number.isFinite(cap)) {
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const sent = await prisma.post.count({
        where: {
          channelId: post.channel.id,
          OR: [{ status: 'POSTED', postedAt: { gte: dayAgo } }, { status: 'POSTING' }],
        },
      });
      if (sent >= cap) {
        throw new Error(`${post.channel.name}: limite de ${cap} posts em 24h atingido. O post segue na fila.`);
      }
    }
  }
  // claim atômico: se o scheduler pegou no mesmo instante, só um dos dois envia
  const { count } = await prisma.post.updateMany({ where: { id, status: 'SCHEDULED' }, data: { status: 'POSTING' } });
  if (count === 0) throw new Error('Só dá pra postar agora um post agendado (SCHEDULED)');
  await enqueuePublish(id);
}

/** "Postar agora" em vários posts (um por canal); erros por canal não impedem os outros. */
async function publishAllNow(ids: string[]): Promise<{ published: number; errors: string[] }> {
  const errors: string[] = [];
  let published = 0;
  for (const id of ids) {
    try {
      await publishNow(id);
      published++;
    } catch (err) {
      errors.push((err as Error).message);
    }
  }
  return { published, errors };
}

/** Devolve um post FAILED/CANCELED para a fila. */
export async function requeuePost(id: string): Promise<void> {
  const post = await prisma.post.findUnique({ where: { id } });
  if (!post) throw new Error('Post não encontrado');
  if (post.status !== 'FAILED' && post.status !== 'CANCELED') {
    throw new Error('Só dá pra reenviar post FAILED ou CANCELED');
  }
  const pending = await prisma.post.findFirst({
    where: {
      productId: post.productId,
      channelId: post.channelId,
      status: { in: ['SCHEDULED', 'POSTING'] },
      NOT: { id },
    },
  });
  if (pending) throw new Error('Já existe outro post pendente deste produto neste canal');
  await prisma.post.update({ where: { id }, data: { status: 'SCHEDULED', lastError: null } });
}

/** Link publicado na mensagem: redirector próprio (conta cliques) ou, sem domínio público, o link direto. */
function trackedLink(postId: string, affiliateUrl: string): string {
  return config.publicBaseUrl ? `${config.publicBaseUrl}/c/${postId}` : affiliateUrl;
}

export interface ScheduledPosts {
  /** Primeiro post criado (compatibilidade com quem espera um só). */
  id: string;
  posts: { id: string; channel: string }[];
  published?: number;
  publishErrors?: string[];
}

/**
 * Cria um post por canal ativo (Telegram, WhatsApp...). Cada um tem subID próprio
 * (atribui a venda ao canal) e a mensagem no formato da plataforma.
 */
export async function schedulePostForProduct(
  productId: string,
  opts?: {
    messageOverride?: string;
    hook?: string | null;
    publishNow?: boolean;
    /** Sugestão garimpada por uma fonte de canal: vai para esse canal (+ gerais, se a nota bater o limiar). */
    targetChannelId?: string | null;
    score?: number;
  },
): Promise<ScheduledPosts> {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new Error('Produto não encontrado');
  if (!(Number(product.price) > 0)) {
    throw new Error('Produto sem preço (a loja não retornou o valor) — não dá pra publicar com R$ 0,00');
  }

  const category = product.category ?? 'outros';
  let channels = opts?.targetChannelId
    ? // garimpado para um canal: o destino + os gerais que aceitam essa nota
      await prisma.channel.findMany({
        where: {
          enabled: true,
          OR: [
            { id: opts.targetChannelId },
            { categories: { isEmpty: true }, generalMinScore: { lte: opts.score ?? 0 } },
          ],
        },
        orderBy: { createdAt: 'asc' },
      })
    : // manual/sem destino: geral recebe tudo; os de categoria, só o que é deles
      await prisma.channel.findMany({
        where: { enabled: true, OR: [{ categories: { isEmpty: true } }, { categories: { has: category } }] },
        orderBy: { createdAt: 'asc' },
      });
  if (opts?.targetChannelId) {
    // os gerais entram "de carona": se já postaram este produto há pouco, ficam de fora
    // (a curadoria só confere o intervalo de repost no canal de destino)
    const since = new Date(Date.now() - config.repostCooldownDays * 86_400_000);
    const recent = await prisma.post.findMany({
      where: {
        productId,
        channelId: { in: channels.filter((c) => c.id !== opts.targetChannelId).map((c) => c.id) },
        postedAt: { gte: since },
      },
      select: { channelId: true },
    });
    channels = channels.filter((c) => c.id === opts.targetChannelId || !recent.some((r) => r.channelId === c.id));
  }
  if (channels.length === 0) {
    throw new Error(
      opts?.targetChannelId
        ? 'O canal de destino desta sugestão está pausado ou foi removido.'
        : `Nenhum canal ativo recebe a categoria "${category}". Ajuste em Administração → Canais.`,
    );
  }

  // dedup por canal: evita post duplicado do mesmo produto enquanto ainda pendente naquele canal
  const pending = await prisma.post.findMany({
    where: { productId, status: { in: ['SCHEDULED', 'POSTING'] }, channelId: { in: channels.map((c) => c.id) } },
    select: { id: true, channelId: true },
  });
  const todo = channels.filter((c) => !pending.some((p) => p.channelId === c.id));

  let template = opts?.messageOverride?.trim() || defaultMessage(product, opts?.hook);
  if (!template.includes(LINK_PLACEHOLDER)) template += `\n\n🛒 ${LINK_PLACEHOLDER}`;

  const provider = registry.providerFor(product.url);
  const created: { id: string; channel: string }[] = [];
  for (const channel of todo) {
    // subID único por post: chave para cruzar com o relatório de conversão da rede
    const subId = `p${randomBytes(6).toString('hex')}`;
    const { affiliateUrl } = await provider.affiliateLink(product.url, subId);
    // o link rastreado depende do id do post: cria e preenche na mesma transação,
    // assim o scheduler nunca vê o post com o marcador
    const post = await prisma.$transaction(async (tx) => {
      const draft = await tx.post.create({
        data: { productId, channelId: channel.id, platform: channel.platform, message: template, affiliateUrl, subId, status: 'SCHEDULED' },
      });
      const html = template.replaceAll(LINK_PLACEHOLDER, escapeHtml(trackedLink(draft.id, affiliateUrl)));
      const message = channel.platform === 'WHATSAPP' ? telegramHtmlToWhatsApp(html) : html;
      return tx.post.update({ where: { id: draft.id }, data: { message } });
    });
    created.push({ id: post.id, channel: channel.name });
  }

  const all = [...created, ...pending.map((p) => ({ id: p.id, channel: channels.find((c) => c.id === p.channelId)!.name }))];
  const result: ScheduledPosts = { id: all[0]!.id, posts: all };
  if (opts?.publishNow && created.length) {
    const { published, errors } = await publishAllNow(created.map((p) => p.id));
    result.published = published;
    result.publishErrors = errors;
  }
  return result;
}

// ---------------------------------------------------------------- sugestões da curadoria

/** Aprova uma sugestão: agenda os posts (com a frase da IA, editável) em todos os canais ativos. */
export async function approveSuggestion(
  id: string,
  hook: string | null | undefined,
  opts: { publishNow?: boolean; userId?: string } = {},
): Promise<{ postId: string; published: boolean; publishError?: string }> {
  const suggestion = await prisma.suggestion.findUnique({ where: { id } });
  if (!suggestion) throw new Error('Sugestão não encontrada');
  if (suggestion.status !== 'PENDING') throw new Error('Sugestão já foi decidida');

  const finalHook = hook === undefined ? suggestion.hook : sanitizeHook(hook);
  if (hook && !finalHook) throw new Error('Frase inválida: sem números, preços, %, links ou HTML (máx. 140)');

  // "reserva" a sugestão de forma atômica antes de agendar: dois cliques (ou duas pessoas)
  // ao mesmo tempo não conseguem agendar o mesmo post duas vezes
  const { count } = await prisma.suggestion.updateMany({
    where: { id, status: 'PENDING' },
    data: { status: 'APPROVED', hook: finalHook, decidedAt: new Date(), decidedById: opts.userId },
  });
  if (count === 0) throw new Error('Sugestão já foi decidida');

  let scheduled: ScheduledPosts;
  try {
    scheduled = await schedulePostForProduct(suggestion.productId, {
      hook: finalHook,
      publishNow: opts.publishNow,
      targetChannelId: suggestion.channelId,
      score: suggestion.score,
    });
  } catch (err) {
    // não agendou nada: devolve a sugestão para a fila de decisão
    await prisma.suggestion.update({ where: { id }, data: { status: 'PENDING', decidedAt: null, decidedById: null } });
    throw err;
  }
  await prisma.suggestion.update({ where: { id }, data: { postId: scheduled.id } });
  // aprovada e agendada; se o "agora" esbarrar no limite de algum canal, aquele post fica na fila normal
  return {
    postId: scheduled.id,
    published: (scheduled.published ?? 0) > 0,
    publishError: scheduled.publishErrors?.length ? scheduled.publishErrors.join(' · ') : undefined,
  };
}

export async function rejectSuggestion(id: string, userId?: string): Promise<void> {
  const { count } = await prisma.suggestion.updateMany({
    where: { id, status: 'PENDING' },
    data: { status: 'REJECTED', decidedAt: new Date(), decidedById: userId },
  });
  if (count === 0) throw new Error('Sugestão não encontrada ou já decidida');
}
