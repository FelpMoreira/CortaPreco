'use client';

import { useEffect } from 'react';
import { LuX } from 'react-icons/lu';

export interface ProductRow {
  id: string;
  store: string;
  storeProductId: string;
  title: string;
  price: string;
  oldPrice: string | null;
  discountPct: number | null;
  coupon: string | null;
  imageUrl: string | null;
  url: string;
  status: string;
  updatedAt: string;
  _count?: { posts: number };
}

export interface PostRow {
  id: string;
  status: string;
  message: string;
  affiliateUrl: string;
  subId: string | null;
  lastError: string | null;
  postedAt: string | null;
  createdAt: string;
  _count: { clicks: number };
  product: { id: string; store: string; title: string; imageUrl: string | null };
  channel: { platform: string; name: string } | null;
}

export type Notify = (kind: 'success' | 'error', text: string) => void;

/** Chama a API pelo proxy do painel. Sessão expirada → volta pro login. */
export async function adminFetch<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/admin/${path}`, {
      method: init?.method ?? 'GET',
      headers: init?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new Error('Sem conexão com o painel');
  }
  if (res.status === 401) {
    window.location.assign('/admin/login');
    throw new Error('Sessão expirada');
  }
  const json = (await res.json().catch(() => null)) as ({ ok?: boolean; error?: string } & T) | null;
  if (!res.ok || !json?.ok) throw new Error(json?.error ?? `Erro ${res.status}`);
  return json;
}

export const brl = (v: string | number | null | undefined): string => {
  if (v == null || v === '') return '—';
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—';
};

/** Aceita "1.299,90", "1299,90" ou "1299.90". */
export function parseMoney(s: string): number | null {
  const t = s.trim().replace(/^R\$\s*/i, '');
  if (!t) return null;
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

export const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

export const STATUS_LABEL: Record<string, string> = {
  NEW: 'Novo',
  READY: 'Aprovado',
  FILTERED: 'Descartado',
  EXPIRED: 'Já postado',
  SCHEDULED: 'Agendado',
  POSTING: 'Enviando',
  POSTED: 'Publicado',
  FAILED: 'Falhou',
  CANCELED: 'Cancelado',
};

export function Badge({ value }: { value: string }) {
  return <span className={`badge ${value}`}>{STATUS_LABEL[value] ?? value}</span>;
}

export function Thumb({ src, size = 48 }: { src: string | null; size?: number }) {
  if (!src) return <div className="pthumb" style={{ width: size, height: size, background: 'var(--bg-hover)' }} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="pthumb" src={src} alt="" width={size} height={size} referrerPolicy="no-referrer" loading="lazy" />;
}

export function Toast({ kind, text, onClose }: { kind: 'success' | 'error'; text: string; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, kind === 'error' ? 8000 : 4000);
    return () => clearTimeout(t);
  }, [kind, text, onClose]);
  return (
    <div className={`toast ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <div className="spread" style={{ flexWrap: 'nowrap' }}>
        <span>{text}</span>
        <button className="btn ghost sm" onClick={onClose} aria-label="Fechar">
          <LuX size={14} />
        </button>
      </div>
    </div>
  );
}
