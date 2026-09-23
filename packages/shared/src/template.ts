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

const er = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Escapa texto para o parse_mode HTML do Telegram. */
export const escapeHtml = er;

/**
 * Marcador do link na mensagem. O link final (redirector `/c/{postId}`) só existe
 * depois que o post é criado, então preview e override usam o marcador e o
 * agendamento substitui.
 */
export const LINK_PLACEHOLDER = '{link}';

function buildLines(input: MessageInput): string[] {
  const lines: string[] = [];

  lines.push(`${storeEmoji[input.store]} <b>OFERTA ${STORE_LABELS[input.store].toUpperCase()}</b>`);
  lines.push('');
  lines.push(`<b>${er(input.title)}</b>`);
  lines.push('');

  if (input.oldPrice && input.oldPrice > input.price) {
    const pct =
      input.discountPct ??
      Math.round(((input.oldPrice - input.price) / input.oldPrice) * 100);
    lines.push(`De <s>${brl(input.oldPrice)}</s>  (-${pct}% 🎯)`);
    lines.push(`<b>Por ${brl(input.price)}</b>`);
  } else {
    lines.push(`<b>💵 ${brl(input.price)}</b>`);
  }

  if (input.coupon) {
    lines.push('');
    lines.push(`🎟️ Cupom: <b>${er(input.coupon)}</b>`);
  }

  lines.push('');
  lines.push('🛒 Link para compra:');
  lines.push(er(input.affiliateUrl));

  lines.push('');
  lines.push('📌 Anúncio | Preços podem subir rapidamente');

  return lines;
}

/**
 * Template determinístico de mensagem. Sem LLM no MVP — valores sempre vêm do
 * banco (nada é inventado), fica fácil plugar IA nesse mesmo renderer depois.
 * Retorna texto plano (para preview/painel).
 */
export function renderMessage(input: MessageInput): string {
  return buildLines(input).join('\n');
}

/** Versão para envio no Telegram (parse_mode HTML): preço antigo riscado etc. */
export function renderMessageHtml(input: MessageInput): string {
  return buildLines(input).join('\n');
}

/** Formata moeda BRL no padrão pt-BR. */
export function formatBRL(v: number): string {
  return brl(v);
}