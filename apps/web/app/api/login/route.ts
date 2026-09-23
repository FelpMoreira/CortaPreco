import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, signSession } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const { password } = (await req.json()) as { password?: string };
  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ ok: false, error: 'Senha incorreta' }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await signSession(), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}