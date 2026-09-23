import { NextRequest, NextResponse } from 'next/server';
import { api } from '@/lib/api';

export async function POST(req: NextRequest) {
  const { url } = (await req.json()) as { url?: string };
  if (!url) return NextResponse.json({ ok: false, error: 'URL obrigatória' }, { status: 400 });
  try {
    const data = await api('/api/preview', { method: 'POST', body: JSON.stringify({ url }) });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}