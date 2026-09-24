import { ClaudeCurator } from './claude.js';
import { RulesCurator } from './rules.js';
import type { Candidate, Curator, CurateOptions, Pick } from './types.js';

export type { Candidate, Curator, CurateOptions, Pick } from './types.js';
export { RulesCurator } from './rules.js';
export { ClaudeCurator } from './claude.js';
export { sanitizeHook, normalizePicks } from './validate.js';

/**
 * LLM_PROVIDER=rules (padrão, sem custo) | claude.
 * Para comparar outro provedor, basta implementar `Curator` e registrar aqui.
 */
export function curatorFromEnv(env: Record<string, string | undefined>): Curator {
  const provider = (env.LLM_PROVIDER || 'rules').toLowerCase();
  if (provider === 'claude') return new ClaudeCurator(env.LLM_MODEL || 'claude-opus-5');
  return new RulesCurator();
}

/** Tenta o curador configurado; se falhar (sem chave, erro, recusa), cai para as regras. */
export async function curateWithFallback(
  curator: Curator,
  candidates: Candidate[],
  opts: CurateOptions,
): Promise<{ picks: Pick[]; curator: string; fallbackError?: string }> {
  try {
    return { picks: await curator.curate(candidates, opts), curator: curator.name };
  } catch (err) {
    if (curator instanceof RulesCurator) throw err;
    const rules = new RulesCurator();
    return {
      picks: await rules.curate(candidates, opts),
      curator: rules.name,
      fallbackError: `${curator.name}: ${(err as Error).message}`,
    };
  }
}
