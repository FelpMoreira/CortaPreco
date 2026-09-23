import type { Store } from '@cupons/shared';

/** Produto enriquecido a partir da URL/site da loja. */
export interface ProductData {
  storeProductId: string;
  title: string;
  price: number | null;
  oldPrice: number | null;
  discountPct: number | null;
  coupon: string | null;
  imageUrl: string | null;
  category: string | null;
  rating: number | null;
  sales: number | null;
}

/** Resultado da conversão de uma URL em link de afiliado. */
export interface AffiliateLinkResult {
  affiliateUrl: string;
  /** Tracking subID usado pra atribuir conversão no relatório da rede. */
  subId: string;
}

/**
 * Contrato único para todas as lojas.
 * - `identify`: aceita esta URL? (checa domínio/pattern)
 * - `enrich`: busca dados do produto na loja/API
 * - `affiliateLink`: converte a URL em link comissionado (+ subID)
 */
export interface AffiliateProvider {
  readonly store: Store;
  identify(url: string): boolean;
  enrich(url: string): Promise<ProductData>;
  affiliateLink(url: string, subId?: string): Promise<AffiliateLinkResult>;
}

/** Erro esperado (ex.: credencial inválida, produto sem comissão). */
export class AffiliateError extends Error {
  constructor(
    message: string,
    public readonly store: Store,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'AffiliateError';
  }
}