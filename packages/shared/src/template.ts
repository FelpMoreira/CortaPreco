import type { MessageInput, Store } from './types.js';

export const STORE_LABELS: Record<Store, string> = {
  SHOPEE: 'Shopee',
  ALIEXPRESS: 'AliExpress',
  AMAZON: 'Amazon',
  MERCADOLIVRE: 'Mercado Livre',
};

// "ACHADO NA AMAZON" / "ACHADO NO MERCADO LIVRE"
const storeArticle: Record<Store, 'NA' | 'NO'> = {
  SHOPEE: 'NA',
  ALIEXPRESS: 'NA',
  AMAZON: 'NA',
  MERCADOLIVRE: 'NO',
};

const brl = (v: number): string =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const storeEmoji: Record<Store, string> = {
  SHOPEE: '🛒',
  ALIEXPRESS: '📦',
  AMAZON: '🛍️',
  MERCADOLIVRE: '🤝',
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

  const hasDiscount = !!input.oldPrice && input.oldPrice > input.price;
  const store = STORE_LABELS[input.store].toUpperCase();
  // só chama de oferta o que tem desconto de verdade; o resto é "achado"
  lines.push(`${storeEmoji[input.store]} <b>${hasDiscount ? `OFERTA ${store}` : `ACHADO ${storeArticle[input.store]} ${store}`}</b>`);
  lines.push('');
  lines.push(`<b>${er(input.title)}</b>`);
  if (input.hook) lines.push(`<i>${er(input.hook)}</i>`);
  lines.push('');

  if (hasDiscount && input.oldPrice) {
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
/** Dados de um cupom para o post do canal de cupons (cofre/11). */
export interface CouponMessageInput {
  store: Store;
  code: string;
  title: string;
  minPurchase: number | null;
  maxDiscount: number | null;
  scope: string | null;
  expiresAt: Date | null;
}

/**
 * Post de cupom: código em monoespaçado (no Telegram, toque = copiar). Sem link de terceiros: os links
 * que vêm no grupo de cupons são do afiliado que postou (a comissão iria para ele).
 */
export function renderCouponHtml(c: CouponMessageInput): string {
  const store = STORE_LABELS[c.store].toUpperCase();
  const lines = [`🎟️ <b>CUPOM ${store}</b>`, '', `<b>${er(c.title)}</b>`, `Código: <code>${er(c.code)}</code>`];
  const conds: string[] = [];
  if (c.minPurchase && c.minPurchase > 1) conds.push(`compra mínima ${brl(c.minPurchase)}`);
  if (c.maxDiscount) conds.push(`desconto até ${brl(c.maxDiscount)}`);
  if (conds.length) lines.push(conds.join(' · ').replace(/^./, (x) => x.toUpperCase()));
  if (c.scope) lines.push(`Vale em: ${er(c.scope)}`);
  if (c.expiresAt) {
    const when = c.expiresAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    lines.push(`⏰ Válido até ${when.replace(',', ' às')}`);
  }
  lines.push('', `Use no carrinho ou no app ${c.store === 'SHOPEE' || c.store === 'AMAZON' ? 'da' : 'do'} ${STORE_LABELS[c.store]}.`);
  lines.push('', '📌 Anúncio | Cupons podem acabar a qualquer momento');
  return lines.join('\n');
}
