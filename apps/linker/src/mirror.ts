import { Queue } from 'bullmq';
import { bestCouponFor, couponLine, inQuietHours, markCouponUsed, nicheChannelFor, prisma, upsertProduct } from '@cupons/db';
import { classifyCategory, escapeHtml, LINK_PLACEHOLDER, renderMessageHtml } from '@cupons/shared';
import { withPage } from './browser.js';
import { config } from './config.js';
import { convertAmazon } from './amazon.js';
import { ConversionError, type BeforeExpensiveStep, type ConversionResult, type ConvertedProduct } from './conversion.js';
import { generateAffiliateLink, resolveProduct } from './mercadolivre.js';
import { reportConversion } from './status.js';

/**
 * Espelhamento — parte 2 (linker): converte o link do grupo observado e agenda o post no canal
 * para a hora sorteada pelo worker (mensagem original + 0…maxDelaySec).
 */

// mesma fila do worker (apps/worker/src/scheduler.ts): o publish worker envia e marca POSTED
const publishQueue = new Queue('publish', { connection: { url: config.redisUrl } });

/** Conversão que termina depois disso (worker parado, fila travada) não vira post: oferta velha. */
const MAX_LATE_MS = 10 * 60_000;
/** O mesmo produto não sai de novo no mesmo canal dentro dessa janela (grupos repetem oferta). */
const REPOST_WINDOW_MS = 24 * 3_600_000;
/** Rajada grande do grupo: oferta que só sairia mais de 45 min depois do sorteio original é ignorada (velha). */
const MAX_BACKLOG_MS = 45 * 60_000;

/**
 * Próximo horário livre no canal: depois do último post publicado e do último já reservado pelo espelhamento,
 * + o intervalo mínimo (com até 30% a mais, para não ficar mecânico). Grupo que manda 5 de uma vez → 5 posts
 * espaçados. O linker processa uma conversão por vez, então duas reservas nunca disputam o mesmo horário.
 */
async function nextSlot(channelId: string, wanted: Date, minGapSec: number): Promise<Date> {
  const [reserved, posted] = await Promise.all([
    prisma.post.findFirst({ where: { channelId, status: 'POSTING', sendAt: { not: null } }, orderBy: { sendAt: 'desc' }, select: { sendAt: true } }),
    prisma.post.findFirst({ where: { channelId, status: 'POSTED' }, orderBy: { postedAt: 'desc' }, select: { postedAt: true } }),
  ]);
  const last = Math.max(reserved?.sendAt?.getTime() ?? 0, posted?.postedAt?.getTime() ?? 0);
  const gap = minGapSec * 1000 * (1 + Math.random() * 0.3);
  return new Date(Math.max(wanted.getTime(), last ? last + gap : 0, Date.now()));
}

const hhmm = (d: Date) => d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });

function trackedLink(postId: string, affiliateUrl: string): string {
  return config.publicBaseUrl ? `${config.publicBaseUrl}/c/${postId}` : affiliateUrl;
}

async function finish(eventId: string, status: 'SKIPPED' | 'FAILED' | 'CONVERTED', detail: string, extra: Record<string, unknown> = {}) {
  await prisma.sourceEvent.update({ where: { id: eventId }, data: { status, detail: detail.slice(0, 500), ...extra } });
}

/** Mercado Livre: navegador logado (card em destaque + gerador de links). */
function convertMercadoLivre(link: string, before: BeforeExpensiveStep): Promise<ConversionResult> {
  return withPage({ session: true }, async (page, ctx) => {
    const p = await resolveProduct(page, ctx, link);
    const skip = await before({ store: 'MERCADOLIVRE', itemId: p.itemId }); // repetido → nem abre o gerador
    if (skip) return { skip };
    const affiliateUrl = await generateAffiliateLink(page, ctx, p.productUrl);
    return { product: { ...p, store: 'MERCADOLIVRE' as const }, affiliateUrl };
  });
}

/** Um conversor por tipo de link (MIRROR_LINK_TYPES). */
const CONVERTERS: Record<string, (link: string, before: BeforeExpensiveStep) => Promise<ConversionResult>> = {
  MERCADOLIVRE: convertMercadoLivre,
  AMAZON: convertAmazon,
};

