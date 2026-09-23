import { renderMessageHtml } from '@cupons/shared';
import { ProviderRegistry } from '@cupons/affiliates';
import { prisma, type Product as PrismaProduct } from '@cupons/db';

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

/** Gera o link de afiliado (com subID único), renderiza a mensagem e cria o post. */
export async function schedulePostForProduct(
  productId: string,
  opts?: { messageOverride?: string },
): Promise<{ id: string; affiliateUrl: string; message: string }> {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new Error('Produto não encontrado');

  const provider = registry.providerFor(product.url);
  const subId = `post_${productId.slice(-8)}`;
  const { affiliateUrl } = await provider.affiliateLink(product.url, subId);

  const message =
    opts?.messageOverride ??
    renderMessageHtml({
      store: product.store as 'SHOPEE' | 'ALIEXPRESS' | 'AMAZON',
      title: product.title,
      price: Number(product.price),
      oldPrice: product.oldPrice ? Number(product.oldPrice) : null,
      coupon: product.coupon,
      discountPct: product.discountPct,
      affiliateUrl,
    });

  // dedup: evita post duplicado do mesmo produto enquanto ainda pendente
  const pending = await prisma.post.findFirst({
    where: { productId, status: { in: ['SCHEDULED'] } },
  });
  if (pending)
    return { id: pending.id, affiliateUrl: pending.affiliateUrl, message: pending.message };

  const post = await prisma.post.create({
    data: {
      productId,
      platform: 'TELEGRAM',
      message,
      affiliateUrl,
      subId,
      status: 'SCHEDULED',
    },
  });

  return { id: post.id, affiliateUrl: post.affiliateUrl!, message: post.message };
}