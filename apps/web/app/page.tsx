import type { Metadata } from 'next';
import {
  LuArrowRight,
  LuArrowUpRight,
  LuBadgeCheck,
  LuBellOff,
  LuCheck,
  LuClock,
  LuFlame,
  LuPackage,
  LuPercent,
  LuPlus,
  LuSearch,
  LuShieldCheck,
  LuSmartphone,
  LuStore,
  LuTag,
  LuTarget,
  LuTicket,
  LuTrendingDown,
  LuWallet,
} from 'react-icons/lu';
import { SiTelegram } from 'react-icons/si';
import { ThemeToggle } from '@/components/ThemeToggle';
import './landing.css';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const TELEGRAM_URL = process.env.NEXT_PUBLIC_TELEGRAM_URL || '';
const POSTS_PER_DAY = Number(process.env.POSTS_PER_DAY || 10);

export const metadata: Metadata = {
  title: 'CortaPreço — ofertas e cupons conferidos, direto no Telegram',
  description:
    'Promoções garimpadas todo dia na Shopee, AliExpress e Amazon. Preço conferido antes de publicar, cupons e zero spam. Grátis.',
  openGraph: {
    title: 'CortaPreço — ofertas e cupons conferidos',
    description: 'Promoções da Shopee, AliExpress e Amazon com preço conferido. Grátis, direto no Telegram.',
    type: 'website',
    locale: 'pt_BR',
  },
};

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

interface Catalog {
  base: string;
  stats?: { totalPosted: number; postedThisWeek: number; bestDiscountWeek: number | null };
  /** página pedida, total de ofertas (um card por produto) e de páginas, 24 por página */
  page: number;
  pages: number;
  total: number;
  /** destaque do topo: oferta mais recente com foto, de qualquer loja */
  featured: CatalogPost | null;
  posts: CatalogPost[];
}

const STORES = [
  { key: 'SHOPEE', slug: 'shopee', name: 'Shopee', cls: 'shopee' },
  { key: 'ALIEXPRESS', slug: 'aliexpress', name: 'AliExpress', cls: 'ali' },
  { key: 'AMAZON', slug: 'amazon', name: 'Amazon', cls: 'amazon' },
  { key: 'MERCADOLIVRE', slug: 'mercadolivre', name: 'Mercado Livre', cls: 'meli' },
] as const;
const STORE_NAME: Record<string, string> = Object.fromEntries(STORES.map((s) => [s.key, s.name]));

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

const discountOf = (p: CatalogPost['product']) =>
  p.discountPct ??
  (Number(p.oldPrice) > Number(p.price) ? Math.round((1 - Number(p.price) / Number(p.oldPrice)) * 100) : null);

