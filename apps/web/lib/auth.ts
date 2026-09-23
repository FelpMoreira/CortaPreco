// Auth do painel: token HMAC-SHA256 assinado (WebCrypto — roda em Node e Edge).

const enc = new TextEncoder();

function getSecret(): string {
  const s = process.env.JWT_SECRET || process.env.ADMIN_PASSWORD || 'dev-secret-troque';
  if (s === 'troque-por-segredo-jwt-aleatorio' || s === 'troque-a-senha' || s === 'dev-secret-troque') {
    console.warn('[auth] usando segredo padrão — troque JWT_SECRET/ADMIN_PASSWORD em produção');
  }
  return s;
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(getSecret()), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

const toB64url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => atob(s.replace(/-/g, '+').replace(/_/g, '/'));

export const SESSION_COOKIE = 'cupons_session';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function signSession(): Promise<string> {
  const payload = toB64url(JSON.stringify({ exp: Date.now() + TTL_MS }));
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