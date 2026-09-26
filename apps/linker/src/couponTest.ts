import { Queue } from 'bullmq';
import { prisma } from '@cupons/db';
import { COUPON_POST_QUEUE, type CouponPostJob } from '@cupons/shared';
import { saveDebug, withPage } from './browser.js';
import { config } from './config.js';
import { ConversionError } from './conversion.js';
import { reportConversion } from './status.js';

/**
 * Teste de cupom do Mercado Livre na conta de afiliado (cofre/11). Não compra nada: usa "Cupons → Inserir código",
 * o que ADICIONA o cupom à conta quando é válido (combinado com o dono em 2026-09-26).
 * Respostas vistas em 2026-09-26:
 *  - "Você aplicou o cupom de 10% OFF TODO O SITE!" (e vai para /cupons/active)  → VALID
 *  - "Erro · Este cupom não se aplica a você."                                    → RESTRICTED
 *  - "Erro · Confira se o cupom está correto"                                     → INVALID
 * Detalhes (mínimo, limite, vencimento) vêm do card em "Meus cupons".
 */
const COUPONS_URL = 'https://www.mercadolivre.com.br/cupons';
const couponPostQueue = new Queue<CouponPostJob>(COUPON_POST_QUEUE, { connection: { url: config.redisUrl } });

/** Teto de testes (cada teste é uma ação na conta de afiliado). */
const TESTS_PER_HOUR = 40;
const tests: number[] = [];

type Outcome = { status: 'VALID' | 'RESTRICTED' | 'INVALID' | 'UNKNOWN'; detail: string; title: string | null };

