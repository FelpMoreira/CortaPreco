import type { BrowserContext, Page } from 'playwright';
import { saveDebug } from './browser.js';

/**
 * Conversão Mercado Livre (espelhamento). Passo a passo, seletores e o que já quebrou:
 * cofre/10 - Espelhamento Mercado Livre.md
 *
 *  1. abre o meli.la do grupo → cai na página "social" do afiliado de origem;
 *  2. o card em destaque tem o "Ir para produto" (a.poly-component__link--action-link);
 *  3. URL do produto sem query/hash (tira o rastreio de quem postou);
 *  4. dados do post vêm desse card (mesmos da página do produto, que sem login cai na
 *     verificação anti-robô do ML);
 *  5. gerador de links (logado): cola a URL em textarea#url-0 → "Gerar" → link curto nosso.
 */

/**
 * Seletores num lugar só. `_R_199rpa_` / `_r_0_` são ids gerados pelo React (useId): mudam quando
 * o ML reorganiza a página — por isso cada um tem alternativa por texto/papel.
 */
export const SELECTORS = {
  card: '.poly-card',
  featuredCard: '.poly-card--xlarge',
  actionLink: 'a.poly-component__link--action-link',
  cardTitle: 'a.poly-component__title, .poly-component__title',
  cardImage: 'img.poly-component__picture',
  cardPrice: '.poly-price__current .andes-money-amount',
  cardPrevious: 's.andes-money-amount--previous',
  cardDiscount: '.andes-money-amount__discount',
  cardRating: '.poly-reviews__rating',
  linkbuilderInput: 'textarea#url-0',
  linkbuilderGenerate: 'button#_R_199rpa_',
  linkbuilderCopy: 'button#_r_0_',
} as const;

export const LINKBUILDER_URL = 'https://www.mercadolivre.com.br/afiliados/linkbuilder#hub';

const ML_HOST = /(^|\.)(mercadolivre\.com\.br|mercadolivre\.com|mercadolibre\.com)$/i;
/** Página de produto: catálogo (/p/MLB…), "user product" (/up/MLBU…) ou anúncio (MLB-123…). */
const PRODUCT_PATH = /\/(p|up)\/MLBU?\d+|\/MLB-?\d+/i;
/** Links curtos que o gerador devolve. */
const SHORT_LINK = /https:\/\/(?:meli\.la\/[A-Za-z0-9]+|mercadolivre\.com\/sec\/[A-Za-z0-9]+)/g;

export type FailureKind = 'SESSION' | 'BLOCKED' | 'NO_PRODUCT' | 'LAYOUT' | 'NETWORK';

export class ConversionError extends Error {
  constructor(
    message: string,
    readonly kind: FailureKind,
    readonly debugFile: string | null = null,
  ) {
    super(message);
    this.name = 'ConversionError';
  }
  /** Vale tentar de novo na hora? (layout que demorou, rede). Sessão/bloqueio/sem produto, não. */
  get retryable(): boolean {
    return this.kind === 'LAYOUT' || this.kind === 'NETWORK';
  }
}

export interface MlProduct {
  /** URL do produto sem query nem hash: é o que vai para o gerador de links. */
  productUrl: string;
  /** Id do ML (MLB123, MLBU123) — chave do produto no banco. */
  itemId: string;
  title: string;
  price: number;
  oldPrice: number | null;
  discountPct: number | null;
  imageUrl: string | null;
  rating: number | null;
}

// sem sessão o gerador cai em /login/identification (2026-09) ou /jms/mlb/lgz/login (redirect antigo)
const isLoginUrl = (u: string) => {
  try {
    return /^\/jms\/|\/lgz\/login|^\/login(\/|$)/i.test(new URL(u).pathname);
  } catch {
    return false;
  }
};
const isVerificationUrl = (u: string) => /\/gz\/account-verification|captcha/i.test(u);

/** "https://…/produto/p/MLB123?matt_word=x#polycard…" → "https://…/produto/p/MLB123" */
export function cleanProductUrl(raw: string, base?: string): string | null {
  let u: URL;
  try {
    u = new URL(raw, base);
  } catch {
    return null;
  }
  // clicar no "Ir para produto" sem login cai na verificação, com o destino em ?go=
  if (isVerificationUrl(u.href) && u.searchParams.get('go')) return cleanProductUrl(u.searchParams.get('go')!);
  if (u.protocol !== 'https:' || !ML_HOST.test(u.hostname) || !PRODUCT_PATH.test(u.pathname)) return null;
  return `${u.origin}${u.pathname}`;
}

export function itemIdFromUrl(url: string): string | null {
  const path = new URL(url).pathname;
  const m = path.match(/\/(?:p|up)\/(MLBU?\d+)/i) ?? path.match(/\/(MLB)-?(\d+)/i);
  if (!m) return null;
  return (m[2] ? `${m[1]}${m[2]}` : m[1]!).toUpperCase();
}

