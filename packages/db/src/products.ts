import type { Prisma, Product } from '@prisma/client';
import { classifyCategory, isCategory } from '@cupons/shared';
import { prisma } from './client.js';

// Tenant do MVP (single-tenant). Nunca null: no Postgres, NULLs em índice único
// não são considerados iguais, o que quebraria o dedup por produto.
export const DEFAULT_TENANT = 'default';

export interface ProductInput {
  store: string;
  storeProductId: string;
  title: string;
  price: number | null;
  oldPrice: number | null;
  discountPct: number | null;
  coupon: string | null;
  imageUrl: string | null;
  category: string | null;
  rating: number | null;
  sales: number | null;
  url: string;
}

const SNAPSHOT_EVERY_MS = 6 * 60 * 60 * 1000;

/** Guarda o preço visto (base anti-desconto-falso), sem repetir o mesmo preço em menos de 6h. */
export async function recordPrice(productId: string, price: number): Promise<void> {
  if (!(price > 0)) return;
  const last = await prisma.priceSnapshot.findFirst({ where: { productId }, orderBy: { createdAt: 'desc' } });
  if (last && Number(last.price) === price && Date.now() - last.createdAt.getTime() < SNAPSHOT_EVERY_MS) return;
  await prisma.priceSnapshot.create({ data: { productId, price } });
}

/** Upsert por loja + id na loja (dedup) e registro do preço. */
export async function upsertProduct(input: ProductInput): Promise<Product> {
  const fields: Omit<Prisma.ProductUncheckedCreateInput, 'store' | 'storeProductId' | 'tenantId' | 'status'> = {
    title: input.title,
    price: input.price ?? 0,
    oldPrice: input.oldPrice,
    discountPct: input.discountPct,
    coupon: input.coupon,
    imageUrl: input.imageUrl,
    // categoria: slug nosso (a loja manda nomes livres); a escolha do admin não é sobrescrita depois
    category: isCategory(input.category) ? input.category : classifyCategory(input.title, input.category),
    rating: input.rating,
    sales: input.sales,
    url: input.url,
  };
  // na atualização, dado que não veio (loja bloqueou, campo ausente) não apaga o que já temos
  const update = Object.fromEntries(
    Object.entries(fields).filter(
      ([k, v]) => k !== 'category' && v !== null && v !== undefined && !(k === 'price' && !(Number(v) > 0)),
    ),
  );
  const product = await prisma.product.upsert({
    where: {
      tenantId_store_storeProductId: {
        tenantId: DEFAULT_TENANT,
        store: input.store,
        storeProductId: input.storeProductId,
      },
    },
    update,
    create: {
      ...fields,
      store: input.store,
      storeProductId: input.storeProductId,
      tenantId: DEFAULT_TENANT,
      status: 'NEW',
    },
  });
  if (input.price) await recordPrice(product.id, input.price);
  return product;
}
