import type { Store } from '@cupons/shared';

/** Produto elegível para post, com os números vindos do banco (nunca da IA). */
export interface Candidate {
  productId: string;
  store: Store;
  title: string;
  price: number;
  oldPrice: number | null;
  discountPct: number | null;
  rating: number | null;
  sales: number | null;
  category: string | null;
  /** Comissão da rede (0.1 = 10%), quando a API informa. */
  commissionRate: number | null;
  /** Menor preço que nós mesmos vimos nos últimos 30 dias (histórico próprio). */
  lowest30d: number | null;
  /** Quantos registros de preço temos nesses 30 dias (com poucos, "menor preço" não diz nada). */
  priceHistorySize: number;
}

export interface Pick {
  productId: string;
  /** 0-100: quão boa é a oferta para o público do canal. */
  score: number;
  /** Por que foi escolhido — mostrado ao admin na aprovação. */
  reason: string;
  /** Frase curta de chamada para o post; null = post só com o template. */
  hook: string | null;
}

export interface CurateOptions {
  /** Quantos escolher no máximo. */
  max: number;
}

/** Quem decide o que vale postar. Implementações trocáveis (regras, Claude, outro provedor). */
export interface Curator {
  readonly name: string;
  curate(candidates: Candidate[], opts: CurateOptions): Promise<Pick[]>;
}
