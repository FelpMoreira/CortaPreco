/** Helpers comuns aos providers. */

export function parseBRL(text: string): number | null {
  const m = text.replace(/\s/g, '').match(/(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}|\d+)/);
  if (!m) return null;
  const cleaned = m[1]!.replace(/\./g, '').replace(',', '.');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

const ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|#39);/g, (m) => ENTITY_MAP[m] ?? m);
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