import { NextRequest, NextResponse } from 'next/server';
import { callApi } from '@/lib/api';
import { clientMeta, SESSION_COOKIE, sessionCookieOptions, sessionToken } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const token = sessionToken(req);
  // revoga no servidor: o token deixa de valer mesmo se alguém tiver copiado o cookie
  if (token) await callApi('/api/auth/logout', { method: 'POST' }, { token, ...clientMeta(req) });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions(new Date(0)), maxAge: 0 });
  return res;
}
