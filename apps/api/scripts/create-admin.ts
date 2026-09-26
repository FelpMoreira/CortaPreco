/**
 * Cria (ou redefine) um usuário do painel com senha provisória aleatória.
 * A senha aparece UMA vez aqui; no banco fica só o hash, e a troca é obrigatória no 1º login.
 *
 *   npm run admin:create -w @cupons/api -- --email voce@exemplo.com --name "Seu Nome" [--role DEV|GERENTE] [--reset]
 *   (no Docker: docker compose exec api npm run admin:create -w @cupons/api -- --email ... --name ...)
 */
import '../src/env.js';
import { parseArgs } from 'node:util';
import { prisma } from '@cupons/db';
import { hashPassword, temporaryPassword } from '../src/auth/password.js';
import { ROLES, revokeSessions, type Role } from '../src/auth/sessions.js';

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    role: { type: 'string', default: 'DEV' },
    reset: { type: 'boolean', default: false },
  },
});

const email = values.email?.trim().toLowerCase();
const role = (values.role ?? 'DEV').toUpperCase() as Role;
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('Informe --email válido.');
  process.exit(1);
}
if (!ROLES.includes(role)) {
  console.error(`--role deve ser ${ROLES.join(' ou ')}.`);
  process.exit(1);
}

const temp = temporaryPassword();
const existing = await prisma.adminUser.findUnique({ where: { email } });
if (existing && !values.reset) {
  console.error(`Já existe usuário com ${email}. Use --reset para gerar nova senha provisória.`);
  process.exit(1);
}

const passwordHash = await hashPassword(temp);
const user = existing
  ? await prisma.adminUser.update({
      where: { id: existing.id },
      data: { passwordHash, mustChangePassword: true, active: true, failedLogins: 0, lockedUntil: null },
    })
  : await prisma.adminUser.create({
      data: { email, name: values.name?.trim() || email.split('@')[0]!, role, passwordHash, mustChangePassword: true },
    });
if (existing) await revokeSessions(user.id);
await prisma.auditLog.create({
  data: { action: existing ? 'user.reset_password' : 'user.create', target: user.id, detail: `via script: ${email} (${user.role})` },
});

console.log(`
Usuário ${existing ? 'redefinido' : 'criado'}: ${user.name} <${user.email}> · perfil ${user.role}
Senha provisória (aparece só agora): ${temp}
No primeiro login o painel pede para criar a senha definitiva.
`);
await prisma.$disconnect();
