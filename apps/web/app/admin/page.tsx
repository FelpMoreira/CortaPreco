'use client';

import { useCallback, useEffect, useState } from 'react';

interface ApiResponse<T> {
  ok: boolean;
  error?: string;
  data?: T;
}

interface ProductRow {
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
  createdAt: string;
}

interface PostRow {
  id: string;
  status: string;
  message: string;
  affiliateUrl: string;
  subId: string | null;
  postedAt: string | null;
  createdAt: string;
  _count: { clicks: number };
  product: { id: string; title: string; imageUrl: string | null };
}

interface Stats {
  clicks: number;
  scheduled: number;
  posted: number;
  postedWithClicks: number;
}

type Tab = 'nova' | 'produtos' | 'posts' | 'metricas';

const brl = (v: string | number | null | undefined): string | null => {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : null;
};

export default function AdminDashboard() {
  const [tab, setTab] = useState<Tab>('nova');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  return (
    <main style={{ maxWidth: 1080, margin: '0 auto', padding: '24px 16px 80px' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ margin: 0 }}>Painel de ofertas</h1>
        <button
          className="btn ghost"
          onClick={async () => {
            await fetch('/api/logout', { method: 'POST' });
            window.location.assign('/admin/login');
          }}
        >
          Sair
        </button>
      </header>

      <nav style={{ display: 'flex', gap: 8, margin: '20px 0', flexWrap: 'wrap' }}>
        {(
          [
            ['nova', '➕ Nova oferta'],
            ['produtos', 'Produtos'],
            ['posts', 'Posts'],
            ['metricas', 'Métricas'],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button key={id} className="btn ghost" onClick={() => setTab(id)} style={tab === id ? { background: 'var(--accent)', color: '#1a1400' } : {}}>
            {label}
          </button>
        ))}
      </nav>

      {error && <p className="err">{error}</p>}
      {ok && <p className="ok">{ok}</p>}

      {tab === 'nova' && <NewOffer onError={setError} onOk={setOk} />}
      {tab === 'produtos' && <Products />}
      {tab === 'posts' && <Posts />}
      {tab === 'metricas' && <Metrics />}
    </main>
  );
}

// ---------------------------------------------------------------- nova oferta

