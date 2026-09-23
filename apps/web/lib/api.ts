const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const ADMIN_KEY = process.env.ADMIN_API_KEY || '';

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ADMIN_KEY}`,
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });
  const body = (await res.json().catch(() => null)) as ({ ok?: boolean; error?: string } & T) | null;
  if (!res.ok) {
    throw new Error(body?.error ?? `API ${res.status} ${path}`);
  }
  return body as T;
}