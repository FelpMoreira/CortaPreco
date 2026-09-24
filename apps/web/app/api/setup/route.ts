import { NextRequest, NextResponse } from 'next/server';
import { callApi } from '@/lib/api';
import { clientMeta, SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth';

/** Primeiro acesso: cria o primeiro DEV (só funciona enquanto não existe nenhum usuário). */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const pick = (k: string) => (typeof body?.[k] === 'string' ? (body[k] as string).slice(0, 200) : '');
  const payload = { bootstrapPassword: pick('bootstrapPassword'), name: pick('name'), email: pick('email'), password: pick('password') };
  const { status, data } = await callApi('/api/auth/setup', { method: 'POST', body: JSON.stringify(payload) }, clientMeta(req));
  const res = data as { ok: boolean; token?: string; expiresAt?: string; error?: string };
  if (!res.ok || !res.token || !res.expiresAt) {
    return NextResponse.json({ ok: false, error: res.error ?? 'Não foi possível concluir.' }, { status: status >= 400 ? status : 400 });
  }
  const out = NextResponse.json({ ok: true });
  out.cookies.set(SESSION_COOKIE, res.token, sessionCookieOptions(res.expiresAt));
  return out;
}
