import type { MessageInput, Store } from './types.js';

export const STORE_LABELS: Record<Store, string> = {
  SHOPEE: 'Shopee',
  ALIEXPRESS: 'AliExpress',
  AMAZON: 'Amazon',
};

const brl = (v: number): string =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const storeEmoji: Record<Store, string> = {
  SHOPEE: '🛒',
  ALIEXPRESS: '📦',
  AMAZON: '🛍️',
};

/**
 * Template determinístico de mensagem. Sem LLM no MVP — valores sempre vêm do
 * banco (nada é inventado), fica fácil plugar IA nesse mesmo renderer depois.
 */
export function renderMessage(input: MessageInput): string {
  const lines: string[] = [];

  lines.push(`🔥 SUPER OFERTA ${storeEmoji[input.store]}`);
  lines.push('');
  lines.push(`📍 ${input.title}`);
  lines.push('');

  if (input.oldPrice && input.oldPrice > input.price) {
    const pct =
      input.discountPct ??
      Math.round(((input.oldPrice - input.price) / input.oldPrice) * 100);
    lines.push(`💵 De ${brl(input.oldPrice)} por ${brl(input.price)} (-${pct}%)`);
  } else {
    lines.push(`💵 ${brl(input.price)}`);
  }

  if (input.coupon) {
    lines.push(`🏷️ Cupom: ${input.coupon}`);
  }

  lines.push('');
  lines.push(`🛒 ${input.affiliateUrl}`);
  lines.push('');
  lines.push('👉 Aproveite antes que acabe!');

  return lines.join('\n');
}

/** Formata moeda BRL no padrão pt-BR. */
export function formatBRL(v: number): string {
  return brl(v);
}