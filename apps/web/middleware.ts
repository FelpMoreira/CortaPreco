import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/auth';

const deny = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status });

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

  if (pathname === '/admin/login' || pathname === '/api/login' || pathname === '/api/logout') {
    return NextResponse.next();
  }

  const ok = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (ok) return NextResponse.next();

  if (isApi) return deny('Não autorizado', 401);
  const url = req.nextUrl.clone();
  url.pathname = '/admin/login';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/admin/:path*', '/api/:path*'],
  runtime: 'nodejs',
};
