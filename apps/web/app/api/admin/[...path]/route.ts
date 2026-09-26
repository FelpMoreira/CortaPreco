import { NextRequest, NextResponse } from 'next/server';
import { callApi } from '@/lib/api';
import { clientMeta, sessionToken } from '@/lib/auth';

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
  ['GET', /^overview$/],
  ['GET', /^queues$/],
  ['GET', /^channels$/],
  ['POST', /^channels$/],
  ['PATCH', new RegExp(`^channels/${ID}$`)],
  ['POST', new RegExp(`^channels/${ID}/test$`)],
  ['GET', /^sources\/presets$/],
  ['POST', new RegExp(`^channels/${ID}/sources$`)],
  ['PATCH', new RegExp(`^sources/${ID}$`)],
  ['POST', new RegExp(`^sources/${ID}/run$`)],
  ['GET', new RegExp(`^sources/${ID}/events$`)],
  ['POST', new RegExp(`^sources/${ID}/dismiss-alert$`)],
  ['GET', /^coupons$/],
  ['PATCH', new RegExp(`^coupons/${ID}$`)],
  ['POST', new RegExp(`^coupons/${ID}/test$`)],
  // conta e sessões do próprio usuário
  ['GET', /^auth\/me$/],
  ['POST', /^auth\/password$/],
  ['GET', /^auth\/sessions$/],
  ['POST', new RegExp(`^auth/sessions/${ID}/revoke$`)],
  // administração (a API exige perfil DEV)
  ['GET', /^users$/],
  ['POST', /^users$/],
  ['PATCH', new RegExp(`^users/${ID}$`)],
  ['POST', new RegExp(`^users/${ID}/(reset-password|revoke-sessions)$`)],
  ['GET', /^audit$/],
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
  const { status, data } = await callApi(
    `/api/${path}${query ? `?${query}` : ''}`,
    { method: req.method, body },
    { token: sessionToken(req), ...clientMeta(req) },
  );
  return NextResponse.json(data, { status });
}

export { handle as GET, handle as POST, handle as PATCH };
