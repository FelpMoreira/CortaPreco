import { NextRequest, NextResponse } from 'next/server';
import { callApi } from '@/lib/api';
import { clientMeta, sessionToken } from '@/lib/auth';

const deny = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status });
const PUBLIC_API = new Set(['/api/login', '/api/logout', '/api/setup', '/api/auth-status']);

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith('/api/');

  // CSRF: escrita só vinda do próprio site (além do cookie SameSite=Strict)
  if (isApi && req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.headers.get('origin');
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
    let originHost = '';
    try {
      originHost = origin ? new URL(origin).host : '';
    } catch {
      /* origin malformado → nega */
    }
    if (!originHost || originHost !== host) return deny('Origem inválida', 403);
  }

  if (pathname === '/admin/login' || PUBLIC_API.has(pathname)) return NextResponse.next();

  const token = sessionToken(req);
  // /api/admin/*: a API valida sessão e perfil em toda chamada; aqui só barra quem nem tem cookie
  if (isApi) return token ? NextResponse.next() : deny('Não autorizado', 401);

  // páginas do painel: confere a sessão no servidor antes de renderizar
  const { status } = token ? await callApi('/api/auth/me', undefined, { token, ...clientMeta(req) }) : { status: 401 };
  if (status === 200) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = '/admin/login';
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/admin/:path*', '/api/:path*'],
  runtime: 'nodejs',
};