/** "664 reais com 05 centavos" / "Antes: 1.299 reais" → 664.05 / 1299 */
export function parseMoneyLabel(label: string | null | undefined): number | null {
  if (!label) return null;
  const m = label.match(/([\d.]+)\s*reais?(?:\s*com\s*(\d{1,2})\s*centavos?)?/i);
  if (!m) return null;
  const value = Number(m[1]!.replace(/\./g, '')) + (m[2] ? Number(m[2]) / 100 : 0);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null;
}

async function gotoMl(page: Page, url: string): Promise<void> {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  } catch (err) {
    throw new ConversionError(`não abriu ${url}: ${(err as Error).message.split('\n')[0]}`, 'NETWORK');
  }
  const now = new URL(page.url());
  if (!ML_HOST.test(now.hostname)) throw new ConversionError(`o link levou para fora do Mercado Livre (${now.hostname})`, 'NO_PRODUCT');
}

interface CardData {
  href: string | null;
  title: string | null;
  image: string | null;
  price: string | null;
  priceText: string | null;
  previous: string | null;
  discount: string | null;
  rating: string | null;
}

/** Lê o card em destaque (ou o primeiro com "Ir para produto"). */
async function readFeaturedCard(page: Page): Promise<CardData | null> {
  return page.evaluate((sel) => {
    const act =
      document.querySelector(`${sel.featuredCard} ${sel.actionLink}`) ?? document.querySelector(sel.actionLink);
    const card = act?.closest(sel.card);
    if (!act || !card) return null;
    const title = card.querySelector(sel.cardTitle);
    const img = card.querySelector(sel.cardImage);
    const price = card.querySelector(sel.cardPrice);
    const fraction = price?.querySelector('.andes-money-amount__fraction')?.textContent ?? '';
    const cents = price?.querySelector('.andes-money-amount__cents')?.textContent ?? '';
    return {
      href: act.getAttribute('href') || title?.getAttribute('href') || null,
      title: title?.textContent?.trim() || img?.getAttribute('alt') || null,
      image: img?.getAttribute('src') || img?.getAttribute('data-src') || null,
      price: price?.getAttribute('aria-label') ?? null,
      priceText: fraction ? `${fraction} reais${cents ? ` com ${cents} centavos` : ''}` : null,
      previous: card.querySelector(sel.cardPrevious)?.getAttribute('aria-label') ?? null,
      discount: card.querySelector(sel.cardDiscount)?.textContent ?? null,
      rating: card.querySelector(sel.cardRating)?.textContent ?? null,
    };
  }, SELECTORS);
}

/** O "Ir para produto" sem href: clica e pega o destino (mesma aba ou aba nova). */
async function clickThrough(page: Page, ctx: BrowserContext): Promise<string | null> {
  const popup = ctx.waitForEvent('page', { timeout: 15_000 }).catch(() => null);
  const sameTab = page
    .waitForURL((u) => !u.pathname.startsWith('/social'), { timeout: 15_000, waitUntil: 'commit' })
    .then(() => page)
    .catch(() => null);
  await page.locator(SELECTORS.actionLink).first().click({ timeout: 10_000 });
  const target = await Promise.race([popup, sameTab]);
  if (!target) return null;
  const url = target.url();
  if (target !== page) await target.close().catch(() => undefined);
  return url;
}

/** Passos 1–4: do meli.la até a URL limpa do produto e os dados do post. */
export async function resolveProduct(page: Page, ctx: BrowserContext, link: string): Promise<MlProduct> {
  await gotoMl(page, link);
  const landed = page.url();
  if (isLoginUrl(landed) || isVerificationUrl(landed)) {
    throw new ConversionError('o Mercado Livre pediu login/verificação ao abrir o link do grupo', 'BLOCKED', await saveDebug(page, 'social-bloqueado'));
  }

  await page.waitForSelector(SELECTORS.card, { timeout: 15_000 }).catch(() => null);
  const card = await readFeaturedCard(page);
  if (!card) {
    const cards = await page.locator(SELECTORS.card).count();
    if (cards > 0) throw new ConversionError('o link aponta para a vitrine do afiliado, sem um produto em destaque', 'NO_PRODUCT');
    throw new ConversionError('não achei o card do produto nem o botão "Ir para produto"', 'LAYOUT', await saveDebug(page, 'sem-card'));
  }

  let productUrl = card.href ? cleanProductUrl(card.href, landed) : null;
  if (!productUrl) {
    const dest = await clickThrough(page, ctx);
    productUrl = dest ? cleanProductUrl(dest) : null;
  }
  if (!productUrl) throw new ConversionError('não consegui a URL do produto a partir do "Ir para produto"', 'LAYOUT', await saveDebug(page, 'sem-url'));

  const itemId = itemIdFromUrl(productUrl);
  const price = parseMoneyLabel(card.price) ?? parseMoneyLabel(card.priceText);
  if (!itemId || !card.title || !price) {
    throw new ConversionError(`card incompleto (id ${itemId ?? '?'}, título ${card.title ? 'ok' : '?'}, preço ${price ?? '?'})`, 'LAYOUT', await saveDebug(page, 'card-incompleto'));
  }
  const previous = parseMoneyLabel(card.previous);
  const oldPrice = previous && previous > price ? previous : null;
  const pct = Number(card.discount?.match(/(\d{1,2})\s*%/)?.[1]);
  const rating = Number(card.rating?.replace(',', '.'));
  return {
    productUrl,
    itemId,
    title: card.title.slice(0, 300),
    price,
    oldPrice,
    discountPct: oldPrice ? (Number.isFinite(pct) && pct > 0 ? pct : Math.round(((oldPrice - price) / oldPrice) * 100)) : null,
    imageUrl: card.image && /^https:\/\//.test(card.image) ? card.image : null,
    rating: Number.isFinite(rating) && rating > 0 && rating <= 5 ? rating : null,
  };
}

