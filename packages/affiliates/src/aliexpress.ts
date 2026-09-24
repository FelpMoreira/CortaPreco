import { createHmac } from 'node:crypto';
import type { Store } from '@cupons/shared';
import {
  AffiliateError,
  type AffiliateLinkResult,
  type AffiliateProvider,
  type DiscoverOptions,
  type DiscoveredProduct,
  type ProductData,
} from './types.js';
import { extractJsonLdProduct } from './utils.js';

const ENDPOINT = 'https://api-sg.aliexpress.com/sync';

const PRODUCT_FIELDS =
  'product_id,product_title,product_main_image_url,target_sale_price,target_original_price,discount,evaluate_rate,lastest_volume,product_detail_url,first_level_category_name,commission_rate';

const pct = (v: unknown) => (typeof v === 'string' ? Number(v.replace('%', '')) : Number(v));

/** Campos da API de afiliados (snake_case) → nosso formato. */
function mapProduct(p: Record<string, unknown>): DiscoveredProduct | null {
  const price = Number(p['target_sale_price']);
  if (!Number.isFinite(price) || price <= 0) return null;
  const original = Number(p['target_original_price']);
  const discount = pct(p['discount']);
  const evaluate = pct(p['evaluate_rate']); // % de avaliações positivas → escala 0-5
  const commission = pct(p['commission_rate']);
  const id = String(p['product_id']);
  return {
    storeProductId: id,
    title: String(p['product_title'] ?? `Produto AliExpress ${id}`),
    price,
    oldPrice: Number.isFinite(original) && original > price ? original : null,
    discountPct: Number.isFinite(discount) && discount > 0 ? Math.round(discount) : null,
    coupon: null,
    imageUrl: p['product_main_image_url'] ? String(p['product_main_image_url']) : null,
    category: p['first_level_category_name'] ? String(p['first_level_category_name']) : null,
    rating: Number.isFinite(evaluate) && evaluate > 0 ? Math.round((evaluate / 20) * 100) / 100 : null,
    sales: Number(p['lastest_volume']) || null,
    url: String(p['product_detail_url'] ?? `https://pt.aliexpress.com/item/${id}.html`),
    commissionRate: Number.isFinite(commission) && commission > 0 ? commission / 100 : null,
  };
}

type ProductsResult = { products?: { product?: Array<Record<string, unknown>> } };

interface AliExpressCredentials {
  appKey: string;
  appSecret: string;
  trackingId: string;
  /** Termos da descoberta automática (ALIEXPRESS_KEYWORDS). */
  keywords?: string[];
}

// categorias com bom volume no Brasil; troque por ALIEXPRESS_KEYWORDS no .env
const DEFAULT_KEYWORDS = [
  'fone bluetooth',
  'smartwatch',
  'carregador turbo',
  'organizador',
  'ferramentas',
  'utensilios cozinha',
  'fita led',
  'mouse sem fio',
  'capa celular',
  'acessorios carro',
];

