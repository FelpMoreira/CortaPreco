const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface CatalogPost {
  id: string;
  message: string;
  postedAt: string | null;
  product: {
    id: string;
    store: string;
    title: string;
    imageUrl: string | null;
    price: string | number;
    oldPrice: string | number | null;
    discountPct: number | null;
    coupon: string | null;
    url: string;
  };
}

function brl(v: string | number | null | undefined): string | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export const dynamic = 'force-dynamic';

export default async function Home() {
  let posts: CatalogPost[] = [];
  let base = '';
  let error = '';
  try {
    const res = await fetch(`${API_URL}/api/public/catalog`, { cache: 'no-store' });
    const json = (await res.json()) as { base: string; posts: CatalogPost[] };
    base = json.base;
    posts = json.posts;
  } catch (e) {
    error = (e as Error).message;
  }

  return (
    <main style={{ maxWidth: 980, margin: '0 auto', padding: '32px 16px 80px' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0 }}>🔥 Cupons &amp; Ofertas</h1>
          <p className="muted" style={{ marginTop: 4 }}>
            As melhores promoções do dia, direto do seu canal no Telegram.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a className="btn" href="#catalogo">
            Ver ofertas
          </a>
        </div>
      </header>

      <section style={{ margin: '32px 0', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div className="card" style={{ flex: 1, minWidth: 260 }}>
          <h3>📱 Canal no Telegram</h3>
          <p className="muted">Receba todas as ofertas em tempo real.</p>
          <a className="btn" href="#entrar">
            Entrar no grupo
          </a>
        </div>
        <div className="card" style={{ flex: 1, minWidth: 260 }}>
          <h3>🏷️ Cupons exclusivos</h3>
          <p className="muted">Cupons e descontos validados diariamente.</p>
          <a className="btn ghost" href="#entrar">
            Quero participar
          </a>
        </div>
      </section>

      <h2 id="catalogo" style={{ marginTop: 8 }}>
        Ofertas recentes
      </h2>

      {error && <p className="err">Falha ao carregar catálogo: {error}</p>}

      {!error && posts.length === 0 && (
        <div className="card">
          <p className="muted">Nenhuma oferta publicada ainda. Em breve!</p>
        </div>
      )}

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        {posts.map((p) => (
          <article className="card" key={p.id} style={{ display: 'flex', gap: 12 }}>
            {p.product.imageUrl ? (
              <img className="pthumb" src={p.product.imageUrl} alt="" style={{ width: 72, height: 72 }} />
            ) : null}
            <div style={{ minWidth: 0 }}>
              <span className={`badge ${p.product.store}`}>{p.product.store}</span>
              <h3 style={{ margin: '6px 0 4px', fontSize: 15 }}>{p.product.title}</h3>
              <p style={{ margin: 0, fontWeight: 700 }}>
                {brl(p.product.price)}
                {p.product.oldPrice && Number(p.product.price) < Number(p.product.oldPrice) ? (
                  <>
                    {' '}
                    <span className="muted" style={{ textDecoration: 'line-through' }}>
                      {brl(p.product.oldPrice)}
                    </span>{' '}
                    <span className="ok">-{p.product.discountPct ?? Math.round((1 - Number(p.product.price) / Number(p.product.oldPrice)) * 100)}%</span>
                  </>
                ) : null}
              </p>
              {p.product.coupon ? (
                <p className="muted" style={{ margin: '4px 0 0' }}>
                  Cupom: <strong>{p.product.coupon}</strong>
                </p>
              ) : null}
              <a className="btn" href={`${base}${p.id}`} target="_blank" rel="noreferrer" style={{ marginTop: 10 }}>
                Ver oferta →
              </a>
            </div>
          </article>
        ))}
      </div>

      <section id="entrar" className="card" style={{ marginTop: 48, textAlign: 'center' }}>
        <h2>Quer receber no seu WhatsApp e Telegram?</h2>
        <p className="muted">Entra nos grupos, é grátis.</p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <span className="btn ghost">Telegram (em breve)</span>
          <span className="btn ghost">WhatsApp (em breve)</span>
        </div>
      </section>
    </main>
  );
}