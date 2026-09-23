import { NextResponse } from 'next/server';
import { api } from '@/lib/api';

export async function GET(): Promise<NextResponse> {
  try {
    const data = await api('/api/stats');
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}