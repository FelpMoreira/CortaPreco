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
  /**
   * Descoberta automática de ofertas pela API OFICIAL da rede (opcional).
   * Amazon não implementa: coleta automatizada do site viola as Condições de Uso;
   * entra quando houver acesso à Creators API.
   */
  discover?(opts: DiscoverOptions): Promise<DiscoveredProduct[]>;
}

export interface DiscoverOptions {
  limit: number;
  page?: number;
  keyword?: string;
  /** Termos da fonte de um canal (a busca gira entre eles a cada rodada). */
  keywords?: string[];
  /** Promoções em destaque escolhidas pela fonte (trechos do nome; AliExpress). */
  promos?: string[];
}

/** Produto vindo da API da rede, já com os dados de oferta. */
export interface DiscoveredProduct extends ProductData {
  /** URL do produto (sem afiliado), usada como chave e para gerar o link no agendamento. */
  url: string;
  /** Comissão informada pela rede (0.1 = 10%). */
  commissionRate: number | null;
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