// Auth do painel: token HMAC-SHA256 assinado (WebCrypto — roda em Node e Edge).

const enc = new TextEncoder();
const isProd = process.env.NODE_ENV === 'production';

function getSecret(): string {
  const s = process.env.JWT_SECRET ?? '';
  if (s.length >= 32 && !s.startsWith('troque')) return s;
  // em produção, sem segredo forte o painel não abre (melhor que sessão forjável)
  if (isProd) throw new Error('JWT_SECRET ausente ou fraco (use openssl rand -hex 32)');
  console.warn('[auth] JWT_SECRET fraco — ok só em dev');
  return s || 'dev-secret-somente-local';
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(getSecret()), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

const toB64url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => atob(s.replace(/-/g, '+').replace(/_/g, '/'));

export const SESSION_COOKIE = isProd ? '__Host-cupons_session' : 'cupons_session';
export const SESSION_TTL_S = 12 * 60 * 60;

export const sessionCookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: 'strict' as const,
  path: '/',
  maxAge: SESSION_TTL_S,
};

export async function signSession(): Promise<string> {
  const payload = toB64url(JSON.stringify({ exp: Date.now() + SESSION_TTL_S * 1000 }));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(), enc.encode(payload));
  const sigB64 = toB64url(String.fromCharCode(...new Uint8Array(sig)));
  return `${payload}.${sigB64}`;
}

export async function verifySession(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const [payload, sigB64] = token.split('.');
  if (!payload || !sigB64) return false;

  let valid: boolean;
  try {
    const sig = Uint8Array.from(fromB64url(sigB64), (c) => c.charCodeAt(0));
    valid = await crypto.subtle.verify('HMAC', await hmacKey(), sig, enc.encode(payload));
  } catch {
    return false;
  }
  if (!valid) return false;

  try {
    const { exp } = JSON.parse(fromB64url(payload)) as { exp: number };
    return typeof exp === 'number' && exp > Date.now();
  } catch {
    return false;
  }
}
