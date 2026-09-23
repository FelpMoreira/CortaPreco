import { createHash } from 'node:crypto';
import type { Store } from '@cupons/shared';
import { AffiliateError, type AffiliateLinkResult, type AffiliateProvider, type ProductData } from './types.js';
import { parseBRL, extractJsonLdProduct, decodeEntities } from './utils.js';

const ENDPOINT = 'https://open-api.affiliate.shopee.com.br/graphql';

interface ShopeeCredentials {
  appId: string;
  appSecret: string;
  subId: string;
}

interface ItemIds {
  shopId: string;
  itemId: string;
}

const generateShortLinkQuery = /* GraphQL */ `
  query GenerateShortLink($input: GenerateShortLinkInput!) {
    generateShortLink(input: $input) {
      shortLink
      urlStatus
      products {
        offerLink
        shortLink
      }
    }
  }
`;

export class ShopeeProvider implements AffiliateProvider {
  readonly store = 'SHOPEE' as Store;

  constructor(private readonly creds: ShopeeCredentials) {}

  identify(url: string): boolean {
    let host: string;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      return false;
    }
    return (
      host === 'shopee.com.br' ||
      host.endsWith('.shopee.com.br') ||
      host === 'shp.ee' ||
      host === 'shopee.com' ||
      host.endsWith('.shopee.com')
    );
  }

  /** Segurança: assinatura sha256(appId + timestamp + body + secret). */
  private sign(timestamp: string, body: string): string {
    const payload = `${this.creds.appId}${timestamp}${body}${this.creds.appSecret}`;
    return createHash('sha256').update(payload, 'utf8').digest('hex');
  }

  private async graphql<T>(
    query: string,
    variables: Record<string, unknown>,
    operation: string,
  ): Promise<T> {
    const body = JSON.stringify({ query, variables });
    const timestamp = String(Date.now());
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `SHA256 Credential=${this.creds.appId}, Timestamp=${timestamp}, Signature=${this.sign(timestamp, body)}`,
      },
      body,
    });

    if (!res.ok) {
      throw new AffiliateError(
        `Shopee API respondeu ${res.status} em ${operation}`,
        'SHOPEE',
        'HTTP_ERROR',
      );
    }

    const json = (await res.json()) as {
      data?: T;
      errors?: { message: string }[];
    };

    if (json.errors?.length) {
      throw new AffiliateError(
        `Shopee GraphQL error (${operation}): ${json.errors.map((e) => e.message).join('; ')}`,
        'SHOPEE',
        'GRAPHQL_ERROR',
      );
    }
    if (!json.data) {
      throw new AffiliateError(`Shopee sem data em ${operation}`, 'SHOPEE', 'NO_DATA');
    }
    return json.data;
  }

  /** Resolve shp.ee/s.shopee.com.br para a URL de produto completa. */
  private async resolveProductUrl(url: string): Promise<string> {
    try {
      const u = new URL(url);
      if (u.hostname === 'shp.ee' || u.hostname === 's.shopee.com.br') {
        const res = await fetch(url, { redirect: 'follow' });
        return res.url || url;
      }
    } catch {
      /* fallback: url original */
    }
    return url;
  }

  private extractIds(productUrl: string): ItemIds {
    // https://www.shopee.com.br/product/{shopId}/{itemId} ou .../-i.{shopId}.{itemId}
    const path = new URL(productUrl).pathname;
    const byPath = path.match(/\/product\/(\d+)\/(\d+)/);
    if (byPath) return { shopId: byPath[1]!, itemId: byPath[2]! };
    const bySlug = path.match(/-i\.(\d+)\.(\d+)/);
    if (bySlug) return { shopId: bySlug[1]!, itemId: bySlug[2]! };
    throw new AffiliateError(`Não consegui extrair shopId/itemId de ${productUrl}`, 'SHOPEE', 'PARSE_URL');
  }

  async affiliateLink(url: string, subId?: string): Promise<AffiliateLinkResult> {
    const productUrl = await this.resolveProductUrl(url);
    const sub = subId ?? this.creds.subId;

    try {
      const data = await this.graphql<{
        generateShortLink: {
          shortLink: string;
          products?: { shortLink?: string; offerLink?: string }[];
        };
      }>(
        generateShortLinkQuery,
        {
          input: {
            originUrl: productUrl,
            subIds: [sub],
          },
        },
        'generateShortLink',
      );

      const generated = data.generateShortLink;
      const affiliateUrl = generated.shortLink || generated.products?.[0]?.shortLink;
      if (!affiliateUrl) {
        throw new AffiliateError('generateShortLink não retornou link', 'SHOPEE', 'EMPTY_LINK');
      }
      return { affiliateUrl, subId: sub };
    } catch (err) {
      if (err instanceof AffiliateError) throw err;
      throw new AffiliateError(
        `Falha ao gerar link Shopee: ${(err as Error).message}`,
        'SHOPEE',
        'GENERIC',
      );
    }
  }

  /**
   * Enriquece dados do produto. Tenta a página do produto (JSON-LD / meta tags);
   * productOfferV2 pode complementar, mas o contrato varia — validação ao conectar
   * credenciais reais (Fase 0).
   */
  async enrich(url: string): Promise<ProductData> {
    const productUrl = await this.resolveProductUrl(url);
    const { shopId, itemId } = this.extractIds(productUrl);

    const res = await fetch(productUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
    });
    const html = await res.text();

    const jsonLd = extractJsonLdProduct(html);
    const ogTitle = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)?.[1];
    const ogImage = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)?.[1];

    const title =
      (typeof jsonLd?.['name'] === 'string' ? decodeEntities(jsonLd['name'] as string) : null) ??
      (ogTitle ? decodeEntities(ogTitle) : null) ??
      `Produto Shopee ${itemId}`;

    const price =
      (typeof jsonLd?.['price'] === 'number' ? (jsonLd['price'] as number) : null) ??
      parseBRL(html.match(/"price"\s*:\s*"?([\d.,]+)/i)?.[1] ?? '');

    const oldPrice = parseBRL(html.match(/"originalPrice"\s*:\s*"?([\d.,]+)/i)?.[1] ?? '');
    const image =
      (typeof jsonLd?.['image'] === 'string' ? (jsonLd['image'] as string) : null) ??
      (ogImage ?? null);

    return {
      storeProductId: `${shopId}.${itemId}`,
      title,
      price,
      oldPrice,
      discountPct:
        price && oldPrice && oldPrice > price
          ? Math.round(((oldPrice - price) / oldPrice) * 100)
          : null,
      coupon: null,
      imageUrl: image,
      category: null,
      rating: null,
      sales: null,
    };
  }
}