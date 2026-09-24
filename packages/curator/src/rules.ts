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
      let score = 40;
      if (c.discountPct) {
        score += Math.min(40, c.discountPct);
        why.push(`${c.discountPct}% de desconto`);
      }
      if (c.lowest30d && c.priceHistorySize >= 3 && c.price <= c.lowest30d) {
        score += 10;
        why.push('menor preço que vimos em 30 dias');
      }
      if (c.rating && c.rating >= 4.5) {
        score += 10;
        why.push(`nota ${c.rating.toFixed(1)}`);
      } else if (c.rating && c.rating < 4) {
        score -= 15;
        why.push(`nota baixa (${c.rating.toFixed(1)})`);
      }
      if (c.sales && c.sales >= 100) {
        score += Math.min(10, Math.round(Math.log10(c.sales) * 3));
        why.push(`${c.sales} vendidos`);
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
