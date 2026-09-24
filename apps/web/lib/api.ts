import 'server-only';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const ADMIN_KEY = process.env.ADMIN_API_KEY || '';

export interface CallContext {
  /** Token da sessão do usuário do painel. */
  token?: string;
  ip?: string;
  ua?: string;
}

/** Chamada server-side à API (chave de servidor + sessão do usuário). Nunca importar em componente client. */
export async function callApi(
  path: string,
  init?: RequestInit,
  ctx: CallContext = {},
): Promise<{ status: number; data: unknown }> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${ADMIN_KEY}`,
        ...(ctx.token ? { 'x-session-token': ctx.token } : {}),
        ...(ctx.ip ? { 'x-client-ip': ctx.ip } : {}),
        ...(ctx.ua ? { 'x-client-ua': ctx.ua } : {}),
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    });
    const data = (await res.json().catch(() => null)) ?? { ok: false, error: `API respondeu ${res.status}` };
    return { status: res.status, data };
  } catch {
    return { status: 502, data: { ok: false, error: 'API fora do ar' } };
  }
}
