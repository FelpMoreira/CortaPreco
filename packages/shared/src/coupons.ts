/**
 * Cupom numa mensagem de grupo de ofertas (espelhamento). Só o CÓDIGO (ou o valor do cupom de página) vai
 * para o nosso post — o texto de quem postou nunca é copiado.
 *
 * Calibrado em 2026-09-26 com mensagens reais de canais públicos de ofertas:
 *  - o código quase sempre vem em monoespaçado (entidade `code` do Telegram, "toque para copiar"):
 *    "🎟 Use o cupom: `TECH200`", "🎟 Cupom: `BATEUAQUI`", "Use o Cupom no aplicativo: `CUPOMGRANADO`";
 *  - às vezes só no texto: "Cupom: MELI15", "use o cupom DECOR20";
 *  - cupom sem código, para resgatar/ativar na página: "Cupom de 20% para resgatar no Mercado Livre".
 */

export interface CouponInput {
  /** texto completo da mensagem */
  text: string;
  /** trechos em monoespaçado (entidades code/pre do Telegram), na ordem da mensagem */
  codeSpans?: string[];
}

export interface CouponFound {
  /** códigos na ordem em que aparecem (sem repetição) */
  codes: string[];
  /** cupom de página sem código, ex.: "20% OFF" / "R$ 30 OFF" */
  pageCoupon: string | null;
  /** o que vai no post ("🎟️ Cupom: …"): até 2 códigos, ou o cupom de página; null = sem cupom */
  display: string | null;
}

const COUPON_WORD = /cupo[mn]|c[óo]digo/i;
const CODE_SHAPE = /^[A-Z0-9][A-Z0-9_-]{2,24}$/i;
/** palavras que aparecem depois de "cupom:" e não são código */
const NOT_CODES = new Set([
  'ABAIXO', 'ACIMA', 'AQUI', 'APP', 'APLICATIVO', 'DESCONTO', 'DESCONTOS', 'EXCLUSIVO', 'GRATIS', 'GRÁTIS', 'HOJE', 'LINK',
  'LOJA', 'NOVO', 'OFF', 'PAGINA', 'PÁGINA', 'PRODUTO', 'SITE', 'VALIDO', 'VÁLIDO', 'AMAZON', 'SHOPEE', 'ALIEXPRESS',
  'MERCADO', 'LIVRE', 'MELI', 'NA', 'NO', 'DE', 'DO', 'DA', 'PARA', 'COM',
]);

function asCode(raw: string): string | null {
  const c = raw.replace(/\s+/g, '').replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9_-]+$/g, '');
  if (!CODE_SHAPE.test(c) || !/[A-Za-z]/.test(c)) return null; // só número = preço/quantidade, não código
  if (/^https?|\.(com|br|la|to)\b/i.test(c)) return null;
  if (NOT_CODES.has(c.toUpperCase())) return null;
  return c.toUpperCase();
}

export function extractCoupon({ text, codeSpans = [] }: CouponInput): CouponFound {
  const codes: string[] = [];
  const add = (c: string | null) => {
    if (c && !codes.includes(c)) codes.push(c);
  };

  if (COUPON_WORD.test(text)) {
    // 1) monoespaçado: sinal mais forte (é assim que os grupos deixam o código copiável)
    for (const span of codeSpans) add(asCode(span));
    // 2) sem monoespaçado: no texto, em MAIÚSCULAS no original, e só em forma de instrução —
    //    "Cupom: MELI15", "Use o cupom no app: X" ou "use o cupom DECOR20". Título em caixa-alta
    //    ("CUPOM ESPORTES!!!") e "use o cupom abaixo" não viram código.
    if (codes.length === 0) {
      const forms = [
        /(?:cupo[mn]|c[óo]digo)[^\n:：]{0,25}?[:：]\s*([A-Z0-9][A-Z0-9_-]{2,24})\b/gi,
        /\b(?:use|usar|aplique|aplicar|insira|digite|com)\s+o\s+cupo[mn]\s+([A-Z0-9][A-Z0-9_-]{2,24})\b/gi,
      ];
      for (const re of forms) {
        for (const m of text.matchAll(re)) {
          const token = m[1]!;
          if (token === token.toUpperCase()) add(asCode(token));
        }
      }
    }
  }

  // 3) cupom de página, sem código: "cupom de 20%", "cupom de R$ 30" (resgatar/ativar na página)
  let pageCoupon: string | null = null;
  const value = text.match(/cupo[mn]\s+(?:de\s+)?(R\$\s?\d{1,4}(?:[.,]\d{2})?|\d{1,2}\s?%)/i)?.[1];
  if (value) pageCoupon = `${value.replace(/\s+/g, ' ').replace(/R\$\s?/i, 'R$ ').toUpperCase()} OFF`;

  const display = codes.length ? codes.slice(0, 2).join(' ou ') : pageCoupon ? `${pageCoupon} (resgate na página)` : null;
  return { codes, pageCoupon, display };
}