export interface MlCouponDetails {
  minPurchase: number | null;
  maxDiscount: number | null;
  scope: string | null;
  expiresAt: Date | null;
}

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/** Fim do dia (23:59) em Brasília (UTC−3, sem horário de verão desde 2019). */
function endOfDaySP(y: number, m: number, d: number): Date {
  return new Date(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T23:59:00-03:00`);
}
function todaySP(now: Date): { y: number; m: number; d: number; wd: number } {
  const sp = new Date(now.getTime() - 3 * 3_600_000);
  return { y: sp.getUTCFullYear(), m: sp.getUTCMonth() + 1, d: sp.getUTCDate(), wd: sp.getUTCDay() };
}

/** "Termina em 2 horas!" / "Vence hoje" / "Vence amanhã" / "Vence em quarta-feira" / "Vence 31 de outubro". */
export function parseMlExpiry(text: string, now = new Date()): Date | null {
  const t = text.toLowerCase();
  // cronômetro do card: "Encerra em 01:45:00" (hh:mm:ss)
  const clock = t.match(/(?:encerra|termina|acaba) em (\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (clock) return new Date(now.getTime() + (Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3] ?? 0)) * 1000);
  const inHours = t.match(/(?:termina|encerra) em (\d+) horas?/);
  if (inHours) return new Date(now.getTime() + Number(inHours[1]) * 3_600_000);
  const inMin = t.match(/(?:termina|encerra) em (\d+) minutos?/);
  if (inMin) return new Date(now.getTime() + Number(inMin[1]) * 60_000);
  const today = todaySP(now);
  if (/vence hoje|termina hoje|acaba hoje/.test(t)) return endOfDaySP(today.y, today.m, today.d);
  if (/vence amanh[ãa]/.test(t)) return new Date(endOfDaySP(today.y, today.m, today.d).getTime() + 24 * 3_600_000);
  const wd = WEEKDAYS.findIndex((w) => new RegExp(`vence (em |na |no )?${w}`).test(t));
  if (wd >= 0) {
    const ahead = (wd - today.wd + 7) % 7 || 7;
    return new Date(endOfDaySP(today.y, today.m, today.d).getTime() + ahead * 24 * 3_600_000);
  }
  const dm = t.match(/vence (?:em )?(\d{1,2}) de ([a-zç]+)/);
  if (dm) {
    const month = MONTHS.indexOf(dm[2]!) + 1;
    if (month > 0) {
      let date = endOfDaySP(today.y, month, Number(dm[1]));
      if (date.getTime() < now.getTime() - 24 * 3_600_000) date = endOfDaySP(today.y + 1, month, Number(dm[1]));
      return date;
    }
  }
  return null;
}

const money = (s?: string) => (s ? Number(s.replace(/\./g, '').replace(',', '.')) || null : null);

/** Linhas do card do cupom em "Meus cupons" (título → próximas linhas até o botão). */
export function parseMlCouponCard(lines: string[], now = new Date()): MlCouponDetails {
  const text = lines.join('\n');
  const scope = text.match(/Em produtos de ([^\n]+)/i)?.[0] ?? null; // "Em produtos selecionados" não é escopo útil
  return {
    minPurchase: /sem compra m[ií]nima/i.test(text) ? null : money(text.match(/Compra m[ií]nima\s*R\$\s?([\d.,]+)/i)?.[1]),
    maxDiscount: money(text.match(/Limite de\s*R\$\s?([\d.,]+)/i)?.[1]),
    scope,
    expiresAt: parseMlExpiry(text, now),
  };
}

interface CardFacts extends MlCouponDetails {
  title: string;
  pct: number | null;
  value: number | null;
}

/** Cards de "Meus cupons": título ("10% OFF TODO O SITE") + as linhas até o próximo título. */
export function parseMyCoupons(lines: string[], now = new Date()): CardFacts[] {
  // texto real (2026-09-26): "10% OFF TODO O SITE" / "Cupom ativado de 10% OFF TODO O SITE" / "Em produtos selecionados" /
  // "Compra mínima" / "R$99" / "Limite de" / "R$15" / "Encerra em 01:45:00" / "Conferir"
  const isTitle = (i: number) =>
    /\bOFF\b/.test(lines[i]!) &&
    !/^cupom ativado/i.test(lines[i]!) &&
    (/^cupom ativado/i.test(lines[i + 1] ?? '') || /^Em produtos|^Sem compra/i.test(lines[i + 1] ?? ''));
  const starts = lines.map((_, i) => i).filter(isTitle);
  return starts.map((at, k) => {
    const title = lines[at]!;
    const body = lines.slice(at + 1, starts[k + 1] ?? at + 8);
    return {
      title,
      pct: Number(title.match(/(\d{1,2})\s?%/)?.[1]) || null,
      value: money(title.match(/R\$\s?([\d.,]+)/)?.[1]),
      ...parseMlCouponCard(body, now),
    };
  });
}

/** Acha o card do cupom pelo título oficial ou, sem ele ("já estava na conta"), pelo desconto + mínimo + limite. */
function matchCard(
  cards: CardFacts[],
  title: string | null,
  known: { discountPct: number | null; discountValue: number | null; minPurchase: number | null; maxDiscount: number | null },
): CardFacts | null {
  if (title) return cards.find((c) => c.title.toUpperCase() === title.toUpperCase()) ?? null;
  const same = (a: number | null, b: number | null) => a === null || b === null || Math.abs(a - b) < 0.01;
  const hits = cards.filter(
    (c) =>
      (known.discountPct ? c.pct === known.discountPct : known.discountValue ? same(c.value, known.discountValue) : false) &&
      same(c.minPurchase, known.minPurchase) &&
      same(c.maxDiscount, known.maxDiscount),
  );
  return hits.length === 1 ? hits[0]! : null; // ambíguo → não chuta
}

type Known = Parameters<typeof matchCard>[2];

async function tryCode(code: string, known: Known = { discountPct: null, discountValue: null, minPurchase: null, maxDiscount: null }): Promise<{ outcome: Outcome; details: (MlCouponDetails & { title?: string }) | null }> {
  return withPage({ session: true }, async (page) => {
    // abrir a página às vezes é abortado (ERR_ABORTED): uma segunda tentativa resolve
    await page.goto(COUPONS_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(async () => {
      await page.waitForTimeout(2_000);
      await page.goto(COUPONS_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    });
    if (/\/login|\/jms\//.test(new URL(page.url()).pathname)) {
      throw new ConversionError('sessão do Mercado Livre expirou: rode `npm run ml:login`', 'SESSION');
    }
    // o link "Inserir código" só funciona depois que a página hidrata (React): clicar cedo não abre o modal.
    // Espera carregar e tenta até 3 vezes até o campo aparecer.
    await page.waitForLoadState('load', { timeout: 20_000 }).catch(() => undefined);
    const input = page.locator('#inputcode-textfield-with-link');
    for (let i = 0; i < 3 && !(await input.isVisible()); i++) {
      await page.waitForTimeout(1_500);
      await page.getByText('Inserir código', { exact: true }).first().click({ timeout: 10_000 }).catch(() => undefined);
      await input.waitFor({ state: 'visible', timeout: 4_000 }).catch(() => undefined);
    }
    if (!(await input.isVisible())) {
      throw new ConversionError('o campo "Inserir código do cupom" não abriu na página de cupons', 'LAYOUT', await saveDebug(page, 'cupom-sem-campo'));
    }
    await input.click();
    await input.pressSequentially(code, { delay: 40 }); // digitar: o botão só habilita com teclado
    try {
      await page.getByRole('button', { name: /^\s*inserir\s*$/i }).last().click({ timeout: 8_000 });
    } catch {
      throw new ConversionError('o botão "Inserir" do cupom não respondeu', 'LAYOUT', await saveDebug(page, 'cupom-sem-botao'));
    }

    // espera a resposta do ML (toast/mensagem de erro) até 15 s
    let outcome: Outcome | null = null;
    const deadline = Date.now() + 15_000;
    while (!outcome && Date.now() < deadline) {
      await page.waitForTimeout(600);
      // aceito → o ML navega para "Meus cupons" no meio da leitura: lê de novo em vez de quebrar
      const body = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
      if (!body) continue;
      const applied = body.match(/Voc[êe] aplicou o cupom de ([^!\n]+)!/i);
      if (applied) outcome = { status: 'VALID', detail: 'aplicado na conta de afiliado', title: applied[1]!.trim() };
      else if (/\/cupons\/active/.test(page.url()) && /source_page=int_input_code/.test(page.url())) {
        // chegou em "Meus cupons" vindo do "Inserir código" = aceito (o aviso some rápido)
        outcome = { status: 'VALID', detail: 'aplicado na conta de afiliado', title: null };
      }
      // "Este cupom já foi adicionado, mas ainda pode ser usado em produtos selecionados." (visto em 2026-09-26)
      else if (/j[áa] foi adicionado|j[áa] (aplicou|est[áa] aplicado|tem este cupom|possui)/i.test(body)) outcome = { status: 'VALID', detail: 'já estava na conta (ainda pode ser usado)', title: null };
      else if (/n[ãa]o se aplica a voc[êe]/i.test(body)) outcome = { status: 'RESTRICTED', detail: 'o ML diz: "Este cupom não se aplica a você"', title: null };
      else if (/confira se o cupom est[áa] correto/i.test(body)) outcome = { status: 'INVALID', detail: 'o ML diz: "Confira se o cupom está correto"', title: null };
      else if (/esgotad|expirad|venceu|encerrad/i.test(body.match(/Erro[\s\S]{0,120}/)?.[0] ?? '')) {
        outcome = { status: 'INVALID', detail: (body.match(/Erro\s*\n?([^\n]{3,120})/)?.[1] ?? 'esgotado/expirado').trim(), title: null };
      }
    }
    if (!outcome) {
      return { outcome: { status: 'UNKNOWN', detail: `sem resposta clara do ML (print: ${await saveDebug(page, 'cupom-sem-resposta')})`, title: null }, details: null };
    }
    if (outcome.status !== 'VALID') return { outcome, details: null };

    // condições exatas no card de "Meus cupons" (a página vai para lá depois de aplicar)
    if (!/\/cupons\/active/.test(page.url())) await page.goto(`${COUPONS_URL}/active`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(2_000);
    const lines = ((await page.evaluate(() => document.body?.innerText ?? '').catch(() => '')) as string)
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const card = matchCard(parseMyCoupons(lines), outcome.title, known);
    return { outcome, details: card ? { ...card, title: card.title } : null };
  });
}

/** Diagnóstico (`ml:check -- --cupom X`): testa um código sem mexer no banco. */
export const testMlCode = (code: string) => tryCode(code);

const GENERAL_TITLE = /todo o site|site todo|app todo|todo o app/i;

export async function testCoupon(couponId: string): Promise<void> {
  const coupon = await prisma.coupon.findUnique({ where: { id: couponId }, include: { source: true } });
  if (!coupon || coupon.store !== 'MERCADOLIVRE') return;

  const hourAgo = Date.now() - 3_600_000;
  while (tests.length && tests[0]! < hourAgo) tests.shift();
  if (tests.length >= TESTS_PER_HOUR) {
    await prisma.coupon.update({ where: { id: couponId }, data: { statusDetail: `teste adiado: teto de ${TESTS_PER_HOUR} testes/h` } });
    return;
  }
  tests.push(Date.now());

  let result: Awaited<ReturnType<typeof tryCode>>;
  try {
    // 1 nova tentativa para falha passageira (navegação/rede); sessão expirada não adianta repetir
    const known = {
      discountPct: coupon.discountPct,
      discountValue: coupon.discountValue ? Number(coupon.discountValue) : null,
      minPurchase: coupon.minPurchase ? Number(coupon.minPurchase) : null,
      maxDiscount: coupon.maxDiscount ? Number(coupon.maxDiscount) : null,
    };
    result = await tryCode(coupon.code, known).catch(async (err) => {
      if (err instanceof ConversionError && err.kind === 'SESSION') throw err;
      await new Promise((r) => setTimeout(r, 5_000));
      return tryCode(coupon.code, known);
    });
  } catch (err) {
    const e = err instanceof ConversionError ? err : null;
    const reason = (err as Error).message.split('\n')[0]!.slice(0, 200);
    if (e?.kind === 'SESSION') await reportConversion('expired', reason);
    await prisma.coupon.update({ where: { id: couponId }, data: { statusDetail: `teste falhou: ${reason}`, checkedAt: new Date() } });
    if (coupon.sourceId && (e?.kind === 'SESSION' || e?.kind === 'LAYOUT')) {
      await prisma.channelSource.update({
        where: { id: coupon.sourceId },
        data: { alert: `Teste de cupom do ML falhou (${coupon.code}): ${reason}`.slice(0, 500), alertAt: new Date(), alertCount: { increment: 1 } },
      });
    }
    console.error(`[linker] cupom ${coupon.code}: ${reason}`);
    return;
  }
  await reportConversion('ok', null);

  const { outcome, details } = result;
  const title = outcome.title ?? details?.title ?? coupon.title;
  const storeScoped = Boolean(details?.scope); // "Em produtos de <loja>": não serve para qualquer produto
  await prisma.coupon.update({
    where: { id: couponId },
    data: {
      status: outcome.status === 'UNKNOWN' ? coupon.status : outcome.status,
      statusDetail: outcome.detail,
      checkedAt: new Date(),
      title,
      ...(details?.minPurchase !== undefined && details.minPurchase !== null ? { minPurchase: details.minPurchase } : {}),
      ...(details?.maxDiscount ? { maxDiscount: details.maxDiscount } : {}),
      ...(details?.scope ? { scope: details.scope } : {}),
      ...(details?.expiresAt ? { expiresAt: details.expiresAt } : {}),
      // o título do ML confirma se vale para o site todo
      ...(outcome.status === 'VALID' && GENERAL_TITLE.test(title) && !storeScoped ? { attachable: true } : {}),
      ...(storeScoped ? { attachable: false } : {}),
    },
  });
  console.log(`[linker] cupom ${coupon.code}: ${outcome.status} (${outcome.detail})`);

  if (outcome.status === 'VALID' && coupon.source?.postCoupons && !coupon.postAt) {
    await couponPostQueue.add('schedule', { couponId, step: 'schedule' }, { removeOnComplete: true, removeOnFail: 50 });
  }
}

export async function closeCouponTest(): Promise<void> {
  await couponPostQueue.close();
}
