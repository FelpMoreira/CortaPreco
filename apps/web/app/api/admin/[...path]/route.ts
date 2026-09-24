import { NextRequest, NextResponse } from 'next/server';
import { callApi } from '@/lib/api';

// Proxy do painel → API. A sessão já foi checada no middleware; aqui só passa o que
// está na lista, então a ADMIN_API_KEY nunca serve para rota não prevista.
const ID = '[a-z0-9]{20,40}';
const ALLOWED: [method: string, path: RegExp][] = [
  ['POST', /^preview$/],
  ['GET', /^products$/],
  ['PATCH', new RegExp(`^products/${ID}$`)],
  ['GET', /^posts$/],
  ['POST', /^posts$/],
  ['POST', new RegExp(`^posts/${ID}/(cancel|requeue|publish)$`)],
  ['GET', /^stats$/],
  ['GET', /^suggestions$/],
  ['POST', /^suggestions\/(batch|discover)$/],
  ['POST', new RegExp(`^suggestions/${ID}/(approve|reject)$`)],
];

async function handle(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const path = (await params).path.join('/');
  if (!ALLOWED.some(([m, re]) => m === req.method && re.test(path))) {
    return NextResponse.json({ ok: false, error: 'Rota não encontrada' }, { status: 404 });
  }
  const query = req.nextUrl.searchParams.toString();
  const body = req.method === 'GET' ? undefined : await req.text();
  const { status, data } = await callApi(`/api/${path}${query ? `?${query}` : ''}`, { method: req.method, body });
  return NextResponse.json(data, { status });
}

export { handle as GET, handle as POST, handle as PATCH };