async function loadCatalog(page: number, store?: string): Promise<Catalog | null> {
  const q = new URLSearchParams({ page: String(page), ...(store ? { store } : {}) });
  try {
    const res = await fetch(`${API_URL}/api/public/catalog?${q}`, {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return (await res.json()) as Catalog;
  } catch {
    return null;
  }
}

const FAQ: [string, string][] = [
  [
    'É grátis mesmo?',
    'Sim. Entrar no canal e usar os links não custa nada. Você paga só pelo que comprar, direto na loja, pelo mesmo preço de sempre.',
  ],
  [
    'Como vocês ganham dinheiro?',
    'Os links são de afiliado: quando você compra por eles, a loja nos paga uma pequena comissão. O preço para você não muda. É isso que mantém o canal gratuito.',
  ],
  [
    'O preço anunciado é garantido?',
    'Conferimos o preço na hora de publicar, mas as lojas mudam valores e estoques a qualquer momento. Sempre confirme o valor final no carrinho antes de pagar.',
  ],
  [
    'Vou receber mensagem demais?',
    `Não. Publicamos no máximo ${POSTS_PER_DAY} ofertas por dia, espaçadas ao longo do dia. E você pode silenciar ou sair do canal quando quiser.`,
  ],
  [
    'Comprar pelos links é seguro?',
    'O link leva direto para a página oficial do produto na Shopee, AliExpress, Amazon ou Mercado Livre. A compra, o pagamento e a entrega são feitos pela própria loja, com as garantias dela.',
  ],
];

export default async function Home({ searchParams }: { searchParams: Promise<{ loja?: string; pagina?: string }> }) {
  const { loja, pagina } = await searchParams;
  const store = STORES.find((s) => s.slug === loja);
  const page = Math.min(1000, Math.max(1, Number.parseInt(pagina ?? '1', 10) || 1));
  // paginação e "um card por produto" são feitas na API (24 por página)
  const catalog = await loadCatalog(page, store?.key);
  const posts = catalog?.posts ?? [];
  const featured = catalog?.featured ?? posts[0];
  const stats = catalog?.stats;

  const ctaHref = TELEGRAM_URL || '#ofertas';
  const ctaExternal = TELEGRAM_URL ? { target: '_blank', rel: 'noopener noreferrer' } : {};

  const cta = (label: string, cls = 'btn lg') => (
    <a className={cls} href={ctaHref} {...ctaExternal}>
      {TELEGRAM_URL ? <SiTelegram size={18} /> : <LuArrowRight size={18} />}
      {TELEGRAM_URL ? label : 'Ver ofertas de hoje'}
    </a>
  );

  return (
    <div className="lp">
      {/* ---------------------------------------------------------- nav */}
      <header className="lp-nav">
        <div className="lp-wrap">
          <Logo href="#" />
          <nav className="lp-links" aria-label="Seções">
            <a href="#ofertas">Ofertas</a>
            <a href="#como-funciona">Como funciona</a>
            <a href="#por-que">Por que a gente</a>
            <a href="#faq">Dúvidas</a>
          </nav>
          <div className="lp-nav-actions">
            <ThemeToggle />
            <a className="btn sm" href={ctaHref} {...ctaExternal}>
              {TELEGRAM_URL ? <SiTelegram size={14} /> : null}
              {TELEGRAM_URL ? 'Entrar no canal' : 'Ver ofertas'}
            </a>
          </div>
        </div>
      </header>

      <main>
        {/* ---------------------------------------------------------- hero */}
        <section className="lp-hero">
          <div className="lp-wrap lp-hero-grid">
            <div>
              <span className="lp-pill">
                <span className="lp-dot" aria-hidden />
                {featured?.postedAt ? `Última oferta ${since(featured.postedAt)}` : 'Ofertas novas todo dia'}
              </span>
              <h1>
                A gente corta o{'\u00a0'}preço.
                <br />
                <em>Você só aproveita.</em>
              </h1>
              <p className="lp-lead">
                Garimpamos a Shopee, o AliExpress e a Amazon, conferimos cada preço e mandamos só o que vale a pena direto
                no seu Telegram. Com cupom quando tem.
              </p>
              <div className="lp-cta">
                {cta('Entrar no canal grátis')}
                {TELEGRAM_URL && (
                  <a className="btn ghost lg" href="#ofertas">
                    Ver ofertas de hoje
                  </a>
                )}
              </div>
              <div className="lp-trust">
                <span>
                  <LuCheck size={16} /> 100% gratuito
                </span>
                <span>
                  <LuCheck size={16} /> Máx. {POSTS_PER_DAY} ofertas/dia
                </span>
                <span>
                  <LuCheck size={16} /> Sai quando quiser
                </span>
              </div>
            </div>

            <PhoneMockup post={featured} />
          </div>
        </section>

        {/* ---------------------------------------------------------- lojas + números */}
        <div className="lp-wrap">
          <div className="lp-stores" aria-label="Lojas acompanhadas">
            <p className="lp-stores-label">Ofertas das maiores lojas do Brasil</p>
            {STORES.map((s) => (
              <span key={s.key} className={`lp-store ${s.cls}`}>
                {s.name}
              </span>
            ))}
          </div>
          <div className="lp-stats">
            {stats?.bestDiscountWeek ? (
              <Stat icon={<LuPercent size={22} />} value={`-${stats.bestDiscountWeek}%`} label="maior desconto da semana" />
            ) : null}
            {stats && stats.postedThisWeek >= 10 ? (
              <Stat icon={<LuTag size={22} />} value={String(stats.postedThisWeek)} label="ofertas nos últimos 7 dias" />
            ) : null}
            <Stat icon={<LuStore size={22} />} value={String(STORES.length)} label="grandes lojas monitoradas" />
            <Stat icon={<LuWallet size={22} />} value="R$ 0" label="para participar, sempre" />
          </div>
        </div>

        {/* ---------------------------------------------------------- ofertas */}
        <section id="ofertas" className="lp-section" style={{ scrollMarginTop: 66 }}>
          <div className="lp-wrap">
            <div className="lp-head">
              <p className="lp-eyebrow">
                <LuFlame size={16} /> Ofertas recentes
              </p>
              <h2 className="lp-h2">O que saiu no canal</h2>
              <p className="lp-lead">Mesmas ofertas do Telegram. Clique para abrir direto na loja.</p>
            </div>

            <nav className="lp-filter" aria-label="Filtrar por loja">
              <a className="chip" aria-current={!store ? 'page' : undefined} href="/#ofertas">
                Todas
              </a>
              {STORES.map((s) => (
                <a
                  key={s.key}
                  className="chip"
                  aria-current={store?.key === s.key ? 'page' : undefined}
                  href={pageHref(1, s.slug)}
                >
                  {s.name}
                </a>
              ))}
            </nav>

            {!catalog ? (
              <p className="card empty">Não foi possível carregar as ofertas agora. Tente de novo em instantes.</p>
            ) : posts.length === 0 ? (
              <p className="card empty">
                {page > catalog.pages ? (
                  <>
                    Essa página não existe mais. <a href={pageHref(1, store?.slug)}>Ver as ofertas mais recentes</a>
                  </>
                ) : store ? (
                  `Nenhuma oferta da ${store.name} no momento.`
                ) : (
                  'As primeiras ofertas chegam em breve.'
                )}
              </p>
            ) : (
              <>
                <div className="offers">
                  {posts.map((p) => (
                    <OfferCard key={p.id} post={p} href={`${catalog.base}${p.id}`} />
                  ))}
                </div>
                <Pager page={catalog.page} pages={catalog.pages} total={catalog.total} store={store?.slug} />
              </>
            )}
          </div>
        </section>

        {/* ---------------------------------------------------------- como funciona */}
        <section id="como-funciona" className="lp-section soft">
          <div className="lp-wrap">
            <div className="lp-head center">
              <p className="lp-eyebrow">Como funciona</p>
              <h2 className="lp-h2">Três passos entre a promoção e você</h2>
            </div>
            <div className="lp-steps">
              <Step icon={<LuSearch size={22} />} title="A gente garimpa">
                Acompanhamos as maiores lojas do Brasil atrás de desconto de verdade e cupom ativo.
              </Step>
              <Step icon={<LuBadgeCheck size={22} />} title="Conferimos o preço">
                Antes de publicar, o preço é checado na loja. Oferta sem preço confirmado não sai.
              </Step>
              <Step icon={<LuSmartphone size={22} />} title="Chega no seu Telegram">
                Foto, preço, cupom e o link direto para a loja. Você decide em segundos se vale a pena.
              </Step>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------- diferenciais */}
        <section id="por-que" className="lp-section">
          <div className="lp-wrap">
            <div className="lp-head">
              <p className="lp-eyebrow">Por que o CortaPreço</p>
              <h2 className="lp-h2">Menos ruído, mais economia</h2>
              <p className="lp-lead">Canal de promoção costuma ser uma enxurrada. O nosso foi desenhado para o contrário.</p>
            </div>
            <div className="lp-features">
              <Feature icon={<LuTarget size={22} />} title="Só o que vale a pena">
                Curadoria antes de publicar. Nada de produto aleatório só para encher o feed.
              </Feature>
              <Feature icon={<LuBellOff size={22} />} title="Zero spam">
                No máximo {POSTS_PER_DAY} ofertas por dia, espaçadas. Seu celular não vira uma sirene.
              </Feature>
              <Feature icon={<LuTicket size={22} />} title="Cupom junto">
                Quando existe cupom, ele vem destacado na oferta. É só copiar e usar no carrinho.
              </Feature>
              <Feature icon={<LuShieldCheck size={22} />} title="Link direto e oficial">
                O link abre a página do produto na própria loja. Compra, pagamento e garantia são com ela.
              </Feature>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------- CTA */}
        <section className="lp-section" style={{ paddingTop: 0 }}>
          <div className="lp-wrap">
            <div className="lp-band">
              <h2 className="lp-h2">Sua próxima compra pode sair mais barata</h2>
              <p className="lp-lead">Entre no canal, deixe no silencioso se quiser e dê uma olhada quando der. Grátis.</p>
              {cta('Entrar no canal do Telegram', 'btn white lg')}
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------- FAQ */}
        <section id="faq" className="lp-section soft">
          <div className="lp-wrap">
            <div className="lp-head center">
              <p className="lp-eyebrow">Dúvidas</p>
              <h2 className="lp-h2">Perguntas frequentes</h2>
            </div>
            <div className="lp-faq">
              {FAQ.map(([q, a]) => (
                <details key={q}>
                  <summary>
                    {q}
                    <LuPlus size={20} aria-hidden />
                  </summary>
                  <p>{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* ---------------------------------------------------------- rodapé */}
      <footer className="lp-footer">
        <div className="lp-wrap">
          <div className="lp-footer-top">
            <Logo alwaysDark />
            <nav aria-label="Rodapé">
              <a href="#ofertas">Ofertas</a>
              <a href="#como-funciona">Como funciona</a>
              <a href="#faq">Dúvidas</a>
              {TELEGRAM_URL && (
                <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer">
                  <SiTelegram size={14} /> Telegram
                </a>
              )}
            </nav>
          </div>
          <p>
            <strong>Publicidade:</strong> os links deste site e do canal são links de afiliado. Se você comprar por eles,
            podemos receber uma comissão da loja, sem custo extra para você. Preços, cupons e estoque são definidos pelas
            lojas e podem mudar a qualquer momento; confirme sempre no carrinho.
          </p>
          <p>
            Shopee, AliExpress e Amazon são marcas de seus respectivos donos. O CortaPreço não é afiliado oficialmente a
            nenhuma dessas empresas além dos programas públicos de afiliados.
          </p>
          <p>© {new Date().getFullYear()} CortaPreço</p>
        </div>
      </footer>
    </div>
  );
}

function Logo({ href, alwaysDark }: { href?: string; alwaysDark?: boolean }) {
  // logo recortada e com fundo transparente (gerada por assets/brand/build.py)
  /* eslint-disable @next/next/no-img-element */
  const img = alwaysDark ? (
    <img src="/brand/logo-on-dark.png" alt="CortaPreço" width={829} height={295} />
  ) : (
    <>
      <img className="logo-dark" src="/brand/logo-on-dark.png" alt="CortaPreço" width={829} height={295} />
      <img className="logo-light" src="/brand/logo-on-light.png" alt="CortaPreço" width={829} height={295} />
    </>
  );
  /* eslint-enable @next/next/no-img-element */
  return href ? (
    <a href={href} className="lp-logo" aria-label="CortaPreço, início">
      {img}
    </a>
  ) : (
    <span className="lp-logo">{img}</span>
  );
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="lp-stat">
      <span className="lp-stat-icon" aria-hidden>
        {icon}
      </span>
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}

function Step({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="lp-step">
      <span className="lp-icon-box" aria-hidden>
        {icon}
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

function Feature({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="lp-feature">
      <span className="lp-feature-icon" aria-hidden>
        {icon}
      </span>
      <div>
        <h3>{title}</h3>
        <p>{children}</p>
      </div>
    </div>
  );
}

function OfferCard({ post: p, href }: { post: CatalogPost; href: string }) {
  const price = brl(p.product.price);
  const old = Number(p.product.oldPrice) > Number(p.product.price) ? brl(p.product.oldPrice) : null;
  const off = discountOf(p.product);
  return (
    <a className="offer" href={href} target="_blank" rel="sponsored nofollow noopener noreferrer">
      <div className="offer-img">
        {p.product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.product.imageUrl} alt={p.product.title} loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <span className="offer-noimg" aria-hidden>
            <LuPackage size={40} strokeWidth={1.5} />
          </span>
        )}
        {off ? <span className="offer-off">-{off}%</span> : null}
      </div>
      <div className="offer-body">
        <span className="offer-meta">
          <span className={`badge ${p.product.store}`}>{STORE_NAME[p.product.store] ?? p.product.store}</span>
          <LuClock size={12} aria-hidden />
          {since(p.postedAt)}
        </span>
        <span className="clamp" style={{ fontSize: 14 }}>
          {p.product.title}
        </span>
        <div style={{ marginTop: 'auto' }}>
          {old && <div className="offer-old">{old}</div>}
          {price && <div className="offer-price">{price}</div>}
        </div>
        {p.product.coupon && (
          <span className="muted">
            Cupom <span className="coupon">{p.product.coupon}</span>
          </span>
        )}
      </div>
      <div className="offer-foot">
        <span>Ver na {STORE_NAME[p.product.store] ?? 'loja'}</span>
        <LuArrowUpRight size={16} aria-hidden />
      </div>
    </a>
  );
}

// emojis aqui imitam a mensagem real do canal (template em packages/shared)
const STORE_EMOJI: Record<string, string> = { SHOPEE: '🛒', ALIEXPRESS: '📦', AMAZON: '🛍️' };

function PhoneMockup({ post }: { post: CatalogPost | undefined }) {
  const p = post?.product;
  const price = p ? brl(p.price) : null;
  const old = p && Number(p.oldPrice) > Number(p.price) ? brl(p.oldPrice) : null;
  const off = p ? discountOf(p) : null;
  return (
    <div style={{ position: 'relative' }} aria-hidden>
      <div className="lp-phone">
        <div className="lp-screen">
          <div className="lp-screen-bar">
            <span className="lp-avatar">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/icon-on-dark.png" alt="" />
            </span>
            <div>
              <strong>CortaPreço · Ofertas</strong>
              <small>canal</small>
            </div>
          </div>
          <div className="lp-feed">
            {p ? (
              <div className="lp-msg">
                {p.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.imageUrl} alt="" referrerPolicy="no-referrer" />
                ) : null}
                <div className="lp-msg-body">
                  <b>
                    {STORE_EMOJI[p.store] ?? ''} OFERTA {(STORE_NAME[p.store] ?? p.store).toUpperCase()}
                  </b>
                  <br />
                  <br />
                  <b className="clamp">{p.title}</b>
                  <br />
                  {old ? (
                    <>
                      De <s>{old}</s> {off ? `(-${off}%)` : ''}
                      <br />
                    </>
                  ) : null}
                  <b>Por {price}</b>
                  {p.coupon ? (
                    <>
                      <br />
                      Cupom: <b>{p.coupon}</b>
                    </>
                  ) : null}
                  <br />
                  <br />
                  <span className="lp-msg-link">link da oferta</span>
                  <div className="lp-msg-meta">{since(post?.postedAt ?? null)}</div>
                </div>
              </div>
            ) : (
              <div className="lp-msg">
                <div className="lp-msg-body">
                  <b>Em breve por aqui</b>
                  <br />
                  As melhores ofertas do dia, com preço conferido.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {off ? (
        <div className="lp-float a">
          <span className="lp-float-icon">
            <LuTrendingDown size={18} />
          </span>
          <div>
            Economia
            <strong>-{off}%</strong>
          </div>
        </div>
      ) : null}
      <div className="lp-float b">
        <span className="lp-float-icon">
          <LuWallet size={18} />
        </span>
        <div>
          Para entrar
          <strong>R$ 0</strong>
        </div>
      </div>
    </div>
  );
}

/** Link de uma página do catálogo (mantém a loja; página 1 sem parâmetro) e volta para a seção de ofertas. */
function pageHref(page: number, store?: string): string {
  const q = new URLSearchParams({ ...(store ? { loja: store } : {}), ...(page > 1 ? { pagina: String(page) } : {}) });
  return `/${q.toString() ? `?${q}` : ''}#ofertas`;
}

/** 1 … 4 5 6 … 12: primeira, última e a vizinhança da atual. */
function pageNumbers(page: number, pages: number): (number | '…')[] {
  const keep = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  const out: (number | '…')[] = [];
  let prev = 0;
  for (const n of [...keep].sort((a, b) => a - b)) {
    if (n - prev > 1) out.push('…');
    out.push(n);
    prev = n;
  }
  return out;
}

function Pager({ page, pages, total, store }: { page: number; pages: number; total: number; store?: string }) {
  if (pages <= 1) return null;
  return (
    <nav className="lp-pager" aria-label="Páginas de ofertas">
      {page > 1 ? (
        <a className="chip" href={pageHref(page - 1, store)} rel="prev">
          ‹ Anterior
        </a>
      ) : (
        <span className="chip" aria-disabled="true">
          ‹ Anterior
        </span>
      )}
      <span className="lp-pager-nums">
        {pageNumbers(page, pages).map((n, i) =>
          n === '…' ? (
            <span key={`gap-${i}`} className="lp-pager-gap">
              …
            </span>
          ) : (
            <a key={n} className="chip" href={pageHref(n, store)} aria-current={n === page ? 'page' : undefined}>
              {n}
            </a>
          ),
        )}
      </span>
      {page < pages ? (
        <a className="chip" href={pageHref(page + 1, store)} rel="next">
          Próxima ›
        </a>
      ) : (
        <span className="chip" aria-disabled="true">
          Próxima ›
        </span>
      )}
      <span className="lp-pager-info">
        Página {page} de {pages} · {total} ofertas
      </span>
    </nav>
  );
}
