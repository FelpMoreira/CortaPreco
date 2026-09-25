import { NextRequest, NextResponse } from 'next/server';
import { callApi } from '@/lib/api';
import { clientMeta, SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth';

// 1ª barreira (em memória), por IP e por e-mail: trocar de IP não ajuda contra a mesma conta.
// A API tem a sua própria, e o bloqueio por conta (atômico) fica no banco.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_KEY = 10;
const attempts = new Map<string, number[]>();

function recentFor(key: string, now: number): number[] {
  return (attempts.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
}

export async function POST(req: NextRequest) {
  const meta = clientMeta(req);
  const now = Date.now();
  const body = (await req.json().catch(() => null)) as { email?: unknown; password?: unknown } | null;
  const email = typeof body?.email === 'string' ? body.email.slice(0, 200) : '';
  const password = typeof body?.password === 'string' ? body.password.slice(0, 200) : '';
  if (!email || !password) return NextResponse.json({ ok: false, error: 'Informe e-mail e senha.' }, { status: 400 });

  const keys = [`ip:${meta.ip}`, `mail:${email.trim().toLowerCase()}`];
  if (keys.some((k) => recentFor(k, now).length >= MAX_PER_KEY)) {
    return NextResponse.json({ ok: false, error: 'Muitas tentativas. Aguarde 15 minutos.' }, { status: 429 });
  }
  if (attempts.size > 10_000) {
    // teto de memória: descarta só o que já venceu (limpar tudo zeraria o limite de quem ataca)
    for (const [k, list] of attempts) if (!recentFor(k, now).length) attempts.delete(k);
  }

  const { status, data } = await callApi('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }, meta);
  const res = data as { ok: boolean; token?: string; expiresAt?: string; user?: unknown; error?: string };
  if (!res.ok || !res.token || !res.expiresAt) {
    for (const k of keys) attempts.set(k, [...recentFor(k, now), now]);
    return NextResponse.json({ ok: false, error: res.error ?? 'Não foi possível entrar.' }, { status: status >= 400 ? status : 401 });
  }
  for (const k of keys) attempts.delete(k);
  const out = NextResponse.json({ ok: true, user: res.user });
  out.cookies.set(SESSION_COOKIE, res.token, sessionCookieOptions(res.expiresAt));
  return out;
}
