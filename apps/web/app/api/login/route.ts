import { NextRequest, NextResponse } from 'next/server';
import { callApi } from '@/lib/api';
import { clientMeta, SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth';

// 1ª barreira (em memória, por IP). A API tem a sua própria, e o bloqueio por conta fica no banco.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_IP = 10;
const attempts = new Map<string, number[]>();

export async function POST(req: NextRequest) {
  const meta = clientMeta(req);
  const now = Date.now();
  const recent = (attempts.get(meta.ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_IP) {
    return NextResponse.json({ ok: false, error: 'Muitas tentativas. Aguarde 15 minutos.' }, { status: 429 });
  }

  const body = (await req.json().catch(() => null)) as { email?: unknown; password?: unknown } | null;
  const email = typeof body?.email === 'string' ? body.email.slice(0, 200) : '';
  const password = typeof body?.password === 'string' ? body.password.slice(0, 200) : '';
  if (!email || !password) return NextResponse.json({ ok: false, error: 'Informe e-mail e senha.' }, { status: 400 });

  const { status, data } = await callApi('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }, meta);
  const res = data as { ok: boolean; token?: string; expiresAt?: string; user?: unknown; error?: string };
  if (!res.ok || !res.token || !res.expiresAt) {
    attempts.set(meta.ip, [...recent, now]);
    return NextResponse.json({ ok: false, error: res.error ?? 'Não foi possível entrar.' }, { status: status >= 400 ? status : 401 });
  }
  attempts.delete(meta.ip);
  const out = NextResponse.json({ ok: true, user: res.user });
  out.cookies.set(SESSION_COOKIE, res.token, sessionCookieOptions(res.expiresAt));
  return out;
}