/** Escolhe `n` termos, girando pela lista a cada rodada (determinístico por `seed`). */
function pickKeywords(list: string[], n: number, seed: number): string[] {
  return Array.from({ length: Math.min(n, list.length) }, (_, i) => list[(seed * n + i) % list.length]!);
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

  private hotProductDenied = false;
  private readonly keywords: string[];

  constructor(private readonly creds: AliExpressCredentials) {
    this.keywords = creds.keywords?.length ? creds.keywords : DEFAULT_KEYWORDS;
  }

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

  // a API bloqueia por ~1s quando as chamadas vêm rápido demais (ApiCallLimit)
  private lastCallAt = 0;

  private async call(method: string, business: Record<string, unknown>): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      const wait = this.lastCallAt + 1100 - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastCallAt = Date.now();
      try {
        return await this.callOnce(method, business);
      } catch (err) {
        if (attempt < 2 && err instanceof AffiliateError && err.message.includes('ApiCallLimit')) {
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
          continue;
        }
        throw err;
      }
    }
  }

  private async callOnce(method: string, business: Record<string, unknown>): Promise<unknown> {
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
    // a chave da resposta usa sublinhados: aliexpress_affiliate_link_generate_response
    const response = json[`${method.replace(/\./g, '_')}_response`] as
      | { result?: unknown; resp_result?: { resp_code?: number; resp_msg?: string; result?: unknown }; code?: number; msg?: string }
      | undefined;
    const errorResponse = (json['error_response'] ?? null) as { code?: string; msg?: string } | null;
    if (errorResponse) {
      throw new AffiliateError(`AliExpress erro ${errorResponse.code}: ${errorResponse.msg ?? ''}`, 'ALIEXPRESS', 'API_ERROR');
    }
    if (response?.code && Number(response.code) !== 0) {
      throw new AffiliateError(
        `AliExpress erro ${response.code}: ${response.msg ?? 'sem mensagem'}`,
        'ALIEXPRESS',
        'API_ERROR',
      );
    }
    const resp = response?.resp_result;
    if (resp?.resp_code && Number(resp.resp_code) !== 200) {
      throw new AffiliateError(`AliExpress ${resp.resp_code}: ${resp.resp_msg ?? ''}`, 'ALIEXPRESS', 'API_ERROR');
    }
    return resp?.result ?? response?.result ?? json;
  }

  /** Links curtos (a.aliexpress.com/_xxx, s.click...) redirecionam para a página do item. */
  private async resolve(url: string): Promise<string> {
    if (/\/item\/|\d{10,}/.test(new URL(url).pathname)) return url;
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15_000) });
    return res.url || url;
  }

  private extractItemId(url: string): string {
    const m = url.match(/\/item\/(?:-|item-)?(\d+)\.html/);
    if (m) return m[1]!;
    const q = new URL(url).pathname.match(/(\d{10,})/);
    if (q) return q[1]!;
    throw new AffiliateError(`Item ID não encontrado em ${url}`, 'ALIEXPRESS', 'PARSE_URL');
  }

  async affiliateLink(url: string, subId?: string): Promise<AffiliateLinkResult> {
    // NOTA: o subID por post ainda não vai para o AliExpress (a atribuição é pelo tracking_id);
    // guardamos no post para cruzar depois quando o formato de sub-id for validado.
    const sub = subId ?? 'cupons';
    url = await this.resolve(url);
    const itemId = this.extractItemId(url);

    try {
      // parâmetros oficiais (snake_case); 0 = link normal de afiliado
      const result = (await this.call('aliexpress.affiliate.link.generate', {
        promotion_link_type: '0',
        source_values: url,
        tracking_id: this.creds.trackingId,
      })) as { promotion_links?: { promotion_link?: Array<{ promotion_link?: string; message?: string }> } };

      const entry = result.promotion_links?.promotion_link?.[0];
      const affiliateUrl = entry?.promotion_link;
      if (!affiliateUrl) {
        // a API explica o motivo por item (ex.: "cannot be sold or promoted in the selected country")
        const why = entry?.message?.includes('cannot be sold or promoted')
          ? 'o AliExpress não permite promover este produto no Brasil'
          : entry?.message ?? 'resposta sem link';
        throw new AffiliateError(`AliExpress não gerou link para o item ${itemId}: ${why}`, 'ALIEXPRESS', 'EMPTY_LINK');
      }
      return { affiliateUrl, subId: sub };
    } catch (err) {
      if (err instanceof AffiliateError) throw err;
      throw new AffiliateError(`Falha ao gerar link AliExpress: ${(err as Error).message}`, 'ALIEXPRESS', 'GENERIC');
    }
  }

  /**
   * Descoberta de ofertas. Tenta "produtos em alta" (exige permissão avançada); sem ela,
   * usa a busca por palavra-chave, girando por categorias populares a cada rodada.
   */
  async discover(opts: DiscoverOptions): Promise<DiscoveredProduct[]> {
    const common = {
      fields: PRODUCT_FIELDS,
      page_no: String(opts.page ?? 1),
      sort: 'LAST_VOLUME_DESC',
      target_currency: 'BRL',
      target_language: 'PT',
      ship_to_country: 'BR',
      tracking_id: this.creds.trackingId,
    };
    if (!opts.keyword && !this.hotProductDenied) {
      try {
        const result = (await this.call('aliexpress.affiliate.hotproduct.query', {
          ...common,
          page_size: String(opts.limit),
        })) as ProductsResult;
        return (result.products?.product ?? []).flatMap((p) => mapProduct(p) ?? []);
      } catch (err) {
        if (!(err instanceof AffiliateError) || !err.message.includes('InsufficientPermission')) throw err;
        this.hotProductDenied = true; // não insiste a cada rodada
      }
    }

    const keywords = opts.keyword
      ? [opts.keyword]
      : pickKeywords(this.keywords, 2, Math.floor(Date.now() / (60 * 60 * 1000)));
    const perKeyword = Math.max(5, Math.ceil(opts.limit / keywords.length));
    const out: DiscoveredProduct[] = [];
    for (const keyword of keywords) {
      const result = (await this.call('aliexpress.affiliate.product.query', {
        ...common,
        keywords: keyword,
        page_size: String(perKeyword),
      })) as ProductsResult;
      out.push(...(result.products?.product ?? []).flatMap((p) => mapProduct(p) ?? []));
    }
    return out;
  }

  async enrich(url: string): Promise<ProductData> {
    url = await this.resolve(url);
    const itemId = this.extractItemId(url);

    try {
      const result = (await this.call('aliexpress.affiliate.productdetail.get', {
        product_ids: itemId,
        fields: PRODUCT_FIELDS,
        target_currency: 'BRL',
        target_language: 'PT',
        country: 'BR',
        tracking_id: this.creds.trackingId,
      })) as ProductsResult;

      const p = result.products?.product?.[0];
      const mapped = p ? mapProduct(p) : null;
      if (mapped) {
        const { url: _url, commissionRate: _c, ...data } = mapped;
        return data;
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