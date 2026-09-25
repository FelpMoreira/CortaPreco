import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '@cupons/db';
import { isProtectedApi } from '../routeGuard.js';
import { burnVerifyTime, hashPassword, passwordProblem, temporaryPassword, verifyPassword } from './password.js';
import {
  audit,
  clientInfo,
  createSession,
  LOCK_MS,
  MAX_FAILED,
  resolveSession,
  revokeSessions,
  ROLES,
  type Role,
} from './sessions.js';

const ID = '^[a-z0-9]{20,40}$';
const idParams = { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: ID } } } as const;
const email = { type: 'string', minLength: 5, maxLength: 200, format: 'email' } as const;
const name = { type: 'string', minLength: 2, maxLength: 80 } as const;
const password = { type: 'string', minLength: 1, maxLength: 200 } as const;

// login/primeiro acesso: poucas tentativas por IP real (o Next repassa o IP do visitante)
const authRateLimit = {
  max: 10,
  timeWindow: '15 minutes',
  keyGenerator: (req: FastifyRequest) => clientInfo(req).ip ?? req.ip,
};

const publicUser = (u: { id: string; name: string; email: string; role: string; mustChangePassword: boolean }) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  mustChangePassword: u.mustChangePassword,
});

const normEmail = (e: string) => e.trim().toLowerCase();
const sha = (s: string) => createHash('sha256').update(s).digest();

/** Garante que sempre sobra pelo menos um DEV ativo. */
async function wouldLeaveNoDev(userId: string, next: { role?: string; active?: boolean }): Promise<boolean> {
  const user = await prisma.adminUser.findUnique({ where: { id: userId } });
  if (!user || user.role !== 'DEV' || !user.active) return false;
  const losesDev = (next.role && next.role !== 'DEV') || next.active === false;
  if (!losesDev) return false;
  const otherDevs = await prisma.adminUser.count({ where: { role: 'DEV', active: true, NOT: { id: userId } } });
  return otherDevs === 0;
}

