import { Queue, Worker } from 'bullmq';
import { afterQuietHours, inQuietHours, prisma } from '@cupons/db';
import {
  COUPON_POST_QUEUE,
  couponSummary,
  parseCouponMessage,
  renderCouponHtml,
  type CouponPostJob,
  type CouponStore,
  type MirrorJob,
} from '@cupons/shared';
import { config } from './config.js';
import { sendTelegramMessage } from './sender.js';
import { extractLinks, type MessageLike } from './telegramLinks.js';

/**
 * Grupo de CUPONS (fonte COUPONS, cofre/11): o ouvinte do espelhamento entrega cada mensagem nova aqui.
 *  - lê os cupons (código, loja, desconto, mínimo, teto, escopo) e guarda em `Coupon` (um por loja+código);
 *  - Mercado Livre → fila `mirror` para o linker testar na conta de afiliado;
 *  - com "postar cupons" ligado, agenda a publicação no canal da fonte, espaçada (fila `coupon-post`).
 * Os links que vêm com os cupons são do afiliado que postou: ficam só no painel (`sourceLink`).
 */
export const couponPostQueue = new Queue<CouponPostJob>(COUPON_POST_QUEUE, { connection: { url: config.redisUrl } });

/** Validade padrão de cupom de loja que não testamos (Amazon, Shopee, AliExpress). */
const UNTESTED_TTL_MS = 24 * 3_600_000;
/** Cupom do ML visto de novo: re-testa se o último teste tem mais que isso. */
const RETEST_AFTER_MS = 30 * 60_000;

export interface CouponWatch {
  sourceId: string;
  stores: string[];
}

export async function collectCoupons(w: CouponWatch, msg: { id: number } & MessageLike, mirrorQueue: Queue<MirrorJob>): Promise<void> {
  const text = msg.message ?? '';
  const codeSpans = (msg.entities ?? [])
    .filter((e) => (e.className === 'MessageEntityCode' || e.className === 'MessageEntityPre') && e.offset !== undefined && e.length)
    .map((e) => text.slice(e.offset!, e.offset! + e.length!));
  const found = parseCouponMessage({ text, codeSpans, links: extractLinks(msg) }).filter((c) => w.stores.includes(c.store));
  if (!found.length) return;

  const now = new Date();
  let fresh = 0;
  for (const c of found) {
    const prev = await prisma.coupon.findUnique({ where: { store_code: { store: c.store, code: c.code } } });
    const fields = {
      discountPct: c.discountPct,
      discountValue: c.discountValue,
      minPurchase: c.minPurchase,
      maxDiscount: c.maxDiscount,
      scope: c.scope,
      sourceLink: c.link,
    };
    let coupon;
    if (!prev) {
      fresh++;
      coupon = await prisma.coupon.create({
        data: {
          store: c.store,
          code: c.code,
          title: couponSummary(c),
          ...fields,
          attachable: c.general,
          // ML: a validade vem do teste; outras lojas: 24 h a partir de agora
          expiresAt: c.store === 'MERCADOLIVRE' ? null : new Date(now.getTime() + UNTESTED_TTL_MS),
          sourceId: w.sourceId,
          messageId: BigInt(msg.id),
        },
      });
    } else {
      // visto de novo: o grupo está divulgando → renova (e completa o que faltava)
      const revived = prev.status === 'EXPIRED' || prev.status === 'INVALID';
      coupon = await prisma.coupon.update({
        where: { id: prev.id },
        data: {
          seenCount: { increment: 1 },
          lastSeenAt: now,
          ...Object.fromEntries(Object.entries(fields).filter(([k, v]) => v !== null && prev[k as keyof typeof prev] === null)),
          ...(revived ? { status: 'NEW', statusDetail: 'visto de novo no grupo' } : {}),
          ...(c.store !== 'MERCADOLIVRE' ? { expiresAt: new Date(now.getTime() + UNTESTED_TTL_MS) } : {}),
        },
      });
    }

    const needsTest =
      c.store === 'MERCADOLIVRE' &&
      (coupon.status === 'NEW' || !coupon.checkedAt || now.getTime() - coupon.checkedAt.getTime() > RETEST_AFTER_MS);
    if (needsTest) {
      // um teste por cupom por vez (jobId fixo); o linker agenda a publicação se der válido
      await mirrorQueue.add('coupon-test', { couponId: coupon.id }, { jobId: `coupon-test-${coupon.id}`, removeOnComplete: true, removeOnFail: 50 });
    } else if (c.store !== 'MERCADOLIVRE' && !coupon.postAt) {
      await couponPostQueue.add('schedule', { couponId: coupon.id, step: 'schedule' }, { removeOnComplete: true, removeOnFail: 50 });
    }
  }
  await prisma.channelSource.update({
    where: { id: w.sourceId },
    data: {
      lastRunAt: now,
      lastResult: `${found.length} cupom(ns) na última mensagem (${fresh} novo(s)): ${found.map((c) => c.code).join(', ')}`.slice(0, 300),
    },
  });
  console.log(`[cupons] msg ${msg.id}: ${found.map((c) => `${c.store}:${c.code}`).join(' ')}`);
}

