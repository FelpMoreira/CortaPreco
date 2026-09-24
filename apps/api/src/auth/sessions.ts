import { createHash, randomBytes } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { prisma, type AdminUser } from '@cupons/db';

export const ROLES = ['DEV', 'GERENTE'] as const;
export type Role = (typeof ROLES)[number];

export interface AdminContext {
  id: string;
  name: string;
  email: string;
  role: Role;
  mustChangePassword: boolean;
  sessionId: string;
}

const MIN = 60 * 1000;
export const IDLE_MS = 2 * 60 * MIN; // sem uso por 2h → sessão cai
export const ABSOLUTE_MS = 12 * 60 * MIN; // no máximo 12h, mesmo em uso
const TOUCH_EVERY_MS = 5 * MIN; // não grava "último uso" a cada clique
export const MAX_FAILED = 5;
export const LOCK_MS = 15 * MIN;

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** IP/navegador de quem está no painel (o Next repassa; só confiável porque veio com a chave de admin). */
export function clientInfo(req: FastifyRequest): { ip: string | null; userAgent: string | null } {
  const h = (k: string) => (typeof req.headers[k] === 'string' ? (req.headers[k] as string).slice(0, 255) : null);
  return { ip: h('x-client-ip') ?? req.ip ?? null, userAgent: h('x-client-ua') };
}

export async function createSession(user: AdminUser, req: FastifyRequest): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + ABSOLUTE_MS);
  await prisma.adminSession.create({
    data: { tokenHash: hashToken(token), userId: user.id, expiresAt, ...clientInfo(req) },
  });
  return { token, expiresAt };
}

/** Token → usuário, se a sessão existe, não foi revogada, não expirou e o usuário está ativo. */
export async function resolveSession(token: string | undefined): Promise<AdminContext | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const session = await prisma.adminSession.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  const now = Date.now();
  if (!session || session.revokedAt || session.expiresAt.getTime() <= now || !session.user.active) return null;
  if (now - session.lastUsedAt.getTime() > IDLE_MS) {
    await prisma.adminSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    return null;
  }
  if (now - session.lastUsedAt.getTime() > TOUCH_EVERY_MS) {
    await prisma.adminSession.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } });
  }
  const { user } = session;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role as Role,
    mustChangePassword: user.mustChangePassword,
    sessionId: session.id,
  };
}

export async function revokeSessions(userId: string, exceptSessionId?: string): Promise<number> {
  const { count } = await prisma.adminSession.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { NOT: { id: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
  return count;
}

export async function audit(
  req: FastifyRequest,
  action: string,
  target?: string | null,
  detail?: string | null,
  userId?: string | null,
): Promise<void> {
  await prisma.auditLog
    .create({
      data: {
        action,
        target: target ?? null,
        detail: detail?.slice(0, 500) ?? null,
        userId: userId === undefined ? (req.admin?.id ?? null) : userId,
        ip: clientInfo(req).ip,
      },
    })
    .catch((err) => req.log.error({ err }, 'falha ao gravar auditoria'));
}

declare module 'fastify' {
  interface FastifyRequest {
    admin?: AdminContext;
  }
  interface FastifyContextConfig {
    /** Perfis que podem usar a rota. Ausente = qualquer usuário logado. */
    roles?: Role[];
    /** Rota que não exige sessão (login, primeiro acesso). */
    noSession?: boolean;
    /** Rota liberada mesmo com troca de senha pendente. */
    allowPendingPassword?: boolean;
  }
}
