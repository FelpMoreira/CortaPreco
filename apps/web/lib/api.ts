import 'server-only';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const ADMIN_KEY = process.env.ADMIN_API_KEY || '';

/** Chamada server-side à API com a chave de admin. Nunca importar em componente client. */
export async function callApi(path: string, init?: RequestInit): Promise<{ status: number; data: unknown }> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${ADMIN_KEY}`,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    });
    const data = (await res.json().catch(() => null)) ?? { ok: false, error: `API respondeu ${res.status}` };
    return { status: res.status, data };
  } catch {
    return { status: 502, data: { ok: false, error: 'API fora do ar (npm run dev:api)' } };
  }
}
