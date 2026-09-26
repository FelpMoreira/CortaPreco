// Funções puras do leitor de grupos do Telegram (testáveis sem conta conectada).

export interface MessageLike {
  message?: string | null;
  entities?: Array<{ className?: string; url?: string; offset?: number; length?: number }> | null;
  replyMarkup?: { rows?: Array<{ buttons?: Array<{ url?: string }> }> } | null;
}

const URL_RE = /https?:\/\/[^\s<>"'()]+/gi;
// grupos costumam colar encurtador sem "https://": amzn.to/xyz, shope.ee/abc, meli.la/abc
const BARE_RE = /(?<![\w./-])(amzn\.to|a\.co|shope\.ee|s\.shopee\.com\.br|s\.click\.aliexpress\.com|a\.aliexpress\.com|ali\.ski|meli\.la)\/[^\s<>"'()]+/gi;
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

// resolver/limpar links de loja mora em @cupons/affiliates (o linker usa o mesmo código)
export { canonicalProductUrl, isAllowedHop, resolveLink, SHORTENERS, STORE_HOSTS } from '@cupons/affiliates';
