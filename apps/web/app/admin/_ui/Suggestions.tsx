'use client';

import { useCallback, useEffect, useState } from 'react';
import { LuCheck, LuRefreshCw, LuSearch, LuSend, LuSparkles, LuX } from 'react-icons/lu';
import { LINK_PLACEHOLDER, renderMessageHtml, type Store } from '@cupons/shared';
import { telegramToSafeHtml } from '@/lib/telegram';
import { adminFetch, brl, fmtDate, STATUS_LABEL, Thumb, type Notify } from './common';
import { CategorySelect } from './ui';

interface SuggestionRow {
  id: string;
  source: string;
  curator: string;
  score: number;
  reason: string;
  hook: string | null;
  status: string;
  postId: string | null;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: { name: string } | null;
  channel: { id: string; name: string } | null;
  origin: { kind: string; label: string } | null;
  product: {
    id: string;
    store: string;
    title: string;
    imageUrl: string | null;
    price: string;
    oldPrice: string | null;
    discountPct: number | null;
    coupon: string | null;
    url: string;
    rating: string | null;
    sales: number | null;
    category: string | null;
  };
}

interface SuggestionsResponse {
  suggestions: SuggestionRow[];
  curator: string;
  discoverSources: string[];
  running: number;
}

const FILTERS = ['PENDING', 'APPROVED', 'REJECTED'] as const;
const FILTER_LABEL: Record<string, string> = { PENDING: 'Pendentes', APPROVED: 'Aprovadas', REJECTED: 'Rejeitadas' };
const HOOK_INVALID = /\d|R\$|%|https?:|www\.|<|>/i;