// ============================================================================================
// Grupo de CUPONS: cada código com loja, desconto, mínimo, teto, escopo e link.
// Calibrado em 2026-09-26 com mensagens reais de canais de cupons, ex.:
//   "🎟️ ESPORTEMELIXP\n15% OFF acima de R$799 máx R$130"
//   "🎟️ DECOR20\n20% OFF acima de R$119 máx R$35 em Decoração & Eletros\nNa lista: https://meli.la/…"
//   "🎟️ TODOSITE2509 - R$25/219"        (R$ 25 OFF em compras a partir de R$ 219)
//   "App todo (ou maior parte dele):\n\n🎟️ TODOSITE10\n10% acima de R$99 máx R$15"
// ============================================================================================

export type CouponStore = 'MERCADOLIVRE' | 'AMAZON' | 'SHOPEE' | 'ALIEXPRESS';

export interface ParsedCoupon {
  store: CouponStore;
  code: string;
  discountPct: number | null;
  discountValue: number | null;
  minPurchase: number | null;
  maxDiscount: number | null;
  /** "Decoração & Eletros", "Moda & Bem-Estar"… (cupom restrito a uma parte da loja) */
  scope: string | null;
  /** vale para a loja toda ("todo o site", "app todo") → pode ir junto dos posts de produto */
  general: boolean;
  /** link que veio com o cupom (lista de produtos ou página de resgate) */
  link: string | null;
}

