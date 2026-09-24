import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

// scrypt (nativo do Node, sem dependência nativa): lento de propósito contra força bruta.
// N=2^15, r=8 → ~32 MB e ~0,1 s por tentativa.
const N = 32768;
const R = 8;
const P = 1;
const KEYLEN = 64;

function scrypt(password: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password.normalize('NFKC'), salt, KEYLEN, { ...opts, maxmem: 128 * N * R * 2 }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(password, Buffer.from(salt, 'base64'), { N: Number(n), r: Number(r), p: Number(p) });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// usado quando o e-mail não existe: gasta o mesmo tempo de uma verificação real,
// então o tempo de resposta não revela quais e-mails têm conta
let dummyHash: Promise<string> | null = null;
export async function burnVerifyTime(password: string): Promise<void> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  await verifyPassword(password, await dummyHash);
}

const COMMON = new Set([
  '123456789012', 'senha1234567', 'password1234', 'qwertyuiop12', 'cortapreco123', 'admin1234567', '111111111111',
]);

/** Regras de senha forte. Devolve o motivo da recusa, ou null se ok. */
export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < 12) return 'A senha precisa ter pelo menos 12 caracteres.';
  if (password.length > 200) return 'Senha longa demais.';
  if (/^(.)\1+$/.test(password)) return 'A senha não pode ser um caractere repetido.';
  if (COMMON.has(password.toLowerCase())) return 'Essa senha é comum demais.';
  if (email && password.toLowerCase().includes(email.split('@')[0]!.toLowerCase())) {
    return 'A senha não pode conter o seu e-mail.';
  }
  return null;
}

/** Senha provisória (entregue uma vez; troca obrigatória no primeiro acesso). */
export function temporaryPassword(): string {
  // sem caracteres ambíguos (0/O, 1/l/I) para ditar ou digitar sem erro
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(16);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('').replace(/(.{4})(?!$)/g, '$1-');
}
