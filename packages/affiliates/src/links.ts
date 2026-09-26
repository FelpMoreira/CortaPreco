// Links de lojas vindos de terceiros (grupos do Telegram): resolver encurtadores com segurança e
// chegar na URL do produto sem o rastreio de quem postou. Usado pelo worker (fontes e ouvinte do
// espelhamento) e pelo linker (espelhamento). Funções puras, exceto `resolveLink` (rede).

/** Encurtadores comuns em grupos de oferta: precisam ser seguidos para achar a loja. */
export const SHORTENERS = /(^|\.)(amzn\.to|a\.co|amzn\.eu|shope\.ee|s\.shopee\.com\.br|s\.click\.aliexpress\.com|a\.aliexpress\.com|bit\.ly|tinyurl\.com|cutt\.ly|encurtador\.com\.br|compre\.vc|ali\.ski)$/i;

/** Domínios das lojas: ao chegar num deles, o link está resolvido (não baixamos a página aqui). */
export const STORE_HOSTS = /(^|\.)(amazon\.com(\.br)?|aliexpress\.(com|us)|shopee\.com\.br)$/i;

/**
 * Cada salto de um link vindo de outro grupo precisa ser http(s) na porta padrão, sem usuário/senha,
 * e cair num encurtador conhecido ou numa loja. Bloqueia SSRF: um bit.ly apontando para
 * `http://api:3001/...` ou `169.254.169.254` morre aqui, antes de qualquer requisição.
 */
export function isAllowedHop(u: URL): boolean {
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  if (u.username || u.password || u.port) return false;
  const host = u.hostname.toLowerCase();
  return SHORTENERS.test(host) || STORE_HOSTS.test(host);
}

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

const MAX_HOPS = 5;
const HOP_TIMEOUT_MS = 8_000;

/**
 * Segue encurtadores até a página da loja, um salto por vez (`redirect: 'manual'`), conferindo
 * cada destino com `isAllowedHop` antes de requisitar. Nunca baixa a página da loja.
 */
export async function resolveLink(url: string): Promise<string> {
  let current = new URL(url);
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    if (!isAllowedHop(current)) throw new Error(`destino não permitido: ${current.hostname}`);
    if (!SHORTENERS.test(current.hostname)) return current.href; // chegou na loja
    const res = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(HOP_TIMEOUT_MS) });
    await res.body?.cancel().catch(() => undefined);
    const location = res.headers.get('location');
    if (res.status < 300 || res.status >= 400 || !location) return current.href;
    current = new URL(location, current);
  }
  throw new Error('redirecionamentos demais');
}
