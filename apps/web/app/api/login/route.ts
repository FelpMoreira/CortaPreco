import { createHash, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, sessionCookieOptions, signSession } from '@/lib/auth';

// Limite de tentativas em memória (painel roda numa instância só).
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_IP = 5;
const MAX_GLOBAL = 30; // barra força bruta distribuída sem travar o dono por muito tempo
const failures = new Map<string, number[]>();

function recent(key: string, now: number): number[] {
  const list = (failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  failures.set(key, list);
  return list;
}

function clientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'local';
}

const digest = (s: string) => createHash('sha256').update(s).digest();

function passwordMatches(given: string): boolean {
  const expected = process.env.ADMIN_PASSWORD ?? '';
  if (expected.length < 12 && process.env.NODE_ENV === 'production') return false;
  if (!expected) return false;
  return timingSafeEqual(digest(given), digest(expected));
}

export async function POST(req: NextRequest) {
  const now = Date.now();
  const ip = clientIp(req);
  if (recent(ip, now).length >= MAX_PER_IP || recent('*', now).length >= MAX_GLOBAL) {
    return NextResponse.json(
      { ok: false, error: 'Muitas tentativas. Aguarde 15 minutos.' },
      { status: 429, headers: { 'Retry-After': String(WINDOW_MS / 1000) } },
    );
  }

  const body = (await req.json().catch(() => null)) as { password?: unknown } | null;
  const password = typeof body?.password === 'string' ? body.password.slice(0, 200) : '';

  if (!password || !passwordMatches(password)) {
    failures.get(ip)!.push(now);
    failures.get('*')!.push(now);
    return NextResponse.json({ ok: false, error: 'Senha incorreta' }, { status: 401 });
  }

  failures.delete(ip);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await signSession(), sessionCookieOptions);
  return res;
}