async function shortLinksOnPage(page: Page): Promise<string[]> {
  const text = await page.evaluate(() => {
    const values = [...document.querySelectorAll('input, textarea')].map((e) => (e as HTMLInputElement).value);
    const hrefs = [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') ?? '');
    return [document.body?.innerText ?? '', ...values, ...hrefs].join('\n');
  });
  return [...new Set(text.match(SHORT_LINK) ?? [])];
}

/** Passo 5: gerador de links da conta de afiliado (precisa da sessão salva). */
export async function generateAffiliateLink(page: Page, ctx: BrowserContext, productUrl: string): Promise<string> {
  await gotoMl(page, LINKBUILDER_URL);
  if (isLoginUrl(page.url())) {
    throw new ConversionError('sessão do Mercado Livre expirou ou não existe: rode `npm run ml:login` na sua máquina', 'SESSION');
  }
  if (isVerificationUrl(page.url())) {
    throw new ConversionError('o Mercado Livre pediu verificação de conta no gerador de links', 'BLOCKED', await saveDebug(page, 'gerador-verificacao'));
  }

  const input = page.locator(SELECTORS.linkbuilderInput);
  try {
    await input.waitFor({ state: 'visible', timeout: 25_000 });
  } catch {
    if (isLoginUrl(page.url())) throw new ConversionError('sessão do Mercado Livre expirou: rode `npm run ml:login`', 'SESSION');
    throw new ConversionError(`o campo ${SELECTORS.linkbuilderInput} do gerador não apareceu`, 'LAYOUT', await saveDebug(page, 'gerador-sem-campo'));
  }

  const before = new Set(await shortLinksOnPage(page)); // histórico que a página já mostra
  // DIGITAR, não colar: o gerador só habilita o "Gerar" com eventos de teclado (fill() deixa o botão
  // desabilitado — testado em 2026-09-26). ~100 caracteres × 12 ms ≈ 1,5 s.
  await input.click();
  await input.fill('');
  await input.pressSequentially(productUrl, { delay: 12 });

  const byId = page.locator(SELECTORS.linkbuilderGenerate);
  const generate = (await byId.count()) > 0 ? byId.first() : page.getByRole('button', { name: /^\s*gerar/i }).first();
  if ((await generate.count()) === 0) {
    throw new ConversionError('botão "Gerar" do gerador não encontrado', 'LAYOUT', await saveDebug(page, 'gerador-sem-botao'));
  }
  // espera o botão habilitar (validação da URL no próprio site)
  const enabledBy = Date.now() + 8_000;
  while ((await generate.isDisabled()) && Date.now() < enabledBy) await page.waitForTimeout(300);
  if (await generate.isDisabled()) {
    throw new ConversionError('o botão "Gerar" continuou desabilitado (o site não aceitou a URL?)', 'LAYOUT', await saveDebug(page, 'gerador-botao-desabilitado'));
  }
  await generate.click({ timeout: 10_000 });

  // o link novo aparece na página: espera até 25 s
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(700);
    const fresh = (await shortLinksOnPage(page)).filter((l) => !before.has(l));
    if (fresh.length) return fresh[0]!;
  }

  // alternativa: botão de copiar + área de transferência
  try {
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://www.mercadolivre.com.br' });
    const copyById = page.locator(SELECTORS.linkbuilderCopy);
    const copy = (await copyById.count()) > 0 ? copyById.first() : page.getByRole('button', { name: /copiar/i }).last();
    await copy.click({ timeout: 5_000 });
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    const m = clip.match(SHORT_LINK)?.[0];
    if (m && !before.has(m)) return m;
  } catch {
    /* cai no erro abaixo */
  }
  throw new ConversionError('o link curto não apareceu depois de "Gerar"', 'LAYOUT', await saveDebug(page, 'gerador-sem-link'));
}

/** Sessão ainda vale? Abre o gerador e vê se o campo aparece (sem gerar nada). */
export async function checkMlSession(page: Page): Promise<'ok' | 'expired' | 'blocked'> {
  await gotoMl(page, LINKBUILDER_URL);
  if (isLoginUrl(page.url())) return 'expired';
  if (isVerificationUrl(page.url())) return 'blocked';
  const visible = await page
    .locator(SELECTORS.linkbuilderInput)
    .waitFor({ state: 'visible', timeout: 25_000 })
    .then(() => true)
    .catch(() => false);
  if (visible) return 'ok';
  return isLoginUrl(page.url()) ? 'expired' : 'blocked';
}
