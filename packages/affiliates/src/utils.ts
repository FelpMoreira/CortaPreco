/** Helpers comuns aos providers. */

/**
 * Lê um preço em qualquer um dos formatos que as lojas mandam:
 * - BRL de texto: "R$ 1.299,90", "29,99"
 * - número de JSON: "29.99", "1299.9", "839"
 * Ponto seguido de exatamente 3 dígitos é milhar ("1.299" = 1299); com 1–2 dígitos é decimal.
 */
export function parseBRL(text: string): number | null {
  const token = text.replace(/\s/g, '').match(/\d[\d.,]*/)?.[0]?.replace(/[.,]+$/, '');
  if (!token) return null;
  let normalized: string;
  if (token.includes(',')) normalized = token.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(token)) normalized = token.replace(/\./g, '');
  else normalized = token;
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

const ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Decodifica entidades HTML nomeadas comuns e numéricas (&#34; &#x22;). */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITY_MAP[e.toLowerCase()] ?? m;
  });
}

/** Tenta extrair JSON-LD (schema.org Product) de uma página. */
export function extractJsonLdProduct(html: string): Record<string, unknown> | null {
  const blocks = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
  if (!blocks) return null;
  for (const block of blocks) {
    const raw = (block.match(/>([\s\S]*?)<\/script>/i)?.[1] ?? '').trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      for (const c of candidates) {
        const product =
          c['@type'] === 'Product' || (Array.isArray(c['@type']) && c['@type']!.includes('Product'))
            ? c
            : c['mainEntity'] ?? c['itemListElement'];
        if (!product) continue;
        const price = product['offers']?.['price'] ?? product['offers']?.[0]?.price;
        return {
          name: product['name'],
          image: Array.isArray(product['image'])
            ? product['image'][0]
            : product['image'],
          price: typeof price === 'number' ? price : price != null ? Number(price) : null,
        };
      }
    } catch {
      /* ignora blocos inválidos */
    }
  }
  return null;
}