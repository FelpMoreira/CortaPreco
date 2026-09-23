import { randomBytes } from 'node:crypto';
import { escapeHtml, LINK_PLACEHOLDER, renderMessageHtml } from '@cupons/shared';
import { ProviderRegistry } from '@cupons/affiliates';
import { prisma, type Product as PrismaProduct } from '@cupons/db';
import { config } from '../config.js';

export const registry = ProviderRegistry.fromEnv(process.env as Record<string, string | undefined>);

// Tenant do MVP (single-tenant). Nunca null: no Postgres, NULLs em índice único
// não são considerados iguais, o que quebraria o dedup por produto.
const TENANT = 'default';

export interface EnrichedPreview {
  product: PrismaProduct;
  message: string;
}

/** Enriquece uma URL e faz upsert do produto (dedup por loja + storeProductId). */
export async function createProductFromUrl(rawUrl: string): Promise<PrismaProduct> {
  const url = rawUrl.trim();
  const provider = registry.providerFor(url);
  const data = await provider.enrich(url);

  return prisma.product.upsert({
    where: {
      tenantId_store_storeProductId: {
        tenantId: TENANT,
        store: provider.store,
        storeProductId: data.storeProductId,
      },
    },
    update: {
      title: data.title,
      price: data.price ?? 0,
      oldPrice: data.oldPrice,
      discountPct: data.discountPct,
      coupon: data.coupon,
      imageUrl: data.imageUrl,
      category: data.category,
      rating: data.rating,
      sales: data.sales,
      url,
    },
    create: {
      store: provider.store,
      storeProductId: data.storeProductId,
      title: data.title,
      price: data.price ?? 0,
      oldPrice: data.oldPrice,
      discountPct: data.discountPct,
      coupon: data.coupon,
      imageUrl: data.imageUrl,
      category: data.category,
      rating: data.rating,
      sales: data.sales,
      url,
      status: 'NEW',
      tenantId: TENANT,
    },
  });
}

/** Mensagem padrão do produto, com o marcador no lugar do link. */
export function defaultMessage(product: PrismaProduct): string {
  return renderMessageHtml({
    store: product.store as 'SHOPEE' | 'ALIEXPRESS' | 'AMAZON',
    title: product.title,
    price: Number(product.price),
    oldPrice: product.oldPrice ? Number(product.oldPrice) : null,
    coupon: product.coupon,
    discountPct: product.discountPct,
    affiliateUrl: LINK_PLACEHOLDER,
  });
}

export interface ProductPatch {
  title?: string;
  price?: number;
  oldPrice?: number | null;
  coupon?: string | null;
  imageUrl?: string | null;
  status?: 'NEW' | 'READY' | 'FILTERED' | 'EXPIRED';
}

/** Correção manual dos dados (o enrich por scrape erra). Recalcula o desconto. */
export async function updateProduct(id: string, patch: ProductPatch): Promise<PrismaProduct> {
  const current = await prisma.product.findUnique({ where: { id } });
  if (!current) throw new Error('Produto não encontrado');

  const price = patch.price ?? Number(current.price);
  const oldPrice = patch.oldPrice === undefined ? (current.oldPrice ? Number(current.oldPrice) : null) : patch.oldPrice;
  const discountPct = oldPrice && oldPrice > price ? Math.round(((oldPrice - price) / oldPrice) * 100) : null;

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
    },
  });
}

/** Cancela um post que ainda não saiu. */
export async function cancelPost(id: string): Promise<void> {
  const { count } = await prisma.post.updateMany({ where: { id, status: 'SCHEDULED' }, data: { status: 'CANCELED' } });
  if (count === 0) throw new Error('Só dá pra cancelar post agendado (SCHEDULED)');
}

/** Devolve um post FAILED/CANCELED para a fila. */
export async function requeuePost(id: string): Promise<void> {
  const post = await prisma.post.findUnique({ where: { id } });
  if (!post) throw new Error('Post não encontrado');
  if (post.status !== 'FAILED' && post.status !== 'CANCELED') {
    throw new Error('Só dá pra reenviar post FAILED ou CANCELED');
  }
  const pending = await prisma.post.findFirst({
    where: { productId: post.productId, status: { in: ['SCHEDULED', 'POSTING'] }, NOT: { id } },
  });
  if (pending) throw new Error('Já existe outro post pendente deste produto');
  await prisma.post.update({ where: { id }, data: { status: 'SCHEDULED', lastError: null } });
}

/** Link publicado na mensagem: redirector próprio (conta cliques) ou, sem domínio público, o link direto. */
function trackedLink(postId: string, affiliateUrl: string): string {
  return config.publicBaseUrl ? `${config.publicBaseUrl}/c/${postId}` : affiliateUrl;
}

/** Gera o link de afiliado (com subID único), renderiza a mensagem e cria o post. */
export async function schedulePostForProduct(
  productId: string,
  opts?: { messageOverride?: string },
): Promise<{ id: string; affiliateUrl: string; message: string }> {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new Error('Produto não encontrado');
  if (!(Number(product.price) > 0)) {
    throw new Error('Produto sem preço (a loja não retornou o valor) — não dá pra publicar com R$ 0,00');
  }

  // dedup: evita post duplicado do mesmo produto enquanto ainda pendente
  const pending = await prisma.post.findFirst({
    where: { productId, status: { in: ['SCHEDULED', 'POSTING'] } },
  });
  if (pending)
    return { id: pending.id, affiliateUrl: pending.affiliateUrl, message: pending.message };

  const provider = registry.providerFor(product.url);
  // subID único por post: chave para cruzar com o relatório de conversão da rede
  const subId = `p${randomBytes(6).toString('hex')}`;
  const { affiliateUrl } = await provider.affiliateLink(product.url, subId);

  let template = opts?.messageOverride?.trim() || defaultMessage(product);
  if (!template.includes(LINK_PLACEHOLDER)) template += `\n\n🛒 ${LINK_PLACEHOLDER}`;

  // o link rastreado depende do id do post: cria e preenche na mesma transação,
  // assim o scheduler nunca vê o post com o marcador
  const post = await prisma.$transaction(async (tx) => {
    const created = await tx.post.create({
      data: { productId, platform: 'TELEGRAM', message: template, affiliateUrl, subId, status: 'SCHEDULED' },
    });
    const link = escapeHtml(trackedLink(created.id, affiliateUrl));
    return tx.post.update({
      where: { id: created.id },
      data: { message: template.replaceAll(LINK_PLACEHOLDER, link) },
    });
  });

  return { id: post.id, affiliateUrl: post.affiliateUrl, message: post.message };
}