const STORE_WORDS: [CouponStore, RegExp][] = [
  ['MERCADOLIVRE', /mercado\s*livr|#mercadolivre|\bmeli\b/i],
  ['AMAZON', /amazon/i],
  ['SHOPEE', /shopee/i],
  ['ALIEXPRESS', /aliexpress|\bali\s?express\b/i],
];
const STORE_HOSTS_RE: [CouponStore, RegExp][] = [
  ['MERCADOLIVRE', /(^|\.)(meli\.la|mercadolivre\.com(\.br)?|mercadolibre\.com)$/i],
  ['AMAZON', /(^|\.)(amzn\.to|a\.co|amazon\.com\.br)$/i],
  ['SHOPEE', /(^|\.)(shope\.ee|shopee\.com\.br)$/i],
  ['ALIEXPRESS', /(^|\.)(aliexpress\.(com|us)|s\.click\.aliexpress\.com|a\.aliexpress\.com)$/i],
];

const money = (s: string | undefined): number | null => {
  if (!s) return null;
  const v = Number(s.replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
  return Number.isFinite(v) && v > 0 ? v : null;
};

function hostStore(url: string): CouponStore | null {
  try {
    const host = new URL(url).hostname;
    return STORE_HOSTS_RE.find(([, re]) => re.test(host))?.[0] ?? null;
  } catch {
    return null;
  }
}

/** Lojas citadas num trecho (palavras e links). */
function storesIn(text: string, links: string[]): Set<CouponStore> {
  const out = new Set<CouponStore>();
  for (const [store, re] of STORE_WORDS) if (re.test(text)) out.add(store);
  for (const l of links) {
    const s = hostStore(l);
    if (s) out.add(s);
  }
  return out;
}

const URL_IN_TEXT = /https?:\/\/[^\s<>"')]+/g;
const GENERAL = /todo o site|site todo|app todo|todo o app|todos os produtos|qualquer produto|loja toda|toda a loja/i;

/**
 * Cupons de uma mensagem de grupo de cupons. `codeSpans` = trechos em monoespaçado (entidades code/pre).
 * Loja: pelo bloco do cupom, senão pela mensagem (título/hashtag/links); loja fora das 4 → ignorado.
 */
export function parseCouponMessage({ text, codeSpans = [], links = [] }: CouponInput & { links?: string[] }): ParsedCoupon[] {
  const { codes } = extractCoupon({ text, codeSpans });
  if (!codes.length) return [];
  const lines = text.split('\n');
  const allLinks = [...new Set([...links, ...(text.match(URL_IN_TEXT) ?? [])])];
  const messageStores = storesIn(text, allLinks);
  const upper = lines.map((l) => l.toUpperCase());
  const codeLine = (code: string) => upper.findIndex((l) => new RegExp(`(^|[^A-Z0-9])${code}([^A-Z0-9]|$)`).test(l));

  const out: ParsedCoupon[] = [];
  const starts = codes.map(codeLine);
  const header = lines.slice(0, 2).join('\n');
  codes.forEach((code, i) => {
    const at = starts[i]!;
    if (at < 0) return;
    // bloco do cupom: da linha do código até a próxima linha de código (ou 3 linhas), parando em linha vazia
    const nextStart = Math.min(...starts.filter((s) => s > at), lines.length);
    const block: string[] = [lines[at]!.slice(lines[at]!.toUpperCase().indexOf(code) + code.length)];
    for (let j = at + 1; j < Math.min(nextStart, at + 4); j++) {
      if (!lines[j]!.trim()) break;
      block.push(lines[j]!);
    }
    const blockText = block.join('\n');
    const blockLinks = blockText.match(URL_IN_TEXT) ?? [];
    // link fora do bloco ("👇 RESGATE APENAS AQUI:\nhttps://…"): o primeiro link da loja DEPOIS do código
    const codeOffset = lines.slice(0, at).join('\n').length;
    const linkAfter = (s: CouponStore) =>
      [...text.matchAll(URL_IN_TEXT)].find((m) => (m.index ?? 0) > codeOffset && hostStore(m[0]) === s)?.[0] ?? null;
    // contexto acima (cabeçalho "App todo…", "CUPOM MERCADO LIVRE") ajuda a decidir loja e alcance
    const above = lines.slice(Math.max(0, at - 3), at).join('\n');

    const blockStores = storesIn(blockText, blockLinks);
    const store = blockStores.size === 1 ? [...blockStores][0]! : messageStores.size === 1 ? [...messageStores][0]! : null;
    if (!store) return;

    const compact = blockText.match(/R\$\s?(\d+(?:[.,]\d+)?)\s*\/\s*R?\$?\s?(\d+(?:[.,]\d+)?)/); // "R$25/219"
    const pct = Number(blockText.match(/(\d{1,2})\s?%/)?.[1]);
    const value = compact ? money(compact[1]) : money(blockText.match(/R\$\s?(\d+(?:[.,]\d+)?)\s*(?:OFF|de desconto)/i)?.[1]);
    const min = compact
      ? money(compact[2])
      : money(blockText.match(/(?:acima|a partir|compras?\s+(?:acima|a partir)|m[ií]nim[oa])\s*(?:de\s*)?R\$\s?(\d+(?:[.,]\d+)?)/i)?.[1]);
    const max = money(blockText.match(/(?:m[áa]x\.?|limit(?:e|ado)\s+(?:de|a)|at[ée])\s*R\$\s?(\d+(?:[.,]\d+)?)/i)?.[1]);
    // "… em Decoração & Eletros" / "R$200 OFF em Celular, PC, TECH" (sem os links do bloco)
    //    corta antes das condições ("em Moda acima de R$99" → "Moda"); "em todo o site" não é escopo, é geral
    const rawScope = blockText.replace(URL_IN_TEXT, '').match(/\bem\s+([^\n!:]{3,60}?)\s*(?:[!.]|\n|$)/i)?.[1] ?? '';
    const cut = rawScope.split(/\s+(?:acima|a partir|m[áa]x|at[ée]|limit|R\$|para compras)/i)[0]!.trim();
    const scope = cut.length >= 3 && !GENERAL.test(cut) ? cut : null;

    out.push({
      store,
      code,
      discountPct: Number.isFinite(pct) && pct > 0 ? pct : null,
      discountValue: value,
      minPurchase: min,
      maxDiscount: max,
      scope,
      // geral: cabeçalho da mensagem ("CUPONS APP TODO"), linhas acima ("App todo:") ou o próprio bloco/código
      general:
        !scope && (GENERAL.test(header) || GENERAL.test(above) || GENERAL.test(blockText) || /SITE|TODOAPP|APPTODO/.test(code)),
      link: blockLinks.find((l) => hostStore(l) === store) ?? linkAfter(store),
    });
  });
  return out;
}

/** Resumo do cupom para humanos: "15% OFF acima de R$ 799 (máx. R$ 130) · Decoração & Eletros". */
export function couponSummary(c: Pick<ParsedCoupon, 'discountPct' | 'discountValue' | 'minPurchase' | 'maxDiscount' | 'scope'>): string {
  const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: v % 1 ? 2 : 0 });
  const parts: string[] = [];
  if (c.discountPct) parts.push(`${c.discountPct}% OFF`);
  else if (c.discountValue) parts.push(`${brl(c.discountValue)} OFF`);
  if (c.minPurchase && c.minPurchase > 1) parts.push(`acima de ${brl(c.minPurchase)}`);
  let s = parts.join(' ');
  if (c.maxDiscount) s += ` (máx. ${brl(c.maxDiscount)})`;
  if (c.scope) s += ` · ${c.scope}`;
  return s.trim() || 'cupom';
}
