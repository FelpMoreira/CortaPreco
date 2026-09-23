const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const TELEGRAM_URL = process.env.NEXT_PUBLIC_TELEGRAM_URL || '';

interface CatalogPost {
  id: string;
  postedAt: string | null;
  product: {
    store: string;
    title: string;
    imageUrl: string | null;
    price: string | number;
    oldPrice: string | number | null;
    discountPct: number | null;
    coupon: string | null;
  };
}

const STORE_NAME: Record<string, string> = { SHOPEE: 'Shopee', ALIEXPRESS: 'AliExpress', AMAZON: 'Amazon' };

function brl(v: string | number | null | undefined): string | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : null;
}

function since(iso: string | null): string {
  if (!iso) return '';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 60) return `há ${Math.max(min, 1)} min`;
  if (min < 24 * 60) return `há ${Math.round(min / 60)} h`;
  return `há ${Math.round(min / 1440)} d`;
}

// catálogo muda pouco: recalcula no máximo a cada minuto
export const revalidate = 60;

export default async function Home() {
  let posts: CatalogPost[] = [];
  let base = '';
  let failed = false;
  try {
    const res = await fetch(`${API_URL}/api/public/catalog`, { next: { revalidate: 60 }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(String(res.status));
    const json = (await res.json()) as { base: string; posts: CatalogPost[] };
    base = json.base;
    posts = json.posts;
  } catch {
    failed = true;
  }

  return (
    <main className="container">
      <section className="hero spread" style={{ alignItems: 'flex-end' }}>
        <div>
          <h1>🔥 Cupons &amp; Ofertas</h1>
          <p className="muted" style={{ fontSize: 16, margin: 0, maxWidth: 520 }}>
            Promoções garimpadas todo dia na Shopee, AliExpress e Amazon. Preços conferidos na hora da publicação.
          </p>
        </div>
        {TELEGRAM_URL && (
          <a className="btn" href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer">
            ✈️ Entrar no canal do Telegram
          </a>
        )}
      </section>

      <h2 id="ofertas" style={{ fontSize: 18 }}>
        Ofertas recentes
      </h2>

      {failed ? (
        <p className="card empty">Não foi possível carregar as ofertas agora. Tente de novo em instantes.</p>
      ) : posts.length === 0 ? (
        <p className="card empty">Nenhuma oferta publicada ainda. Em breve!</p>
      ) : (
        <div className="offers">
          {posts.map((p) => {
            const price = brl(p.product.price);
            const old = Number(p.product.oldPrice) > Number(p.product.price) ? brl(p.product.oldPrice) : null;
            return (
              <a
                key={p.id}
                className="offer"
                href={`${base}${p.id}`}
                target="_blank"
                rel="sponsored nofollow noopener noreferrer"
              >
                <div className="offer-img">
                  {p.product.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.product.imageUrl} alt={p.product.title} loading="lazy" referrerPolicy="no-referrer" />
                  ) : null}
                  {p.product.discountPct ? <span className="offer-off">-{p.product.discountPct}%</span> : null}
                </div>
                <div className="offer-body">
                  <span className="muted">
                    {STORE_NAME[p.product.store] ?? p.product.store} · {since(p.postedAt)}
                  </span>
                  <span className="clamp" style={{ fontSize: 14 }}>
                    {p.product.title}
                  </span>
                  <div style={{ marginTop: 'auto' }}>
                    {old && <div className="offer-old">{old}</div>}
                    {price && <div className="offer-price">{price}</div>}
                  </div>
                  {p.product.coupon && (
                    <span>
                      Cupom: <span className="coupon">{p.product.coupon}</span>
                    </span>
                  )}
                </div>
              </a>
            );
          })}
        </div>
      )}

      <footer className="footer muted">
        <p>
          <strong>Publicidade:</strong> os links desta página são links de afiliado. Se você comprar por eles, podemos
          receber uma comissão da loja, sem custo extra para você. Preços e disponibilidade podem mudar a qualquer
          momento; confira na loja antes de finalizar.
        </p>
      </footer>
    </main>
  );
}
