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
    } catch {
      // descobre título via slug da URL
      const slug = new URL(resolved).pathname.split('/').filter(Boolean)[0] ?? '';
      if (slug) title = decodeEntities(slug.split('-').join(' '));
    }

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