function NewOffer({ onError, onOk }: { onError: (s: string) => void; onOk: (s: string) => void }) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [product, setProduct] = useState<ProductRow | null>(null);
  const [message, setMessage] = useState('');
  const [scheduling, setScheduling] = useState(false);

  async function preview() {
    if (!url) return;
    setLoading(true);
    onError('');
    try {
      const res = await fetch('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const json = (await res.json()) as ApiResponse<{ product: ProductRow; message: string }>;
      if (!json.ok) {
        onError(json.error ?? 'Falha no preview');
        return;
      }
      setProduct(json.data!.product);
      setMessage(json.data!.message);
      onOk('Preview gerado. Confere os dados e agenda.');
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function schedule() {
    if (!product) return;
    setScheduling(true);
    onError('');
    try {
      const res = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: product.id, messageOverride: message }),
      });
      const json = (await res.json()) as ApiResponse<{ post: PostRow }>;
      if (!json.ok) {
        onError(json.error ?? 'Falha ao agendar');
        return;
      }
      onOk(`Post agendado (${json.data!.post.id}). O scheduler envia logo.`);
      setProduct(null);
      setMessage('');
      setUrl('');
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setScheduling(false);
    }
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card">
        <label className="muted">Cole a URL do produto (Shopee, AliExpress ou Amazon)</label>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <input
            className="input"
            placeholder="https://shopee.com.br/product/..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void preview()}
          />
          <button className="btn" onClick={() => void preview()} disabled={loading || !url}>
            {loading ? 'Buscando…' : 'Preview'}
          </button>
        </div>
      </div>

      {product && (
        <div className="card">
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            {product.imageUrl ? <img className="pthumb" src={product.imageUrl} alt="" style={{ width: 72, height: 72 }} /> : null}
            <div>
              <span className={`badge ${product.store}`}>{product.store}</span>
              <p style={{ margin: '6px 0' }}>
                <strong>{product.title}</strong>
              </p>
              <p className="muted" style={{ margin: 0 }}>
                {brl(product.price)}
                {product.oldPrice && Number(product.oldPrice) > Number(product.price) ? (
                  <>
                    {' '}
                    <s>{brl(product.oldPrice)}</s> (-{product.discountPct ?? Math.round((1 - Number(product.price) / Number(product.oldPrice)) * 100)}%)
                  </>
                ) : null}
                {product.coupon ? ` · cupom ${product.coupon}` : ''}
                {' '}· status <strong>{product.status}</strong>
              </p>
            </div>
          </div>

          <label className="muted" style={{ display: 'block', margin: '16px 0 6px' }}>
            Mensagem do post (editável)
          </label>
          <textarea className="textarea" value={message} onChange={(e) => setMessage(e.target.value)} />
          <button className="btn" style={{ marginTop: 12 }} onClick={() => void schedule()} disabled={scheduling}>
            {scheduling ? 'Agendando…' : '📅 Agendar post'}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- produtos

function Products() {
  const [items, setItems] = useState<ProductRow[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/products');
      const json = (await res.json()) as { ok: boolean; products: ProductRow[]; error?: string };
      if (!json.ok) setError(json.error ?? 'Erro');
      else setItems(json.products ?? []);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => void load(), [load]);

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>Produtos</h2>
        <button className="btn ghost" onClick={() => void load()}>Atualizar</button>
      </div>
      {error && <p className="err">{error}</p>}
      {items.length === 0 ? (
        <p className="muted">Nada coletado ainda.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
          <thead>
            <tr className="muted" style={{ textAlign: 'left' }}>
              <th style={{ padding: 8 }}>Loja</th>
              <th style={{ padding: 8 }}>Título</th>
              <th style={{ padding: 8 }}>Preço</th>
              <th style={{ padding: 8 }}>Desconto</th>
              <th style={{ padding: 8 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: 8 }} className="muted">{p.store}</td>
                <td style={{ padding: 8 }}>{p.title.slice(0, 60)}…</td>
                <td style={{ padding: 8 }}>{brl(p.price)}</td>
                <td style={{ padding: 8 }}>{p.discountPct ? `-${p.discountPct}%` : '—'}</td>
                <td style={{ padding: 8 }}>
                  <span className={`badge ${p.status}`}>{p.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- posts

function Posts() {
  const [items, setItems] = useState<PostRow[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/posts');
      const json = (await res.json()) as { ok: boolean; posts: PostRow[]; error?: string };
      if (!json.ok) setError(json.error ?? 'Erro');
      else setItems(json.posts ?? []);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => void load(), [load]);

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>Posts</h2>
        <button className="btn ghost" onClick={() => void load()}>Atualizar</button>
      </div>
      {error && <p className="err">{error}</p>}
      {items.length === 0 ? (
        <p className="muted">Nenhum post.</p>
      ) : (
        <div className="grid" style={{ marginTop: 12 }}>
          {items.map((p) => (
            <div key={p.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                <span className={`badge ${p.status}`}>{p.status}</span>
                <span className="muted">cliques: {p._count.clicks}</span>
              </div>
              <p style={{ margin: '8px 0', fontSize: 14 }}>{p.product.title}</p>
              <pre className="pre" style={{ maxHeight: 160, overflow: 'auto' }}>{p.message}</pre>
              <a className="muted" href={p.affiliateUrl} target="_blank" rel="noreferrer" style={{ wordBreak: 'break-all' }}>
                {p.affiliateUrl}
              </a>
              {p.subId ? <p className="muted" style={{ margin: '4px 0 0' }}>subID: {p.subId}</p> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- métricas

function Metrics() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/stats');
      const json = (await res.json()) as { ok: boolean; error?: string } & Partial<Stats>;
      if (!json.ok) setError(json.error ?? 'Erro');
      else setStats({ clicks: json.clicks ?? 0, scheduled: json.scheduled ?? 0, posted: json.posted ?? 0, postedWithClicks: json.postedWithClicks ?? 0 });
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => void load(), [load]);

  if (error) return <p className="err">{error}</p>;
  if (!stats) return <p className="muted">Carregando…</p>;

  return (
    <div className="grid cols-3">
      <div className="card">
        <h2 style={{ margin: 0 }}>{stats.clicks}</h2>
        <p className="muted" style={{ marginTop: 6 }}>Cliques rastreados</p>
      </div>
      <div className="card">
        <h2 style={{ margin: 0 }}>{stats.posted}</h2>
        <p className="muted" style={{ marginTop: 6 }}>Posts publicados ({stats.postedWithClicks} com clique)</p>
      </div>
      <div className="card">
        <h2 style={{ margin: 0 }}>{stats.scheduled}</h2>
        <p className="muted" style={{ marginTop: 6 }}>Na fila (SCHEDULED)</p>
      </div>
    </div>
  );
}