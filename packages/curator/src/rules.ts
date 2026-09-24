import type { Candidate, Curator, CurateOptions, Pick } from './types.js';
import { normalizePicks } from './validate.js';

/**
 * Curadoria sem IA: pontua por desconto, nota, vendas e histórico de preço.
 * Custo zero; é também o plano B quando a IA falha.
 */
export class RulesCurator implements Curator {
  readonly name = 'rules';

  async curate(candidates: Candidate[], opts: CurateOptions): Promise<Pick[]> {
    const picks = candidates.map((c) => {
      const why: string[] = [];
      // pesos somam ~95 no máximo: bom produto não "estoura" e a ordem continua útil
      let score = 20;
      if (c.discountPct) {
        score += Math.min(35, Math.round(c.discountPct * 0.5));
        why.push(`${c.discountPct}% de desconto`);
      }
      if (c.lowest30d && c.priceHistorySize >= 3 && c.price <= c.lowest30d) {
        score += 10;
        why.push('menor preço que vimos em 30 dias');
      }
      if (c.rating) {
        if (c.rating >= 4.8) score += 15;
        else if (c.rating >= 4.5) score += 10;
        else if (c.rating >= 4) score += 5;
        else score -= 15;
        why.push(c.rating < 4 ? `nota baixa (${c.rating.toFixed(1)})` : `nota ${c.rating.toFixed(1)}`);
      }
      if (c.sales && c.sales >= 100) {
        score += Math.min(15, Math.round(Math.log10(c.sales) * 3));
        why.push(`${c.sales.toLocaleString('pt-BR')} vendidos`);
      }
      return {
        productId: c.productId,
        score,
        reason: why.length ? `Regras: ${why.join(', ')}.` : 'Regras: sem dados de desconto/nota; ordem de chegada.',
        hook: null,
      };
    });
    return normalizePicks(picks, candidates, opts.max);
  }
}
