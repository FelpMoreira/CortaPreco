/**
 * Tipos comuns dos conversores do espelhamento (Mercado Livre, Amazon…).
 * Cada conversor recebe o link do grupo e devolve o produto + o NOSSO link de afiliado.
 */

/**
 * - SESSION / BLOCKED: conta de afiliado sem sessão ou pedindo verificação (Mercado Livre)
 * - CONFIG: falta configuração nossa (ex.: AMAZON_PARTNER_TAG)
 * - NO_PRODUCT: o link não é de um produto (vitrine do afiliado, página do Prime…) → ignorado, sem alerta
 * - RATE: teto de leitura da loja atingido → ignorado, sem alerta
 * - LAYOUT / NETWORK: página mudou ou não abriu → 1 nova tentativa, depois alerta
 */
export type FailureKind = 'SESSION' | 'BLOCKED' | 'CONFIG' | 'NO_PRODUCT' | 'RATE' | 'LAYOUT' | 'NETWORK';

export class ConversionError extends Error {
  constructor(
    message: string,
    readonly kind: FailureKind,
    readonly debugFile: string | null = null,
  ) {
    super(message);
    this.name = 'ConversionError';
  }
  /** Vale tentar de novo na hora? (layout que demorou, rede). */
  get retryable(): boolean {
    return this.kind === 'LAYOUT' || this.kind === 'NETWORK';
  }
  /** Não é falha nossa (link sem produto, teto da loja): registra como ignorado e não alerta. */
  get isSkip(): boolean {
    return this.kind === 'NO_PRODUCT' || this.kind === 'RATE';
  }
}

export interface ConvertedProduct {
  store: 'MERCADOLIVRE' | 'AMAZON';
  /** URL do produto sem rastreio de quem postou (sem query no ML; /dp/ASIN na Amazon). */
  productUrl: string;
  /** Id na loja (MLB123 / MLBU123 no ML, ASIN na Amazon) — chave do produto no banco. */
  itemId: string;
  title: string;
  price: number;
  oldPrice: number | null;
  discountPct: number | null;
  imageUrl: string | null;
  rating: number | null;
}

/** Chamado antes do passo caro (gerador do ML, leitura da página da Amazon): devolve motivo para pular. */
export type BeforeExpensiveStep = (p: { store: ConvertedProduct['store']; itemId: string }) => Promise<string | null>;

export type ConversionResult = { product: ConvertedProduct; affiliateUrl: string } | { skip: string };
