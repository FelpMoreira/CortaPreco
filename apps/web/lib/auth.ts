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

// Quantos proxies confiáveis (Caddy/nginx/cloudflared) ficam na frente do Next. Cada um ACRESCENTA
// o IP de quem o chamou ao X-Forwarded-For, então só as últimas entradas são confiáveis; as da
// esquerda vêm do cliente e podem ser inventadas. Sem proxy, o Next só preenche o cabeçalho se o
// cliente não mandou um — por isso produção deve rodar atrás de um proxy com isto configurado.
const PROXY_HOPS = Math.max(0, Number.parseInt(process.env.TRUST_PROXY_HOPS ?? '0', 10) || 0);

/** IP e navegador do visitante, repassados à API para auditoria e limite de tentativas. */
export function clientMeta(req: NextRequest): { ip: string; ua: string } {
  const chain = (req.headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const ip = chain[Math.max(0, chain.length - Math.max(1, PROXY_HOPS))] || 'local';
  return { ip: ip.slice(0, 64), ua: (req.headers.get('user-agent') ?? '').slice(0, 255) };
}
