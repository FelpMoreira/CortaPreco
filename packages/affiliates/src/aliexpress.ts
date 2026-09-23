import { createHmac } from 'node:crypto';
import type { Store } from '@cupons/shared';
import { AffiliateError, type AffiliateLinkResult, type AffiliateProvider, type ProductData } from './types.js';
import { extractJsonLdProduct } from './utils.js';

const ENDPOINT = 'https://api-sg.aliexpress.com/sync';

interface AliExpressCredentials {
  appKey: string;
  appSecret: string;
  trackingId: string;
}

/**
 * Cliente TOP API (Open Platform do AliExpress).
 *
 * Assinatura oficial: HMAC-SHA256(secret, stringToSign) em HEX maíúsculo, onde
 * stringToSign = concatenação de `chave+valor` dos parâmetros ordenados por chave
 * (excluindo `sign`).
 *
 * NOTA: o contrato exato de `promotionLinks`/`productdetail.get` muda com o tempo;
 * validar com credenciais reais na Fase 0 (o scaffold já isola tudo aqui).
 */
export class AliExpressProvider implements AffiliateProvider {
  readonly store = 'ALIEXPRESS' as Store;

  constructor(private readonly creds: AliExpressCredentials) {}

  identify(url: string): boolean {
    let host: string;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      return false;
    }
    return (
      host === 'aliexpress.com' ||
      host === 'aliexpress.com.br' ||
      host.endsWith('.aliexpress.com') ||
      host.endsWith('.aliexpress.com.br') ||
      host.endsWith('.alipay.com') // links antigos
    );
  }

  private async call(method: string, business: Record<string, unknown>): Promise<unknown> {
    const now = new Date();
    const system: Record<string, string> = {
      method,
      app_key: this.creds.appKey,
      sign_method: 'sha256',
      format: 'json',
      timestamp: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    };

    const allParams: Record<string, string> = { ...system };
    for (const [k, v] of Object.entries(business)) {
      allParams[k] = typeof v === 'string' ? v : JSON.stringify(v);
    }

    const sorted = Object.keys(allParams)
      .sort()
      .map((k) => `${k}${allParams[k]}`)
      .join('');
    const sign = createHmac('sha256', this.creds.appSecret).update(sorted).digest('hex').toUpperCase();

    const query = new URLSearchParams({ ...system, sign }).toString();
    const res = await fetch(`${ENDPOINT}?${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(allParams).toString(),
    });

    if (!res.ok) {
      throw new AffiliateError(`AliExpress API ${res.status} em ${method}`, 'ALIEXPRESS', 'HTTP_ERROR');
    }

    const json = (await res.json()) as Record<string, unknown>;
    const response = json[`${method}_response`] as { result?: unknown; code?: number; msg?: string } | undefined;
    if (response?.code && Number(response.code) !== 0) {
      throw new AffiliateError(
        `AliExpress erro ${response.code}: ${response.msg ?? 'sem mensagem'}`,
        'ALIEXPRESS',
        'API_ERROR',
      );
    }
    return response?.result ?? json;
  }

  private extractItemId(url: string): string {
    const m = url.match(/\/item\/(?:-|item-)?(\d+)\.html/);
    if (m) return m[1]!;
    const q = new URL(url).pathname.match(/(\d{10,})/);
    if (q) return q[1]!;
    throw new AffiliateError(`Item ID não encontrado em ${url}`, 'ALIEXPRESS', 'PARSE_URL');
  }

  async affiliateLink(url: string, subId?: string): Promise<AffiliateLinkResult> {
    const sub = subId ?? 'cupons';
    const itemId = this.extractItemId(url);

    try {
      const result = (await this.call('aliexpress.affiliate.link.generate', {
        promotionLinks: [
          {
            sourceValues: [url],
            trackingId: this.creds.trackingId,
            promotionLinkType: 'SHORT_LINK',
            subIds: [sub],
          },
        ],
      })) as { promotionLinks?: { promotionLink?: string }[] };

      const affiliateUrl = result.promotionLinks?.[0]?.promotionLink;
      if (!affiliateUrl) {
        // Se a API não retornar link, monta via promo a partir do itemId
        throw new AffiliateError(
          `Nenhum link gerado para item ${itemId}. Validar payload na Fase 0.`,
          'ALIEXPRESS',
          'EMPTY_LINK',
        );
      }
      return { affiliateUrl, subId: sub };
    } catch (err) {
      if (err instanceof AffiliateError) throw err;
      throw new AffiliateError(`Falha ao gerar link AliExpress: ${(err as Error).message}`, 'ALIEXPRESS', 'GENERIC');
    }
  }

  async enrich(url: string): Promise<ProductData> {
    const itemId = this.extractItemId(url);

    try {
      const result = (await this.call('aliexpress.affiliate.productdetail.get', {
        itemIds: [itemId],
        fields: ['subject', 'item_url', 'productMainImage', 'target_app_sale_price', 'sale_price', 'sale_price_currency'],
      })) as { products?: Array<Record<string, unknown>> };

      const p = result.products?.[0];
      if (p) {
        const price = Number(p['target_app_sale_price'] ?? p['sale_price'] ?? NaN);
        return {
          storeProductId: itemId,
          title: String(p['subject'] ?? `Produto AliExpress ${itemId}`),
          price: Number.isFinite(price) ? price : null,
          oldPrice: null,
          discountPct: null,
          coupon: null,
          imageUrl: p['productMainImage'] ? String(p['productMainImage']) : null,
          category: null,
          rating: Number(p['evaluateRate'] ?? NaN) || null,
          sales: Number(p['soldQuantity'] ?? NaN) || null,
        };
      }
    } catch {
      /* fallback: página do produto */
    }

    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
    });
    const html = await res.text();
    const jsonLd = extractJsonLdProduct(html);
    const ogTitle = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)?.[1];

    return {
      storeProductId: itemId,
      title: String(jsonLd?.['name'] ?? ogTitle ?? `Produto AliExpress ${itemId}`),
      price: typeof jsonLd?.['price'] === 'number' ? (jsonLd['price'] as number) : null,
      oldPrice: null,
      discountPct: null,
      coupon: null,
      imageUrl: typeof jsonLd?.['image'] === 'string' ? (jsonLd['image'] as string) : null,
      category: null,
      rating: null,
      sales: null,
    };
  }
}