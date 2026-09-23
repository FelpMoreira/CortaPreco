import { NextRequest, NextResponse } from 'next/server';
import { api } from '@/lib/api';

export async function GET(): Promise<NextResponse> {
  try {
    const data = await api('/api/posts');
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as { productId?: string; messageOverride?: string };
  if (!body.productId)
    return NextResponse.json({ ok: false, error: 'productId obrigatório' }, { status: 400 });
  try {
    const data = await api('/api/posts', {
      method: 'POST',
      body: JSON.stringify({ productId: body.productId, messageOverride: body.messageOverride }),
    });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}