'use client';

import { useCallback, useEffect, useState } from 'react';
import { LuBan, LuCheck, LuCopy, LuFlaskConical, LuPaperclip, LuRefreshCw, LuTicketPercent } from 'react-icons/lu';
import { adminFetch, fmtDate, type Notify } from './common';
import { PageHeader } from './ui';

/**
 * Cupons coletados dos grupos de cupons (fonte "Grupo de cupons" num canal, cofre/11).
 * Mercado Livre é testado sozinho na conta de afiliado; as outras lojas valem 24 h e podem ser marcadas à mão.
 * "Junto dos posts" = o cupom vai na linha "🎟️ Cupom" das ofertas da mesma loja (só cupom geral e válido).
 */

interface CouponRow {
  id: string;
  store: string;
  code: string;
  title: string;
  minPurchase: string | null;
  maxDiscount: string | null;
  scope: string | null;
  attachable: boolean;
  status: 'NEW' | 'VALID' | 'RESTRICTED' | 'INVALID' | 'EXPIRED';
  statusDetail: string | null;
  checkedAt: string | null;
  expiresAt: string | null;
  sourceLink: string | null;
  seenCount: number;
  lastSeenAt: string;
  postAt: string | null;
  postedAt: string | null;
  postError: string | null;
  usedInPosts: number;
  source: { label: string; chatTitle: string | null; telegramChat: string | null; channel: { name: string } } | null;
}

const STORE_NAME: Record<string, string> = { MERCADOLIVRE: 'Mercado Livre', AMAZON: 'Amazon', SHOPEE: 'Shopee', ALIEXPRESS: 'AliExpress' };
const STATUS: Record<CouponRow['status'], { label: string; badge: string }> = {
  NEW: { label: 'Não testado', badge: 'SCHEDULED' },
  VALID: { label: 'Válido', badge: 'POSTED' },
  RESTRICTED: { label: 'Restrito', badge: 'FILTERED' },
  INVALID: { label: 'Inválido', badge: 'FAILED' },
  EXPIRED: { label: 'Vencido', badge: 'CANCELED' },
};
const FILTERS: ['' | CouponRow['status'], string][] = [
  ['', 'Todos'],
  ['VALID', 'Válidos'],
  ['NEW', 'Não testados'],
  ['RESTRICTED', 'Restritos'],
  ['INVALID', 'Inválidos'],
  ['EXPIRED', 'Vencidos'],
];

const brl = (v: string | null) => (v ? Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : null);

