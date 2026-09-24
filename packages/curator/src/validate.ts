import type { Candidate, Pick } from './types.js';

const FORBIDDEN_IN_HOOK = /\d|R\$|%|https?:|www\.|<|>/i;

/**
 * A frase da IA não pode conter número, preço, porcentagem, link ou HTML:
 * números saem sempre do banco pelo template (regra de ouro nº 1).
 */
export function sanitizeHook(raw: string | null | undefined): string | null {
  const hook = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!hook || hook.length > 140 || FORBIDDEN_IN_HOOK.test(hook)) return null;
  return hook;
}

/** Descarta ids inventados, repetidos e valores fora da faixa; ordena por nota. */
export function normalizePicks(picks: Pick[], candidates: Candidate[], max: number): Pick[] {
  const valid = new Set(candidates.map((c) => c.productId));
  const seen = new Set<string>();
  const out: Pick[] = [];
  for (const p of picks) {
    if (!valid.has(p.productId) || seen.has(p.productId)) continue;
    seen.add(p.productId);
    out.push({
      productId: p.productId,
      score: Math.max(0, Math.min(100, Math.round(Number(p.score) || 0))),
      reason: (p.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 300) || 'Sem justificativa.',
      hook: sanitizeHook(p.hook),
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, max);
}
