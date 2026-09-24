import { NextResponse } from 'next/server';
import { callApi } from '@/lib/api';

/** Público: diz só se o primeiro acesso ainda não foi feito (nenhum usuário cadastrado). */
export async function GET() {
  const { data } = await callApi('/api/auth/status');
  const setupRequired = (data as { setupRequired?: boolean }).setupRequired === true;
  return NextResponse.json({ ok: true, setupRequired }, { headers: { 'Cache-Control': 'no-store' } });
}
