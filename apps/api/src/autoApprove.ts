import type { FastifyBaseLogger } from 'fastify';
import { prisma } from '@cupons/db';
import { approveSuggestion } from './services/deals.js';

/**
 * Modo automático por fonte: sugestões de fontes com `autoApprove` e nota >= `autoMinScore` são
 * aprovadas sem passar pela aba Sugestões. Vão para a fila normal, então ritmo, silêncio de madrugada
 * e teto de cada canal continuam valendo; a fila sai pela nota e o preço é conferido antes de enviar.
 */
const EVERY_MS = 60_000;
/** Sugestão velha não vai sozinha (o preço pode ter mudado); fica para decisão manual. */
const MAX_AGE_MS = 12 * 3_600_000;

let running = false;

async function tick(log: FastifyBaseLogger): Promise<void> {
  if (running) return;
  running = true;
  try {
    const pending = await prisma.suggestion.findMany({
      where: {
        status: 'PENDING',
        createdAt: { gte: new Date(Date.now() - MAX_AGE_MS) },
        channelId: { not: null },
        origin: { autoApprove: true, enabled: true },
      },
      include: { origin: { select: { autoMinScore: true, label: true } } },
      orderBy: [{ score: 'desc' }, { createdAt: 'asc' }],
      take: 20,
    });
    for (const s of pending) {
      if (!s.origin || s.score < s.origin.autoMinScore) continue;
      try {
        await approveSuggestion(s.id, undefined);
        await prisma.auditLog.create({
          data: { action: 'suggestion.auto_approve', target: s.id, detail: `nota ${s.score} · fonte ${s.origin.label}` },
        });
      } catch (err) {
        // já decidida por alguém, produto sem preço, canal pausado...: fica para decisão manual
        log.warn({ err: (err as Error).message, suggestion: s.id }, 'aprovação automática não foi possível');
      }
    }
  } catch (err) {
    log.error({ err }, 'falha na aprovação automática');
  } finally {
    running = false;
  }
}

export function startAutoApprove(log: FastifyBaseLogger): void {
  setInterval(() => void tick(log), EVERY_MS).unref();
  void tick(log);
}
