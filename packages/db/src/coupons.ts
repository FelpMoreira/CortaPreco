import type { Coupon } from '@prisma/client';
import { prisma } from './client.js';

/**
 * Cupom do grupo de cupons que vai JUNTO do post de um produto (cofre/11):
 *  - mesma loja, marcado como geral (`attachable`), não vencido nem marcado inválido;
 *  - Mercado Livre: só VALID (testado na conta de afiliado); outras lojas: NEW visto nas últimas 24 h;
 *  - compra mínima ≤ preço do produto;
 *  - entre os que servem, o de maior desconto efetivo nesse preço (respeitando o teto).
 */
const UNTESTED_FRESH_MS = 24 * 3_600_000;

export function couponSavings(c: Pick<Coupon, 'discountPct' | 'discountValue' | 'maxDiscount'>, price: number): number {
  let v = c.discountPct ? (price * c.discountPct) / 100 : Number(c.discountValue ?? 0);
  if (c.maxDiscount) v = Math.min(v, Number(c.maxDiscount));
  return v;
}

export async function bestCouponFor(store: string, price: number, now = new Date()): Promise<Coupon | null> {
  const candidates = await prisma.coupon.findMany({
    where: {
      store,
      attachable: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      AND: [
        store === 'MERCADOLIVRE'
          ? { status: 'VALID' }
          : { OR: [{ status: 'VALID' }, { status: 'NEW', lastSeenAt: { gte: new Date(now.getTime() - UNTESTED_FRESH_MS) } }] },
        { OR: [{ minPurchase: null }, { minPurchase: { lte: price } }] },
      ],
    },
  });
  let best: Coupon | null = null;
  for (const c of candidates) if (couponSavings(c, price) > (best ? couponSavings(best, price) : 0)) best = c;
  return best;
}

/** Linha do post: "TODOSITE10 (10% OFF, até R$ 15)". */
export function couponLine(c: Pick<Coupon, 'code' | 'discountPct' | 'discountValue' | 'maxDiscount'>): string {
  const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: v % 1 ? 2 : 0 });
  const off = c.discountPct ? `${c.discountPct}% OFF` : c.discountValue ? `${brl(Number(c.discountValue))} OFF` : '';
  const cap = c.maxDiscount ? `até ${brl(Number(c.maxDiscount))}` : '';
  const extra = [off, cap].filter(Boolean).join(', ');
  return extra ? `${c.code} (${extra})` : c.code;
}

/** Marca o uso (métrica "usado em N posts" do painel). */
export async function markCouponUsed(id: string): Promise<void> {
  await prisma.coupon.update({ where: { id }, data: { usedInPosts: { increment: 1 } } }).catch(() => undefined);
}