export function CouponsTab({ notify }: { notify: Notify }) {
  const [status, setStatus] = useState<'' | CouponRow['status']>('');
  const [store, setStore] = useState('');
  const [data, setData] = useState<{ coupons: CouponRow[]; counts: Record<string, number> } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const q = new URLSearchParams();
    if (status) q.set('status', status);
    if (store) q.set('store', store);
    try {
      setData(await adminFetch(`coupons${q.toString() ? `?${q}` : ''}`));
    } catch (e) {
      notify('error', (e as Error).message);
    }
  }, [status, store, notify]);

  useEffect(() => {
    void load();
    const t = setInterval(() => document.visibilityState === 'visible' && void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  async function act(c: CouponRow, what: 'test' | 'valid' | 'invalid' | 'attach') {
    setBusy(c.id);
    try {
      if (what === 'test') {
        await adminFetch(`coupons/${c.id}/test`, { method: 'POST' });
        notify('success', 'Testando na conta de afiliado… o resultado aparece em instantes.');
      } else {
        const body = what === 'attach' ? { attachable: !c.attachable } : { status: what === 'valid' ? 'VALID' : 'INVALID' };
        await adminFetch(`coupons/${c.id}`, { method: 'PATCH', body });
      }
      await load();
    } catch (e) {
      notify('error', (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      notify('success', `${code} copiado.`);
    } catch {
      /* navegador sem permissão de área de transferência */
    }
  }

  const counts = data?.counts ?? {};
  return (
    <div className="grid" style={{ gap: 14 }}>
      <PageHeader
        icon={<LuTicketPercent size={22} />}
        title="Cupons"
        subtitle="Coletados dos grupos de cupons. Os gerais e válidos vão junto dos posts da loja."
        actions={
          <button className="btn ghost sm" onClick={() => void load()}>
            <LuRefreshCw size={14} /> Atualizar
          </button>
        }
      />

      <div className="spread">
        <div className="chips" role="group" aria-label="Filtrar por status">
          {FILTERS.map(([s, label]) => (
            <button key={s || 'all'} className="chip" aria-pressed={status === s} onClick={() => setStatus(s)}>
              {label}
              {s && counts[s] ? ` (${counts[s]})` : ''}
            </button>
          ))}
        </div>
        <select className="input" style={{ width: 'auto', padding: '4px 10px', fontSize: 13 }} value={store} onChange={(e) => setStore(e.target.value)} aria-label="Loja">
          <option value="">Todas as lojas</option>
          {Object.entries(STORE_NAME).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>

      {!data ? (
        <span className="skeleton" style={{ height: 120 }} />
      ) : data.coupons.length === 0 ? (
        <p className="card empty">
          Nenhum cupom{status ? ` com status “${STATUS[status].label}”` : ''}. Adicione um <strong>Grupo de cupons</strong> em
          Administração → Canais.
        </p>
      ) : (
        <div className="coupon-grid">
          {data.coupons.map((c) => {
            const conds = [
              c.minPurchase && Number(c.minPurchase) > 1 ? `mínimo ${brl(c.minPurchase)}` : null,
              c.maxDiscount ? `até ${brl(c.maxDiscount)}` : null,
            ].filter(Boolean);
            return (
              <article key={c.id} className={`card coupon-card${c.status === 'INVALID' || c.status === 'EXPIRED' ? ' off' : ''}`}>
                <div className="spread" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                  <div style={{ minWidth: 0, display: 'grid', gap: 4 }}>
                    <span className="row" style={{ gap: 6 }}>
                      <span className={`badge ${c.store}`}>{STORE_NAME[c.store] ?? c.store}</span>
                      <span className={`badge ${STATUS[c.status].badge}`} title={c.statusDetail ?? ''}>
                        {STATUS[c.status].label}
                      </span>
                      {c.attachable && (
                        <span className="badge" title="Vai junto dos posts de produto desta loja">
                          <LuPaperclip size={10} /> junto dos posts
                        </span>
                      )}
                    </span>
                    <button className="coupon-code" onClick={() => void copy(c.code)} title="Copiar código">
                      {c.code} <LuCopy size={13} />
                    </button>
                    <strong style={{ fontSize: 14 }}>{c.title}</strong>
                    {(conds.length > 0 || c.scope) && (
                      <span className="muted">
                        {conds.join(' · ')}
                        {c.scope ? `${conds.length ? ' · ' : ''}${c.scope}` : ''}
                      </span>
                    )}
                  </div>
                </div>
                <div className="muted" style={{ fontSize: 12.5, display: 'grid', gap: 2 }}>
                  {c.statusDetail && <span>{c.statusDetail}{c.checkedAt ? ` (${fmtDate(c.checkedAt)})` : ''}</span>}
                  <span>
                    {c.expiresAt ? `Vale até ${fmtDate(c.expiresAt)}` : 'Validade não informada'} · visto {c.seenCount}× (último{' '}
                    {fmtDate(c.lastSeenAt)})
                    {c.usedInPosts ? ` · em ${c.usedInPosts} post(s)` : ''}
                  </span>
                  {c.source && (
                    <span>
                      Grupo: {c.source.chatTitle ?? c.source.telegramChat} → {c.source.channel.name}
                      {c.postedAt ? ` · publicado ${fmtDate(c.postedAt)}` : c.postAt ? ` · publica ${fmtDate(c.postAt)}` : ''}
                      {c.postError ? ` · ${c.postError}` : ''}
                    </span>
                  )}
                </div>
                <div className="row" style={{ gap: 6 }}>
                  {c.store === 'MERCADOLIVRE' && (
                    <button className="btn ghost sm" disabled={busy === c.id} onClick={() => void act(c, 'test')} title="Inserir o código na conta de afiliado e ver a resposta do ML">
                      <LuFlaskConical size={13} /> Testar
                    </button>
                  )}
                  {c.status !== 'VALID' && (
                    <button className="btn ghost sm" disabled={busy === c.id} onClick={() => void act(c, 'valid')}>
                      <LuCheck size={13} /> Funciona
                    </button>
                  )}
                  {c.status !== 'INVALID' && (
                    <button className="btn ghost sm" disabled={busy === c.id} onClick={() => void act(c, 'invalid')}>
                      <LuBan size={13} /> Não funciona
                    </button>
                  )}
                  <button className="btn ghost sm" disabled={busy === c.id} onClick={() => void act(c, 'attach')}>
                    <LuPaperclip size={13} /> {c.attachable ? 'Tirar dos posts' : 'Usar nos posts'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <p className="muted" style={{ margin: 0 }}>
        Links que vêm com os cupons no grupo são do afiliado que postou: não usamos nos nossos posts.
      </p>
    </div>
  );
}