/** Converte com 1 nova tentativa para falhas passageiras (página lenta, rede). */
async function convert(linkType: string, link: string, before: BeforeExpensiveStep): Promise<ConversionResult> {
  const converter = CONVERTERS[linkType];
  if (!converter) throw new ConversionError(`tipo de link sem conversor: ${linkType}`, 'CONFIG');
  for (let attempt = 1; ; attempt++) {
    try {
      return await converter(link, before);
    } catch (err) {
      const retry = attempt < 2 && (!(err instanceof ConversionError) || err.retryable);
      if (!retry) throw err;
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }
}

export async function processMirrorEvent(eventId: string): Promise<void> {
  const event = await prisma.sourceEvent.findUnique({ where: { id: eventId }, include: { source: { include: { channel: true } } } });
  if (!event || event.status !== 'PENDING') return;
  const { source } = event;
  const { channel } = source;
  const postAt = event.postAt ?? new Date();
  const isMl = event.linkType === 'MERCADOLIVRE'; // só o ML mexe no status da sessão da conta de afiliado

  if (!source.enabled || !channel.enabled) return finish(eventId, 'SKIPPED', 'fluxo ou canal desligado');
  if (channel.platform !== 'TELEGRAM') return finish(eventId, 'SKIPPED', 'espelhamento só posta em canal do Telegram');
  if (source.respectQuiet && channel.quietHours && inQuietHours(channel.quietHours, postAt)) {
    return finish(eventId, 'SKIPPED', `horário de silêncio do canal (${channel.quietHours.replace('-', 'h–')}h)`);
  }

  let result: ConversionResult;
  try {
    result = await convert(event.linkType, event.link, async ({ store, itemId }) => {
      const recent = await prisma.post.findFirst({
        where: {
          channelId: channel.id,
          product: { store, storeProductId: itemId },
          status: { in: ['SCHEDULED', 'POSTING', 'POSTED'] },
          createdAt: { gte: new Date(Date.now() - REPOST_WINDOW_MS) },
        },
        select: { id: true },
      });
      return recent ? 'produto já postado neste canal nas últimas 24h' : null;
    });
  } catch (err) {
    const e = err instanceof ConversionError ? err : null;
    const reason = (err as Error).message.split('\n')[0]!.slice(0, 300);
    if (e?.isSkip) {
      // link sem produto ou teto da loja: não é falha nossa, só registra
      if (isMl) await reportConversion('ok', null);
      return finish(eventId, 'SKIPPED', reason);
    }
    if (isMl) await reportConversion(e?.kind === 'SESSION' ? 'expired' : e?.kind === 'BLOCKED' ? 'blocked' : null, reason);
    await finish(eventId, 'FAILED', e?.debugFile ? `${reason} (print: data/linker/debug/${e.debugFile}.png)` : reason);
    // alerta no canal: fica no painel até alguém dispensar
    await prisma.channelSource.update({
      where: { id: source.id },
      data: {
        alert: `Conversão do link falhou (${event.link}): ${reason}`.slice(0, 500),
        alertAt: new Date(),
        alertCount: { increment: 1 },
        lastResult: `erro: ${reason}`.slice(0, 300),
      },
    });
    console.error(`[linker] ${event.link}: ${reason}`);
    return;
  }

  if (isMl) await reportConversion('ok', null);
  if ('skip' in result) return finish(eventId, 'SKIPPED', result.skip);
  const { product: p, affiliateUrl } = result;

  if (Date.now() - postAt.getTime() > MAX_LATE_MS) {
    return finish(eventId, 'SKIPPED', 'conversão terminou tarde demais (oferta velha)', { productUrl: p.productUrl, affiliateUrl });
  }

  // geral "variedades": produto de nicho com grupo próprio vai para o grupo (Channel.routeNiche)
  let dest: { id: string; platform: string; name: string } = channel;
  if (channel.categories.length === 0 && channel.routeNiche) {
    const known = await prisma.product.findFirst({ where: { store: p.store, storeProductId: p.itemId }, select: { category: true } });
    const niche = await nicheChannelFor(known?.category ?? classifyCategory(p.title), channel.id);
    if (niche && niche.platform === 'TELEGRAM') {
      const recent = await prisma.post.findFirst({
        where: {
          channelId: niche.id,
          product: { store: p.store, storeProductId: p.itemId },
          status: { in: ['SCHEDULED', 'POSTING', 'POSTED'] },
          createdAt: { gte: new Date(Date.now() - REPOST_WINDOW_MS) },
        },
        select: { id: true },
      });
      if (recent) return finish(eventId, 'SKIPPED', `produto já postado em ${niche.name} nas últimas 24h`, { productUrl: p.productUrl, affiliateUrl });
      dest = niche;
    }
  }

  // espaça do post anterior do canal (rajada do grupo não vira rajada nossa)
  const slot = await nextSlot(dest.id, postAt, source.minGapSec);
  if (slot.getTime() - postAt.getTime() > MAX_BACKLOG_MS) {
    return finish(eventId, 'SKIPPED', `muitas ofertas do grupo de uma vez: esta só sairia às ${hhmm(slot)}`, { productUrl: p.productUrl, affiliateUrl });
  }
  await createMirrorPost({ eventId, sourceId: source.id, channel: dest, product: p, affiliateUrl, postAt: slot, coupon: event.coupon });
  if (dest.id !== channel.id) await prisma.sourceEvent.update({ where: { id: eventId }, data: { detail: `post às ${hhmm(slot)} em ${dest.name} (nicho)` } });
}

/**
 * Cria o post já convertido e agenda o envio para `postAt` (ou já, se passou). Separado da
 * conversão para dar para testar sem a sessão do ML (cofre/10 → Testes).
 */
export async function createMirrorPost(args: {
  eventId: string;
  sourceId: string;
  channel: { id: string; platform: string };
  product: ConvertedProduct;
  affiliateUrl: string;
  postAt: Date;
  /** cupom lido da mensagem do grupo (só o código/valor) */
  coupon?: string | null;
}): Promise<{ postId: string; when: Date }> {
  const { eventId, sourceId, channel, product: p, affiliateUrl, postAt } = args;
  // cupom da própria mensagem; se não houver, o melhor cupom geral e válido da loja (grupo de cupons, cofre/11)
  const best = args.coupon ? null : await bestCouponFor(p.store, p.price);
  const coupon = args.coupon ?? (best ? couponLine(best) : null);
  if (best) await markCouponUsed(best.id);
  const product = await upsertProduct({
    store: p.store,
    storeProductId: p.itemId,
    url: p.productUrl,
    title: p.title,
    price: p.price,
    oldPrice: p.oldPrice,
    discountPct: p.discountPct,
    coupon,
    imageUrl: p.imageUrl,
    category: null,
    rating: p.rating,
    sales: null,
  });

  // nosso texto, com os dados do produto (nunca o texto/imagem da mensagem de origem)
  const template = renderMessageHtml({
    store: p.store,
    title: p.title,
    price: p.price,
    oldPrice: p.oldPrice,
    discountPct: p.discountPct,
    coupon,
    affiliateUrl: LINK_PLACEHOLDER,
  });
  const post = await prisma.$transaction(async (tx) => {
    const draft = await tx.post.create({
      data: {
        productId: product.id,
        channelId: channel.id,
        platform: channel.platform,
        message: template,
        affiliateUrl,
        // POSTING com sendAt: o scheduler não mexe, a fila do canal respeita a reserva e o job atrasado envia
        status: 'POSTING',
        sendAt: postAt,
        priority: 100,
        price: p.price,
      },
    });
    return tx.post.update({
      where: { id: draft.id },
      data: { message: template.replaceAll(LINK_PLACEHOLDER, escapeHtml(trackedLink(draft.id, affiliateUrl))) },
    });
  });

  const delay = Math.max(0, postAt.getTime() - Date.now());
  await publishQueue.add(
    'publish',
    { postId: post.id },
    { delay, jobId: `${post.id}-${Date.now()}`, attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true, removeOnFail: 100 },
  );

  const when = new Date(Date.now() + delay);
  await finish(eventId, 'CONVERTED', `post às ${hhmm(when)}`, { productUrl: p.productUrl, affiliateUrl, postId: post.id, postAt: when });
  await prisma.channelSource.update({
    where: { id: sourceId },
    data: { lastRunAt: new Date(), lastResult: `"${p.title.slice(0, 60)}" → ${affiliateUrl} · post às ${hhmm(when)}`.slice(0, 300) },
  });
  console.log(`[linker] ${p.productUrl} → ${affiliateUrl} · post ${post.id} às ${when.toISOString()}`);
  return { postId: post.id, when };
}

export async function closeMirror(): Promise<void> {
  await publishQueue.close();
}
