import type { Store } from '@cupons/shared';
import { AffiliateError, type AffiliateLinkResult, type AffiliateProvider, type ProductData } from './types.js';
import { extractJsonLdProduct, decodeEntities, parseBRL } from './utils.js';

interface AmazonCredentials {
  partnerTag: string;
  marketplace: string;
}

/**
 * Amazon Provider no MVP:
 * - Link: ASIN + `?tag=` (SiteStripe manual — funciona sem API).
 * - Enrich: scrape leve da página (JSON-LD), com fallback no título derivado da URL.
 * - Creators API (exige 10 vendas qualificadas em 30d) é plugável aqui depois.
 */
/**
 * Tenta extrair o título da página quando não há JSON-LD (a Amazon às vezes
 * entrega página "sem dados estruturados"). Ordem: productTitle → og:title →
 * estado JS (`"title"`/`"productTitle"`) → <title>.
 */
function extractProductTitle(html: string): string | null {
  const clean = (s: string): string => decodeEntities(s.replace(/\s+/g, ' ').trim());

  const span = html.match(/<span[^>]+id=["']productTitle["'][^>]*>([\s\S]*?)<\/span>/i)?.[1];
  if (span) return clean(span);

  const meta =
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1];
  if (meta) return clean(meta);

  const jsonTitle = html.match(/"(?:title|productTitle)"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1];
  if (jsonTitle) {
    const unescaped = jsonTitle
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\"/g, '"')
      .replace(/\\\//g, '/');
    return clean(unescaped);
  }

  const titleTag = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1];
  if (titleTag) return clean(titleTag.replace(/:\s*Amazon\.com\.br.*$/i, ''));

  return null;
}

/** Último recurso: deriva um título legível do slug da URL (/nome-do-produto/dp/ASIN). */
function titleFromSlug(url: string): string | null {
  try {
    const path = decodeURIComponent(new URL(url).pathname).split('/').filter(Boolean);
    const asinIdx = path.findIndex(
      (p, i) => /^[A-Z0-9]{10}$/.test(p) && ['dp', 'd', 'gp', 'product'].includes(path[i - 1]?.toLowerCase() ?? ''),
    );
    const seg = asinIdx > 1 ? path[asinIdx - 2]! : path[0] ?? '';
    const title = seg.replace(/-+/g, ' ').trim();
    return title.length > 4 ? title : null;
  } catch {
    return null;
  }
}

export class AmazonProvider implements AffiliateProvider {
  readonly store = 'AMAZON' as Store;

  constructor(private readonly creds: AmazonCredentials) {}

  identify(url: string): boolean {
    let host: string;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      return false;
    }
    return host === 'amazon.com.br' || host.endsWith('.amazon.com.br') || host === 'amazon.com' || host.endsWith('.amazon.com');
  }

  private extractAsin(url: string): string | null {
    // /dp/ASIN, /gp/product/ASIN ou /dp/ASIN?th=1 ; amzn.to é resolvido por redirect
    const m = url.match(/(?:\/dp\/|\/gp\/product\/|\/d\/)([A-Z0-9]{10})/i);
    return m ? m[1]!.toUpperCase() : null;
  }

  private async resolve(url: string): Promise<string> {
    if (/amzn\.to|amzn\.com\//.test(url)) {
      const res = await fetch(url, { redirect: 'follow' });
      return res.url || url;
    }
    return url;
  }

  async affiliateLink(url: string, subId?: string): Promise<AffiliateLinkResult> {
    const resolved = await this.resolve(url);
    const asin = this.extractAsin(resolved);
    if (!asin) {
      throw new AffiliateError(`ASIN não encontrado em ${url}`, 'AMAZON', 'PARSE_URL');
    }
    const u = new URL(`https://${this.creds.marketplace}/dp/${asin}`);
    u.searchParams.set('tag', this.creds.partnerTag);
    return { affiliateUrl: u.toString(), subId: subId ?? 'cupons' };
  }

  async enrich(url: string): Promise<ProductData> {
    const resolved = await this.resolve(url);
    const asin = this.extractAsin(resolved);
    if (!asin) {
      throw new AffiliateError(`ASIN não encontrado em ${url}`, 'AMAZON', 'PARSE_URL');
    }

    let title = `Produto Amazon ${asin}`;
    let price: number | null = null;
    let oldPrice: number | null = null;
    let imageUrl: string | null = null;

    try {
      const res = await fetch(resolved, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
          'Accept-Language': 'pt-BR,pt;q=0.9',
        },
      });
      const html = await res.text();

      const jsonLd = extractJsonLdProduct(html);
      if (typeof jsonLd?.['name'] === 'string') title = jsonLd['name'] as string;
      if (typeof jsonLd?.['image'] === 'string') imageUrl = jsonLd['image'] as string;
      if (typeof jsonLd?.['price'] === 'number') price = jsonLd['price'] as number;

      if (!price) {
        price =
          parseBRL(html.match(/"priceAmount"\s*:\s*"?([\d.,]+)/i)?.[1] ?? '') ??
          parseBRL(html.match(/"priceToPay"\s*:[^}]*?"amount"\s*:\s*"?([\d.,]+)/i)?.[1] ?? '');
      }
      oldPrice = parseBRL(html.match(/"priceAmountOriginal"\s*:\s*"?([\d.,]+)/i)?.[1] ?? '');

      // sem JSON-LD (página bloqueada por bot-check): tenta metadados/estado JS
      if (!jsonLd) title = extractProductTitle(html) ?? title;
    } catch {
      /* segue para os fallbacks abaixo */
    }

    if (title === `Produto Amazon ${asin}`) title = titleFromSlug(resolved) ?? title;

    return {
      storeProductId: asin,
      title,
      price,
      oldPrice,
      discountPct:
        price && oldPrice && oldPrice > price ? Math.round(((oldPrice - price) / oldPrice) * 100) : null,
      coupon: null,
      imageUrl,
      category: null,
      rating: null,
      sales: null,
    };
  }
}