export function registerAuth(app: FastifyInstance): void {
  // ------------------------------------------------------------ guard (toda rota /api/* de admin)
  app.addHook('onRequest', async (req, reply) => {
    if (!isProtectedApi(req)) return;
    const cfg = req.routeOptions.config ?? {};
    if (cfg.noSession) return;

    const token = req.headers['x-session-token'];
    const admin = await resolveSession(typeof token === 'string' ? token : undefined);
    if (!admin) return reply.code(401).send({ ok: false, error: 'Sessão expirada. Entre de novo.', code: 'SESSION' });
    req.admin = admin;

    if (admin.mustChangePassword && !cfg.allowPendingPassword) {
      return reply
        .code(403)
        .send({ ok: false, error: 'Troque sua senha provisória para continuar.', code: 'MUST_CHANGE_PASSWORD' });
    }
    if (cfg.roles && !cfg.roles.includes(admin.role)) {
      return reply.code(403).send({ ok: false, error: 'Seu perfil não tem acesso a isso.', code: 'FORBIDDEN' });
    }
  });

  // ------------------------------------------------------------ primeiro acesso
  app.get('/api/auth/status', { config: { noSession: true } }, async () => ({
    ok: true,
    setupRequired: (await prisma.adminUser.count()) === 0,
  }));

  app.post(
    '/api/auth/setup',
    {
      config: { noSession: true, rateLimit: authRateLimit },
      schema: {
        body: {
          type: 'object',
          required: ['bootstrapPassword', 'name', 'email', 'password'],
          additionalProperties: false,
          properties: { bootstrapPassword: password, name, email, password },
        },
      },
    },
    async (req, reply) => {
      const body = req.body as { bootstrapPassword: string; name: string; email: string; password: string };
      if ((await prisma.adminUser.count()) > 0) {
        return reply.code(409).send({ ok: false, error: 'O primeiro acesso já foi feito. Entre com seu e-mail.' });
      }
      // confirmação: a senha única antiga do painel (ADMIN_PASSWORD) prova que é o dono
      const bootstrap = process.env.ADMIN_PASSWORD ?? '';
      if (!bootstrap || !timingSafeEqual(sha(body.bootstrapPassword), sha(bootstrap))) {
        await audit(req, 'setup_failed', null, 'senha de confirmação errada', null);
        return reply.code(401).send({ ok: false, error: 'Senha atual do painel incorreta.' });
      }
      const mail = normEmail(body.email);
      const problem = passwordProblem(body.password, mail);
      if (problem) return reply.code(400).send({ ok: false, error: problem });

      const user = await prisma.adminUser.create({
        data: { name: body.name.trim(), email: mail, passwordHash: await hashPassword(body.password), role: 'DEV' },
      });
      await audit(req, 'setup', user.id, `primeiro DEV: ${mail}`, user.id);
      const session = await createSession(user, req);
      return { ok: true, ...session, user: publicUser(user) };
    },
  );

  // ------------------------------------------------------------ login / logout
  app.post(
    '/api/auth/login',
    {
      config: { noSession: true, rateLimit: authRateLimit },
      schema: {
        body: { type: 'object', required: ['email', 'password'], additionalProperties: false, properties: { email, password } },
      },
    },
    async (req, reply) => {
      const body = req.body as { email: string; password: string };
      const mail = normEmail(body.email);
      const fail = () => reply.code(401).send({ ok: false, error: 'E-mail ou senha incorretos.' });
      const user = await prisma.adminUser.findUnique({ where: { email: mail } });

      if (!user || !user.active) {
        await burnVerifyTime(body.password); // mesmo tempo de resposta: não revela quem tem conta
        await audit(req, 'login_failed', null, `e-mail sem conta ativa: ${mail}`, null);
        return fail();
      }
      const locked = (until = Date.now() + LOCK_MS) => {
        const min = Math.max(1, Math.ceil((until - Date.now()) / 60000));
        return reply.code(429).send({ ok: false, error: `Muitas tentativas. Tente de novo em ${min} min.` });
      };
      if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
        await audit(req, 'login_blocked', user.id, 'tentativa com conta bloqueada', user.id);
        return locked(user.lockedUntil.getTime());
      }
      if (user.lockedUntil) {
        // bloqueio venceu: zera a contagem (updateMany com a condição evita apagar um bloqueio recém-criado)
        await prisma.adminUser.updateMany({
          where: { id: user.id, lockedUntil: { lte: new Date() } },
          data: { failedLogins: 0, lockedUntil: null },
        });
      }

      // Reserva a tentativa ANTES de conferir a senha, com incremento atômico: um lote em paralelo
      // não consegue ler o mesmo contador e passar do limite.
      const { failedLogins: attempt } = await prisma.adminUser.update({
        where: { id: user.id },
        data: { failedLogins: { increment: 1 } },
        select: { failedLogins: true },
      });
      if (attempt > MAX_FAILED) {
        await prisma.adminUser.updateMany({
          where: { id: user.id, OR: [{ lockedUntil: null }, { lockedUntil: { lte: new Date() } }] },
          data: { lockedUntil: new Date(Date.now() + LOCK_MS) },
        });
        await audit(req, 'login_blocked', user.id, 'tentativa acima do limite', user.id);
        return locked();
      }
      if (!(await verifyPassword(body.password, user.passwordHash))) {
        const lock = attempt >= MAX_FAILED;
        if (lock) {
          await prisma.adminUser.update({ where: { id: user.id }, data: { lockedUntil: new Date(Date.now() + LOCK_MS) } });
        }
        await audit(req, lock ? 'account_locked' : 'login_failed', user.id, lock ? `bloqueada por ${LOCK_MS / 60000} min` : `tentativa ${attempt}`, user.id);
        return fail();
      }

      await prisma.adminUser.update({
        where: { id: user.id },
        data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
      });
      const session = await createSession(user, req);
      await audit(req, 'login', user.id, null, user.id);
      return { ok: true, ...session, user: publicUser(user) };
    },
  );

  app.post('/api/auth/logout', { config: { allowPendingPassword: true } }, async (req) => {
    await prisma.adminSession.update({ where: { id: req.admin!.sessionId }, data: { revokedAt: new Date() } });
    await audit(req, 'logout');
    return { ok: true };
  });

  // ------------------------------------------------------------ minha conta
  app.get('/api/auth/me', { config: { allowPendingPassword: true } }, async (req) => ({ ok: true, user: req.admin }));

  app.post(
    '/api/auth/password',
    {
      config: { allowPendingPassword: true, rateLimit: authRateLimit },
      schema: {
        body: {
          type: 'object',
          required: ['current', 'next'],
          additionalProperties: false,
          properties: { current: password, next: password },
        },
      },
    },
    async (req, reply) => {
      const { current, next } = req.body as { current: string; next: string };
      const user = await prisma.adminUser.findUniqueOrThrow({ where: { id: req.admin!.id } });
      if (!(await verifyPassword(current, user.passwordHash))) {
        await audit(req, 'password_change_failed', user.id, 'senha atual errada');
        return reply.code(400).send({ ok: false, error: 'Senha atual incorreta.' });
      }
      if (current === next) return reply.code(400).send({ ok: false, error: 'A nova senha precisa ser diferente da atual.' });
      const problem = passwordProblem(next, user.email);
      if (problem) return reply.code(400).send({ ok: false, error: problem });

      await prisma.adminUser.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(next), mustChangePassword: false },
      });
      // outras sessões (outro navegador, alguém com a senha antiga) caem
      const revoked = await revokeSessions(user.id, req.admin!.sessionId);
      await audit(req, 'password_change', user.id, `${revoked} outra(s) sessão(ões) encerrada(s)`);
      return { ok: true, revokedSessions: revoked };
    },
  );

  app.get('/api/auth/sessions', { config: { allowPendingPassword: true } }, async (req) => {
    const sessions = await prisma.adminSession.findMany({
      where: { userId: req.admin!.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
      select: { id: true, createdAt: true, lastUsedAt: true, expiresAt: true, ip: true, userAgent: true },
    });
    return { ok: true, sessions: sessions.map((s) => ({ ...s, current: s.id === req.admin!.sessionId })) };
  });

  app.post('/api/auth/sessions/:id/revoke', { schema: { params: idParams } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { count } = await prisma.adminSession.updateMany({
      where: { id, userId: req.admin!.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!count) return reply.code(404).send({ ok: false, error: 'Sessão não encontrada.' });
    await audit(req, 'session_revoke', id);
    return { ok: true };
  });

  // ------------------------------------------------------------ usuários (só DEV)
  const devOnly = { roles: ['DEV'] as Role[] };

  app.get('/api/users', { config: devOnly }, async () => {
    const users = await prisma.adminUser.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      select: {
        id: true, name: true, email: true, role: true, active: true, mustChangePassword: true,
        lastLoginAt: true, lockedUntil: true, createdAt: true,
        _count: { select: { sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } } } } },
      },
    });
    return { ok: true, users, roles: ROLES };
  });

  app.post(
    '/api/users',
    {
      config: devOnly,
      schema: {
        body: {
          type: 'object',
          required: ['name', 'email', 'role'],
          additionalProperties: false,
          properties: { name, email, role: { type: 'string', enum: [...ROLES] } },
        },
      },
    },
    async (req, reply) => {
      const body = req.body as { name: string; email: string; role: Role };
      const mail = normEmail(body.email);
      if (await prisma.adminUser.findUnique({ where: { email: mail } })) {
        return reply.code(409).send({ ok: false, error: 'Já existe um usuário com esse e-mail.' });
      }
      const temp = temporaryPassword();
      const user = await prisma.adminUser.create({
        data: {
          name: body.name.trim(),
          email: mail,
          role: body.role,
          passwordHash: await hashPassword(temp),
          mustChangePassword: true,
        },
      });
      await audit(req, 'user.create', user.id, `${mail} como ${body.role}`);
      // a senha provisória só é mostrada agora; no banco fica só o hash
      return { ok: true, user: publicUser(user), temporaryPassword: temp };
    },
  );

  app.patch(
    '/api/users/:id',
    {
      config: devOnly,
      schema: {
        params: idParams,
        body: {
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          properties: { name, role: { type: 'string', enum: [...ROLES] }, active: { type: 'boolean' } },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as { name?: string; role?: Role; active?: boolean };
      if (await wouldLeaveNoDev(id, body)) {
        return reply.code(400).send({ ok: false, error: 'Precisa sobrar pelo menos um DEV ativo.' });
      }
      const user = await prisma.adminUser.update({
        where: { id },
        data: { name: body.name?.trim(), role: body.role, active: body.active },
      });
      // desativou ou mudou o perfil → sessões abertas caem (perfil novo vale no próximo login)
      if (body.active === false || body.role) await revokeSessions(id);
      await audit(req, 'user.update', id, JSON.stringify(body));
      return { ok: true, user: publicUser(user) };
    },
  );

  app.post('/api/users/:id/reset-password', { config: devOnly, schema: { params: idParams } }, async (req) => {
    const { id } = req.params as { id: string };
    const temp = temporaryPassword();
    const user = await prisma.adminUser.update({
      where: { id },
      data: { passwordHash: await hashPassword(temp), mustChangePassword: true, failedLogins: 0, lockedUntil: null },
    });
    await revokeSessions(id);
    await audit(req, 'user.reset_password', id, user.email);
    return { ok: true, temporaryPassword: temp };
  });

  app.post('/api/users/:id/revoke-sessions', { config: devOnly, schema: { params: idParams } }, async (req) => {
    const { id } = req.params as { id: string };
    const count = await revokeSessions(id);
    await audit(req, 'user.revoke_sessions', id, `${count} sessão(ões)`);
    return { ok: true, revoked: count };
  });

  app.get('/api/audit', { config: devOnly }, async () => {
    const entries = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 300,
      include: { user: { select: { name: true, email: true } } },
    });
    return { ok: true, entries };
  });
}
