// Sessão do painel: o cookie guarda um token opaco; quem valida (e pode revogar) é a API.
import type { NextRequest } from 'next/server';

const isProd = process.env.NODE_ENV === 'production';

// __Host-: só HTTPS, sem Domain, Path=/ — impede subdomínio de sobrescrever o cookie
export const SESSION_COOKIE = isProd ? '__Host-cp_session' : 'cp_session';

export function sessionCookieOptions(expiresAt: string | Date) {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'strict' as const,
    path: '/',
    expires: new Date(expiresAt),
  };
}

export function sessionToken(req: NextRequest): string | undefined {
  return req.cookies.get(SESSION_COOKIE)?.value;
}

/** IP e navegador do visitante, repassados à API para auditoria e limite de tentativas. */
export function clientMeta(req: NextRequest): { ip: string; ua: string } {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'local';
  return { ip, ua: (req.headers.get('user-agent') ?? '').slice(0, 255) };
}
