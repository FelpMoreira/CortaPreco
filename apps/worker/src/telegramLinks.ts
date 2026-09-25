// Funções puras do leitor de grupos do Telegram (testáveis sem conta conectada).

export interface MessageLike {
  message?: string | null;
  entities?: Array<{ className?: string; url?: string; offset?: number; length?: number }> | null;
  replyMarkup?: { rows?: Array<{ buttons?: Array<{ url?: string }> }> } | null;
}

const URL_RE = /https?:\/\/[^\s<>"'()]+/gi;
// grupos costumam colar encurtador sem "https://": amzn.to/xyz, shope.ee/abc
const BARE_RE = /(?<![\w./-])(amzn\.to|a\.co|shope\.ee|s\.shopee\.com\.br|s\.click\.aliexpress\.com|a\.aliexpress\.com|ali\.ski)\/[^\s<>"'()]+/gi;
const HOST_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

/** Todos os links da mensagem: no texto, escondidos em palavras (TextUrl) e em botões. */
export function extractLinks(msg: MessageLike): string[] {
  const out = new Set<string>();
  const text = msg.message ?? '';
  const trim = (u: string) => u.replace(/[.,;:!?…]+$/, '');
  for (const m of text.matchAll(URL_RE)) out.add(trim(m[0]));
  for (const m of text.matchAll(BARE_RE)) out.add(`https://${trim(m[0])}`);
  for (const e of msg.entities ?? []) {
    if (e.url) out.add(e.url);
    // MessageEntityUrl: o link é o próprio trecho do texto
    if (e.className === 'MessageEntityUrl' && e.offset !== undefined && e.length) {
      const piece = text.slice(e.offset, e.offset + e.length);
      out.add(/^https?:\/\//i.test(piece) ? piece : `https://${piece}`);
    }
  }
  for (const row of msg.replyMarkup?.rows ?? []) for (const b of row.buttons ?? []) if (b.url) out.add(b.url);
  return [...out].filter((u) => {
    try {
      return HOST_RE.test(new URL(u).hostname);
    } catch {
      return false;
    }
  });
}

/** Encurtadores comuns em grupos de oferta: precisam ser seguidos para achar a loja. */
export const SHORTENERS = /(^|\.)(amzn\.to|a\.co|amzn\.eu|shope\.ee|s\.shopee\.com\.br|s\.click\.aliexpress\.com|a\.aliexpress\.com|bit\.ly|tinyurl\.com|cutt\.ly|encurtador\.com\.br|compre\.vc|ali\.ski)$/i;

/**
 * URL do produto sem o rastreio de quem postou (afiliado/tag/sub-id deles).
 * O link de afiliado é gerado depois, com o NOSSO tracking.
 */
export function canonicalProductUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (/amazon\.com(\.br)?$/.test(host)) {
    const asin = u.pathname.match(/\/(?:dp|gp\/product|d)\/([A-Z0-9]{10})/i)?.[1];
    return asin ? `https://www.amazon.com.br/dp/${asin.toUpperCase()}` : null;
  }
  if (/aliexpress\.(com|us)(\.br)?$/.test(host)) {
    const id = u.pathname.match(/\/item\/(?:[^/]*?)(\d{10,})\.html/)?.[1];
    return id ? `https://pt.aliexpress.com/item/${id}.html` : null;
  }
  if (/shopee\.com(\.br)?$/.test(host)) {
    const ids = u.pathname.match(/\/product\/(\d+)\/(\d+)/) ?? u.pathname.match(/-i\.(\d+)\.(\d+)/);
    return ids ? `https://shopee.com.br/product/${ids[1]}/${ids[2]}` : null;
  }
  return null;
}
