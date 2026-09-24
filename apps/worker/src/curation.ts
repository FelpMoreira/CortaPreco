import { Queue, Worker } from 'bullmq';
import { ProviderRegistry } from '@cupons/affiliates';
import { curateWithFallback, curatorFromEnv, type Candidate } from '@cupons/curator';
import { prisma, upsertProduct } from '@cupons/db';
import type { Store } from '@cupons/shared';
import { config } from './config.js';

type CurateJob = { kind: 'urls'; urls: string[] } | { kind: 'discover' };

export const curateQueue = new Queue('curate', { connection: { url: config.redisUrl } });

const registry = ProviderRegistry.fromEnv(process.env as Record<string, string | undefined>);
const curator = curatorFromEnv(process.env as Record<string, string | undefined>);
const DAY = 24 * 60 * 60 * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Filtra por regras, monta os candidatos (com histórico de preço), chama a curadoria
 * e grava as sugestões para aprovação. Números vêm do banco; a IA só escolhe e escreve.
 */
export async function curateProducts(
  productIds: string[],
  source: string,
  opts: { minDiscount?: number } = {},
): Promise<{ created: number; considered: number; curator: string; fallbackError?: string }> {
  const since = new Date(Date.now() - config.curation.cooldownDays * DAY);
  const products = await prisma.product.findMany({
    where: {
      id: { in: productIds },
      price: { gt: 0 },
      status: { not: 'FILTERED' },
      // já sugerido e aguardando decisão, ou postado/na fila recentemente → fora
      suggestions: { none: { status: 'PENDING' } },
      posts: { none: { OR: [{ status: { in: ['SCHEDULED', 'POSTING'] } }, { postedAt: { gte: since } }] } },
    },
    include: { priceHistory: { where: { createdAt: { gte: new Date(Date.now() - 30 * DAY) } }, select: { price: true } } },
  });

  const candidates: Candidate[] = [];
  for (const p of products) {
    const history = p.priceHistory.map((h) => Number(h.price)).sort((a, b) => a - b);
    const price = Number(p.price);
    if (opts.minDiscount && (p.discountPct ?? 0) < opts.minDiscount) continue;
    // desconto falso: diz que está em promoção mas custa mais que a mediana do que vimos
    if (p.discountPct && history.length >= 3 && price > history[Math.floor(history.length / 2)]!) continue;
    candidates.push({
      productId: p.id,
      store: p.store as Store,
      title: p.title,
      price,
      oldPrice: p.oldPrice ? Number(p.oldPrice) : null,
      discountPct: p.discountPct,
      rating: p.rating ? Number(p.rating) : null,
      sales: p.sales,
      category: p.category,
      commissionRate: null,
      lowest30d: history[0] ?? null,
      priceHistorySize: history.length,
    });
  }

  if (candidates.length === 0) return { created: 0, considered: 0, curator: curator.name };
  const result = await curateWithFallback(curator, candidates, { max: config.curation.maxPicks });
  if (result.fallbackError) console.warn(`[curadoria] usando regras: ${result.fallbackError}`);

  await prisma.suggestion.createMany({
    data: result.picks.map((pick) => ({
      productId: pick.productId,
      source,
      curator: result.curator,
      score: pick.score,
      reason: pick.reason,
      hook: pick.hook,
    })),
  });
  return { created: result.picks.length, considered: candidates.length, ...result };
}

/** Lote de links colados pelo admin: busca cada um devagar (volume humano) e cura. */
async function curateUrls(urls: string[]) {
  const ids: string[] = [];
  const errors: string[] = [];
  const stores = new Set<string>();
  for (const [i, url] of urls.entries()) {
    if (i > 0) await sleep(2500);
    try {
      const provider = registry.providerFor(url);
      const data = await provider.enrich(url);
      const product = await upsertProduct({ ...data, store: provider.store, url });
      ids.push(product.id);
      stores.add(provider.store);
    } catch (err) {
      errors.push(`${url}: ${(err as Error).message}`);
    }
  }
  const source = stores.size === 1 ? `${[...stores][0]}_MANUAL` : 'MANUAL';
  const result = await curateProducts(ids, source);
  return { ...result, fetched: ids.length, errors };
}

/** Descoberta pelas APIs oficiais das redes que suportam (hoje: Shopee e AliExpress). */
async function discover() {
  const summary: Record<string, unknown> = {};
  for (const provider of registry.list()) {
    if (!provider.discover) continue;
    try {
      const items = await provider.discover({ limit: config.curation.discoveryLimit });
      const ids: string[] = [];
      for (const { commissionRate: _c, ...item } of items) {
        ids.push((await upsertProduct({ ...item, store: provider.store })).id);
      }
      summary[provider.store] = await curateProducts(ids, `${provider.store}_API`, {
        minDiscount: config.curation.discoveryMinDiscount,
      });
    } catch (err) {
      summary[provider.store] = { error: (err as Error).message };
    }
  }
  return summary;
}

export function discoverySources(): string[] {
  return registry.list().filter((p) => p.discover).map((p) => p.store);
}

export function createCurateWorker(): Worker {
  const worker = new Worker(
    'curate',
    async (job) => {
      const data = job.data as CurateJob;
      const result = data.kind === 'urls' ? await curateUrls(data.urls) : await discover();
      console.log(`[curadoria] ${data.kind}:`, JSON.stringify(result));
      return result;
    },
    { connection: { url: config.redisUrl }, concurrency: 1 },
  );
  worker.on('failed', (job, err) => console.error(`[curadoria] job ${job?.id} falhou: ${err.message}`));
  return worker;
}

/** Agenda a descoberta periódica (se ligada e se houver rede com API configurada). */
export async function scheduleDiscovery(): Promise<void> {
  const every = config.curation.discoveryIntervalMin * 60 * 1000;
  if (!config.curation.discoveryEnabled || discoverySources().length === 0) {
    await curateQueue.removeJobScheduler('discover').catch(() => undefined);
    return;
  }
  await curateQueue.upsertJobScheduler('discover', { every }, { name: 'discover', data: { kind: 'discover' } });
  console.log(`[curadoria] descoberta a cada ${config.curation.discoveryIntervalMin} min: ${discoverySources().join(', ')}`);
}