/** Cupom pode ser publicado? ML só testado e aceito; outras lojas enquanto não vencer nem for marcado inválido. */
const postable = (c: { store: string; status: string; expiresAt: Date | null }) =>
  (c.store === 'MERCADOLIVRE' ? c.status === 'VALID' : c.status === 'NEW' || c.status === 'VALID') &&
  (!c.expiresAt || c.expiresAt.getTime() > Date.now());

async function scheduleCouponPost(couponId: string): Promise<void> {
  const coupon = await prisma.coupon.findUnique({ where: { id: couponId }, include: { source: { include: { channel: true } } } });
  const source = coupon?.source;
  if (!coupon || !source || coupon.postAt || coupon.postedAt) return;
  if (!source.postCoupons || !source.enabled || !source.channel.enabled || !postable(coupon)) return;
  const channel = source.channel;

  // espaça dos outros cupons e do último post do canal (mesma ideia do espelhamento)
  const [lastCoupon, lastPost] = await Promise.all([
    prisma.coupon.findFirst({ where: { source: { channelId: channel.id }, postAt: { not: null } }, orderBy: { postAt: 'desc' }, select: { postAt: true } }),
    prisma.post.findFirst({ where: { channelId: channel.id, status: 'POSTED' }, orderBy: { postedAt: 'desc' }, select: { postedAt: true } }),
  ]);
  const last = Math.max(lastCoupon?.postAt?.getTime() ?? 0, lastPost?.postedAt?.getTime() ?? 0);
  let at = Math.max(Date.now(), last ? last + source.minGapSec * 1000 * (1 + Math.random() * 0.3) : 0);
  if (source.respectQuiet && channel.quietHours && inQuietHours(channel.quietHours, new Date(at))) {
    at = afterQuietHours(channel.quietHours, new Date(at)).getTime(); // cupom de madrugada sai às 7h
  }
  await prisma.coupon.update({ where: { id: coupon.id }, data: { postAt: new Date(at) } });
  await couponPostQueue.add('send', { couponId, step: 'send' }, { delay: Math.max(0, at - Date.now()), removeOnComplete: true, removeOnFail: 50 });
}

async function sendCouponPost(couponId: string): Promise<void> {
  const coupon = await prisma.coupon.findUnique({ where: { id: couponId }, include: { source: { include: { channel: true } } } });
  if (!coupon?.source || coupon.postedAt) return;
  if (!postable(coupon)) {
    await prisma.coupon.update({ where: { id: coupon.id }, data: { postError: `não publicado: cupom ${coupon.status.toLowerCase()}` } });
    return;
  }
  const html = renderCouponHtml({
    store: coupon.store as CouponStore,
    code: coupon.code,
    title: coupon.title,
    minPurchase: coupon.minPurchase ? Number(coupon.minPurchase) : null,
    maxDiscount: coupon.maxDiscount ? Number(coupon.maxDiscount) : null,
    scope: coupon.scope,
    expiresAt: coupon.expiresAt,
  });
  try {
    await sendTelegramMessage(coupon.source.channel.target, html);
    await prisma.coupon.update({ where: { id: coupon.id }, data: { postedAt: new Date(), postError: null } });
    console.log(`[cupons] publicado ${coupon.store}:${coupon.code} em ${coupon.source.channel.name}`);
  } catch (err) {
    await prisma.coupon.update({ where: { id: coupon.id }, data: { postError: (err as Error).message.slice(0, 300) } });
    throw err;
  }
}

export function createCouponPostWorker(): Worker<CouponPostJob> {
  return new Worker<CouponPostJob>(
    COUPON_POST_QUEUE,
    async (job) => (job.data.step === 'schedule' ? scheduleCouponPost(job.data.couponId) : sendCouponPost(job.data.couponId)),
    { connection: { url: config.redisUrl }, concurrency: 1 },
  );
}

/** Vencidos saem de circulação (não vão junto de post nem para o canal). Roda no tick do scheduler. */
export async function expireCoupons(): Promise<void> {
  await prisma.coupon.updateMany({
    where: { status: { in: ['NEW', 'VALID', 'RESTRICTED'] }, expiresAt: { lt: new Date() } },
    data: { status: 'EXPIRED', statusDetail: 'venceu' },
  });
}