export function SuggestionsTab({ notify }: { notify: Notify }) {
  const [status, setStatus] = useState<(typeof FILTERS)[number]>('PENDING');
  const [channelId, setChannelId] = useState('');
  const [channels, setChannels] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    adminFetch<{ channels: { id: string; name: string }[] }>('channels')
      .then((r) => setChannels(r.channels))
      .catch(() => undefined);
  }, []);
  const [data, setData] = useState<SuggestionsResponse | null>(null);
  const [urls, setUrls] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await adminFetch<SuggestionsResponse>(`suggestions?status=${status}${channelId ? `&channelId=${channelId}` : ''}`));
    } catch (e) {
      notify('error', (e as Error).message);
    }
  }, [status, channelId, notify]);

  // enquanto há lote rodando no worker, atualiza sozinho
  useEffect(() => {
    void load();
    const t = setInterval(() => document.visibilityState === 'visible' && void load(), data?.running ? 5000 : 30000);
    return () => clearInterval(t);
  }, [load, data?.running]);

  const list = urls
    .split(/\s+/)
    .map((u) => u.trim())
    .filter((u) => /^https?:\/\//i.test(u));

  async function sendBatch() {
    if (list.length === 0) return;
    if (list.length > 15) {
      notify('error', 'Máximo de 15 links por lote.');
      return;
    }
    setSending(true);
    try {
      await adminFetch('suggestions/batch', { method: 'POST', body: { urls: list } });
      notify('success', `Lote com ${list.length} links enviado. A curadoria leva uns ${Math.ceil(list.length * 3 + 20)}s.`);
      setUrls('');
      setStatus('PENDING');
      await load();
    } catch (e) {
      notify('error', (e as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function discoverNow() {
    try {
      await adminFetch('suggestions/discover', { method: 'POST' });
      notify('success', 'Busca de ofertas iniciada. As sugestões aparecem aqui em instantes.');
      await load();
    } catch (e) {
      notify('error', (e as Error).message);
    }
  }

  const items = data?.suggestions ?? [];
  const usingAI = data?.curator && data.curator !== 'rules';

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card grid" style={{ gap: 12 }}>
        <div className="spread">
          <div className="row">
            <LuSparkles size={18} style={{ color: 'var(--accent)' }} />
            <strong>Curadoria</strong>
            <span className="badge">{usingAI ? data?.curator : 'só regras (sem IA)'}</span>
            {data?.running ? (
              <span className="muted">
                <LuRefreshCw size={12} /> processando lote…
              </span>
            ) : null}
          </div>
          {data?.discoverSources.length ? (
            <button className="btn ghost sm" onClick={() => void discoverNow()}>
              <LuSearch size={14} /> Buscar ofertas agora ({data.discoverSources.join(', ')})
            </button>
          ) : null}
        </div>
        <label className="field">
          <span>Cole links de produtos, um por linha (até 15). A curadoria escolhe os melhores e escreve a chamada.</span>
          <textarea
            className="textarea"
            style={{ minHeight: 110 }}
            placeholder={'https://www.amazon.com.br/dp/...\nhttps://www.amazon.com.br/dp/...'}
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
          />
        </label>
        <div className="row">
          <button className="btn" onClick={() => void sendBatch()} disabled={sending || list.length === 0}>
            {sending ? 'Enviando…' : `Enviar ${list.length || ''} para curadoria`}
          </button>
          {!usingAI && (
            <span className="muted">
              Para a IA escolher e escrever: <code>LLM_PROVIDER=claude</code> no <code>.env</code>.
            </span>
          )}
        </div>
      </div>

      <div className="spread">
        <div className="chips" role="group" aria-label="Filtrar sugestões">
          {FILTERS.map((f) => (
            <button key={f} className="chip" aria-pressed={status === f} onClick={() => setStatus(f)}>
              {FILTER_LABEL[f]}
            </button>
          ))}
        </div>
        {channels.length > 1 && (
          <select className="input" style={{ width: 'auto', padding: '6px 10px' }} value={channelId} onChange={(e) => setChannelId(e.target.value)}>
            <option value="">Todos os canais</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                Para: {c.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {!data ? (
        <p className="empty">Carregando…</p>
      ) : items.length === 0 ? (
        <p className="card empty">
          {status === 'PENDING' ? 'Nenhuma sugestão aguardando. Cole links acima para começar.' : 'Nada por aqui.'}
        </p>
      ) : (
        items.map((s) => <SuggestionCard key={s.id} s={s} notify={notify} onDone={load} />)
      )}
    </div>
  );
}

function SuggestionCard({ s, notify, onDone }: { s: SuggestionRow; notify: Notify; onDone: () => Promise<void> }) {
  const [hook, setHook] = useState(s.hook ?? '');
  const [category, setCategory] = useState(s.product.category);
  const [busy, setBusy] = useState(false);
  const p = s.product;
  const price = Number(p.price);
  const oldPrice = p.oldPrice ? Number(p.oldPrice) : null;
  const hookError = hook && (HOOK_INVALID.test(hook) || hook.length > 140);
  const pending = s.status === 'PENDING';

  const message = renderMessageHtml({
    store: p.store as Store,
    title: p.title,
    price,
    oldPrice,
    coupon: p.coupon,
    discountPct: p.discountPct,
    affiliateUrl: LINK_PLACEHOLDER,
    hook: hook.trim() || null,
  });

  async function decide(action: 'approve' | 'reject', now = false) {
    setBusy(true);
    try {
      const res = await adminFetch<{ published?: boolean; publishError?: string }>(`suggestions/${s.id}/${action}`, {
        method: 'POST',
        body: action === 'approve' ? { hook: hook.trim() || null, publishNow: now } : undefined,
      });
      if (action === 'reject') notify('success', 'Sugestão rejeitada.');
      else if (res.publishError) notify('error', `Aprovada e agendada, mas não postou agora: ${res.publishError}`);
      else notify('success', res.published ? 'Aprovada e enviando para o canal agora.' : 'Aprovada e agendada.');
      await onDone();
    } catch (e) {
      notify('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card" style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 12 }}>
        <Thumb src={p.imageUrl} size={64} />
        <div style={{ minWidth: 0, flex: 1, display: 'grid', gap: 4 }}>
          <div className="spread">
            <div className="row">
              <span className={`badge ${p.store}`}>{p.store}</span>
              <span className="badge" title="Nota da curadoria (0-100)">
                {s.score}
              </span>
              {!pending && <span className={`badge ${s.status === 'APPROVED' ? 'POSTED' : 'CANCELED'}`}>{STATUS_LABEL[s.status] ?? s.status}</span>}
            </div>
            <span className="muted">
              {s.channel ? <strong style={{ color: 'var(--text)' }}>Para: {s.channel.name} · </strong> : null}
              {s.origin ? `fonte: ${s.origin.label} · ` : ''}
              {s.curator} · {fmtDate(s.decidedAt ?? s.createdAt)}
              {s.decidedBy ? ` · por ${s.decidedBy.name}` : ''}
            </span>
          </div>
          <a href={p.url} target="_blank" rel="noopener noreferrer" className="clamp" style={{ textDecoration: 'none', fontWeight: 600 }}>
            {p.title}
          </a>
          <span className="muted">
            {brl(price)}
            {oldPrice && oldPrice > price ? ` · de ${brl(oldPrice)} (-${p.discountPct ?? Math.round((1 - price / oldPrice) * 100)}%)` : ' · sem desconto'}
            {p.rating ? ` · nota ${Number(p.rating).toFixed(1)}` : ''}
            {p.sales ? ` · ${p.sales} vendidos` : ''}
          </span>
          <span className="muted" style={{ fontStyle: 'italic' }}>
            {s.reason}
          </span>
          {pending && (
            <CategorySelect
              value={category}
              disabled={busy}
              onChange={(slug) => {
                setCategory(slug);
                adminFetch(`products/${p.id}`, { method: 'PATCH', body: { category: slug } }).catch((e: Error) => notify('error', e.message));
              }}
            />
          )}
        </div>
      </div>

      {pending && (
        <label className="field">
          <span>Chamada do post (opcional, sem números)</span>
          <input className="input" value={hook} onChange={(e) => setHook(e.target.value)} maxLength={200} placeholder="Ex.: Para quem vive sem pilha em casa." />
          {hookError ? <span className="err">Sem números, preços, %, links ou HTML (máx. 140).</span> : null}
        </label>
      )}

      <details>
        <summary className="muted" style={{ cursor: 'pointer' }}>Ver como fica no canal</summary>
        <div className="tg" style={{ marginTop: 8 }}>
          <div className="tg-bubble">
            <div
              className="tg-text"
              // seguro: telegramToSafeHtml escapa tudo exceto tags de formatação sem atributos
              dangerouslySetInnerHTML={{
                __html: telegramToSafeHtml(message).replaceAll(LINK_PLACEHOLDER, 'https://…/c/<i>id-do-post</i>'),
              }}
            />
          </div>
        </div>
      </details>

      {pending && (
        <div className="row">
          <button className="btn sm" disabled={busy || !!hookError} onClick={() => void decide('approve', true)}>
            <LuSend size={14} /> Aprovar e postar agora
          </button>
          <button className="btn ghost sm" disabled={busy || !!hookError} onClick={() => void decide('approve')}>
            <LuCheck size={14} /> Aprovar e agendar
          </button>
          <button className="btn danger sm" disabled={busy} onClick={() => void decide('reject')}>
            <LuX size={14} /> Rejeitar
          </button>
        </div>
      )}
    </article>
  );
}
