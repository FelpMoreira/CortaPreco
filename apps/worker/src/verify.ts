import { ProviderRegistry } from '@cupons/affiliates';
import { prisma, recordPrice, type Post, type Product } from '@cupons/db';
import { formatBRL } from '@cupons/shared';

const registry = ProviderRegistry.fromEnv(process.env as Record<string, string | undefined>);

/** Subiu mais que isso (2% e R$ 0,50) desde o agendamento → a oferta não vale mais. */
const RISE_PCT = 0.02;
const RISE_MIN = 0.5;
/** API da loja fora do ar: post recente sai assim mesmo (preço ainda deve valer); mais velho espera. */
const TRUST_UNCHECKED_MS = 3 * 3_600_000;
const MAX_CHECK_ERRORS = 3;

export type Verdict =
  | { action: 'send'; message: string; note?: string }
  | { action: 'cancel'; reason: string }
  | { action: 'retry'; reason: string };

/**
 * Confere a oferta na loja logo antes de postar. Só lojas com API de preço (`quote`): AliExpress hoje.
 * Preço subiu além da tolerância ou produto sumiu → cancela; mudou pouco ou caiu → sai com o preço de agora.
 */
export async function verifyBeforePosting(post: Post & { product: Product }): Promise<Verdict> {
  let provider;
  try {
    provider = registry.providerFor(post.product.url);
  } catch {
    return { action: 'send', message: post.message, note: 'loja sem integração: sem conferência' };
  }
  if (!provider.quote) return { action: 'send', message: post.message, note: 'loja sem API de preço: sem conferência' };

  const announced = Number(post.price ?? post.product.price);
  let quote;
  try {
    quote = await provider.quote(post.product.url);
  } catch (err) {
    const reason = `não deu para conferir o preço: ${(err as Error).message}`.slice(0, 300);
    if (Date.now() - post.createdAt.getTime() < TRUST_UNCHECKED_MS) return { action: 'send', message: post.message, note: reason };
    if (post.checkErrors + 1 >= MAX_CHECK_ERRORS) return { action: 'cancel', reason };
    return { action: 'retry', reason };
  }

  if (!quote.available || !quote.price) {
    return { action: 'cancel', reason: 'Oferta expirou: produto indisponível ou fora da promoção na loja' };
  }
  const now = quote.price;
  await recordPrice(post.productId, now);
  await prisma.product.update({ where: { id: post.productId }, data: { price: now, ...(quote.oldPrice ? { oldPrice: quote.oldPrice } : {}) } });

  if (announced > 0 && now > announced * (1 + RISE_PCT) && now - announced >= RISE_MIN) {
    return { action: 'cancel', reason: `Oferta expirou: preço subiu de ${formatBRL(announced)} para ${formatBRL(now)}` };
  }
  if (announced > 0 && Math.abs(now - announced) >= 0.01) {
    // mudou pouco (ou caiu): sai com o valor de agora (se a mensagem editada não tiver o valor, sai como está)
    const message = post.message.replaceAll(formatBRL(announced), formatBRL(now));
    return { action: 'send', message, note: `preço mudou de ${formatBRL(announced)} para ${formatBRL(now)}` };
  }
  return { action: 'send', message: post.message };
}
