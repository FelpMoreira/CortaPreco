'use client';

import { useCallback, useEffect, useState } from 'react';
import { LuListOrdered, LuMousePointerClick, LuSend, LuTriangleAlert } from 'react-icons/lu';
import { CategorySelect, StatCard } from './ui';
import { adminFetch, Badge, brl, fmtDate, STATUS_LABEL, Thumb, type Notify, type PostRow, type ProductRow } from './common';

/** Carrega dados e recarrega sob demanda (e opcionalmente em intervalo). */
function useLoad<T>(fn: () => Promise<T>, notify: Notify, pollMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try {
      setData(await fn());
    } catch (e) {
      notify('error', (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [fn, notify]);
  useEffect(() => {
    void load();
    if (!pollMs) return;
    const t = setInterval(() => document.visibilityState === 'visible' && void load(), pollMs);
    return () => clearInterval(t);
  }, [load, pollMs]);
  return { data, loading, reload: load };
}

// ---------------------------------------------------------------- produtos

export function ProductsTab({ notify, onPost }: { notify: Notify; onPost: (p: ProductRow) => void }) {
  const fetchProducts = useCallback(
    () => adminFetch<{ products: ProductRow[] }>('products').then((r) => r.products),
    [],
  );
  const { data, loading, reload } = useLoad(fetchProducts, notify);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  async function setStatus(p: ProductRow, status: string) {
    setBusy(p.id);
    try {
      await adminFetch(`products/${p.id}`, { method: 'PATCH', body: { status } });
      await reload();
    } catch (e) {
      notify('error', (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const items = (data ?? []).filter((p) => p.title.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="card">
      <div className="spread" style={{ marginBottom: 12 }}>
        <input
          className="input"
          style={{ maxWidth: 320 }}
          placeholder="Buscar por título…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="btn ghost sm" onClick={() => void reload()}>
          Atualizar
        </button>
      </div>
      {loading ? (
        <p className="empty">Carregando…</p>
      ) : items.length === 0 ? (
        <p className="empty">{q ? 'Nada encontrado.' : 'Nenhum produto ainda. Comece em “Nova oferta”.'}</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th />
                <th>Produto</th>
                <th className="num">Preço</th>
                <th className="num">Desc.</th>
                <th>Categoria</th>
                <th>Status</th>
                <th className="num">Posts</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id}>
                  <td style={{ width: 56 }}>
                    <Thumb src={p.imageUrl} size={40} />
                  </td>
                  <td style={{ minWidth: 220 }}>
                    <span className={`badge ${p.store}`}>{p.store}</span>{' '}
                    <a href={p.url} target="_blank" rel="noopener noreferrer" className="clamp" style={{ textDecoration: 'none' }}>
                      {p.title}
                    </a>
                  </td>
                  <td className="num">{Number(p.price) > 0 ? brl(p.price) : <span className="warn">sem preço</span>}</td>
                  <td className="num">{p.discountPct ? `-${p.discountPct}%` : '—'}</td>
                  <td>
                    <CategorySelect
                      value={p.category}
                      disabled={busy === p.id}
                      onChange={(category) =>
                        void adminFetch(`products/${p.id}`, { method: 'PATCH', body: { category } })
                          .then(reload)
                          .catch((e: Error) => notify('error', e.message))
                      }
                    />
                  </td>
                  <td>
                    <Badge value={p.status} />
                  </td>
                  <td className="num">{p._count?.posts ?? 0}</td>
                  <td>
                    <div className="row" style={{ flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                      <button className="btn sm" onClick={() => onPost(p)}>
                        Postar
                      </button>
                      {p.status === 'FILTERED' ? (
                        <button className="btn ghost sm" disabled={busy === p.id} onClick={() => void setStatus(p, 'NEW')}>
                          Restaurar
                        </button>
                      ) : (
                        <button className="btn danger sm" disabled={busy === p.id} onClick={() => void setStatus(p, 'FILTERED')}>
                          Descartar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- posts

const POST_FILTERS = ['', 'SCHEDULED', 'POSTING', 'POSTED', 'FAILED', 'CANCELED'];

export function PostsTab({ notify, channels }: { notify: Notify; channels: { id: string; name: string }[] }) {
  const [status, setStatus] = useState('');
  const [channelId, setChannelId] = useState('');
  const fetchPosts = useCallback(() => {
    const q = new URLSearchParams();
    if (status) q.set('status', status);
    if (channelId) q.set('channelId', channelId);
    const qs = q.toString();
    return adminFetch<{ posts: PostRow[]; publicBaseUrl: string | null }>(`posts${qs ? `?${qs}` : ''}`);
  }, [status, channelId]);
  const { data, loading, reload } = useLoad(fetchPosts, notify, 20_000);
  const [busy, setBusy] = useState<string | null>(null);

  async function act(p: PostRow, action: 'cancel' | 'requeue' | 'publish') {
    if (action === 'requeue' && p.lastError?.includes('interrompido')) {
      if (!window.confirm('Esse envio foi interrompido e pode ter chegado ao canal. Confira antes. Reenviar mesmo assim?')) return;
    }
    setBusy(p.id);
    try {
      await adminFetch(`posts/${p.id}/${action}`, { method: 'POST' });
      notify(
        'success',
        action === 'cancel' ? 'Post cancelado.' : action === 'publish' ? 'Enviando para o canal agora.' : 'Post voltou para a fila.',
      );
      await reload();
    } catch (e) {
      notify('error', (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const posts = data?.posts ?? [];

  return (
    <div className="grid" style={{ gap: 12 }}>
      <div className="spread">
        <div className="chips" role="group" aria-label="Filtrar por status">
          {POST_FILTERS.map((s) => (
            <button key={s || 'all'} className="chip" aria-pressed={status === s} onClick={() => setStatus(s)}>
              {s ? STATUS_LABEL[s] : 'Todos'}
            </button>
          ))}
          {channels.length > 1 && (
            <select className="input" style={{ width: 'auto', padding: '4px 10px', fontSize: 13 }} value={channelId} onChange={(e) => setChannelId(e.target.value)} aria-label="Filtrar por grupo">
              <option value="">Todos os grupos</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <button className="btn ghost sm" onClick={() => void reload()}>
          Atualizar
        </button>
      </div>

      {data && !data.publicBaseUrl && (
        <p className="card warn" style={{ margin: 0 }}>
          PUBLIC_BASE_URL não configurada: os posts usam o link de afiliado direto e os cliques não são contados.
        </p>
      )}

      {loading ? (
        <p className="empty">Carregando…</p>
      ) : posts.length === 0 ? (
        <p className="card empty">Nenhum post {status ? `com status “${STATUS_LABEL[status]}”` : 'ainda'}.</p>
      ) : (
        posts.map((p) => (
          <article key={p.id} className="card" style={{ display: 'flex', gap: 12 }}>
            <Thumb src={p.product.imageUrl} />
            <div style={{ minWidth: 0, flex: 1, display: 'grid', gap: 6 }}>
              <div className="spread">
                <div className="row">
                  <Badge value={p.status} />
                  <span className={`badge ${p.product.store}`}>{p.product.store}</span>
                  {p.channel && <span className={`badge ${p.channel.platform}`}>{p.channel.name}</span>}
                  <span className="muted">
                    {p.postedAt ? `publicado ${fmtDate(p.postedAt)}` : `criado ${fmtDate(p.createdAt)}`}
                  </span>
                </div>
                <span className="muted">
                  <strong style={{ color: 'var(--text)' }}>{p._count.clicks}</strong> cliques
                </span>
              </div>
              <strong className="clamp" style={{ fontSize: 14 }}>{p.product.title}</strong>
              {p.status === 'FAILED' && p.lastError && <p className="err" style={{ margin: 0, fontSize: 13 }}>{p.lastError}</p>}
              <details>
                <summary className="muted" style={{ cursor: 'pointer' }}>Mensagem e link</summary>
                <pre className="pre" style={{ maxHeight: 220, overflow: 'auto' }}>{p.message}</pre>
                <p className="muted" style={{ wordBreak: 'break-all', margin: '4px 0 0' }}>
                  Afiliado:{' '}
                  <a href={p.affiliateUrl} target="_blank" rel="noopener noreferrer">
                    {p.affiliateUrl}
                  </a>
                  {p.subId ? ` · subID ${p.subId}` : ''}
                </p>
              </details>
              <div className="row">
                {p.status === 'SCHEDULED' && (
                  <>
                    <button className="btn sm" disabled={busy === p.id} onClick={() => void act(p, 'publish')}>
                      <LuSend size={14} /> Postar agora
                    </button>
                    <button className="btn danger sm" disabled={busy === p.id} onClick={() => void act(p, 'cancel')}>
                      Cancelar
                    </button>
                  </>
                )}
                {(p.status === 'FAILED' || p.status === 'CANCELED') && (
                  <button className="btn ghost sm" disabled={busy === p.id} onClick={() => void act(p, 'requeue')}>
                    Reenviar
                  </button>
                )}
              </div>
            </div>
          </article>
        ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------- métricas

interface Stats {
  clicks: number;
  clicks24h: number;
  scheduled: number;
  posted: number;
  posted24h: number;
  failed: number;
  postedWithClicks: number;
  top: { id: string; product: { title: string; store: string }; _count: { clicks: number } }[];
}

export function MetricsTab({ notify }: { notify: Notify }) {
  const fetchStats = useCallback(() => adminFetch<Stats>('stats'), []);
  const { data: s, loading } = useLoad(fetchStats, notify, 60_000);
  if (loading || !s) return <p className="empty">Carregando…</p>;

  const tiles: [string, number, string][] = [
    ['Cliques', s.clicks, `${s.clicks24h} nas últimas 24h`],
    ['Publicados', s.posted, `${s.posted24h} nas últimas 24h`],
    ['Na fila', s.scheduled, 'aguardando o scheduler'],
    ['Falhas', s.failed, 'reenvie pela aba Posts'],
  ];

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="stats">
        {tiles.map(([label, value, hint], i) => (
          <StatCard
            key={label}
            label={label}
            value={value}
            hint={hint}
            icon={[<LuMousePointerClick key="c" size={16} />, <LuSend key="p" size={16} />, <LuListOrdered key="f" size={16} />, <LuTriangleAlert key="x" size={16} />][i]}
            tone={(['amber', 'green', 'blue', value > 0 ? 'red' : 'green'] as const)[i]}
          />
        ))}
      </div>
      <div className="panel">
        <h3 className="panel-title">Posts com mais cliques</h3>
        <p className="muted">
          {s.postedWithClicks} de {s.posted} posts publicados tiveram ao menos um clique.
        </p>
        {s.top.length === 0 ? (
          <p className="empty">Sem cliques ainda.</p>
        ) : (
          <table className="table">
            <tbody>
              {s.top.map((t) => (
                <tr key={t.id}>
                  <td>
                    <span className={`badge ${t.product.store}`}>{t.product.store}</span> {t.product.title}
                  </td>
                  <td className="num">
                    <strong>{t._count.clicks}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
