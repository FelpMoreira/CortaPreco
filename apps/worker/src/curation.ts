import { Queue, Worker } from 'bullmq';
import { ProviderRegistry } from '@cupons/affiliates';
import { curateWithFallback, curatorFromEnv, type Candidate } from '@cupons/curator';
import { prisma, upsertProduct } from '@cupons/db';
import { matchesNiche, type Store } from '@cupons/shared';
import { config } from './config.js';
import { linkHash, readerConfigured, readSource } from './telegramReader.js';

type CurateJob = { kind: 'urls'; urls: string[] } | { kind: 'discover' } | { kind: 'source'; sourceId: string } | { kind: 'sources-tick' };

export interface CurateOptions {
  minDiscount?: number;
  minRating?: number | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  maxPicks?: number;
  /** Destino: sugestão garimpada para um canal (fonte do canal). */
  channelId?: string;
  sourceId?: string;
}

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
  opts: CurateOptions = {},
): Promise<{ created: number; considered: number; curator: string; fallbackError?: string }> {
  const since = new Date(Date.now() - config.curation.cooldownDays * DAY);
  // com destino, o intervalo de repost vale por canal: o mesmo produto pode ir a outro grupo
  const inChannel = opts.channelId ? { channelId: opts.channelId } : {};
  const products = await prisma.product.findMany({
    where: {
      id: { in: productIds },
      price: { gt: 0 },
      status: { not: 'FILTERED' },
      // já sugerido e aguardando decisão, ou postado/na fila recentemente → fora
      suggestions: { none: { status: 'PENDING', ...inChannel } },
      posts: { none: { ...inChannel, OR: [{ status: { in: ['SCHEDULED', 'POSTING'] } }, { postedAt: { gte: since } }] } },
    },
    include: { priceHistory: { where: { createdAt: { gte: new Date(Date.now() - 30 * DAY) } }, select: { price: true } } },
  });

  const candidates: Candidate[] = [];
  for (const p of products) {
    const history = p.priceHistory.map((h) => Number(h.price)).sort((a, b) => a - b);
    const price = Number(p.price);
    if (opts.minDiscount && (p.discountPct ?? 0) < opts.minDiscount) continue;
    if (opts.minPrice && price < opts.minPrice) continue;
    if (opts.maxPrice && price > opts.maxPrice) continue;
    if (opts.minRating && p.rating && Number(p.rating) < opts.minRating) continue;
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
  const result = await curateWithFallback(curator, candidates, { max: opts.maxPicks ?? config.curation.maxPicks });
  if (result.fallbackError) console.warn(`[curadoria] usando regras: ${result.fallbackError}`);

  await prisma.suggestion.createMany({
    data: result.picks.map((pick) => ({
      productId: pick.productId,
      source,
      curator: result.curator,
      score: pick.score,
      reason: pick.reason,
      hook: pick.hook,
      channelId: opts.channelId ?? null,
      sourceId: opts.sourceId ?? null,
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

/**
 * Roda uma fonte de um canal. API: busca nas lojas marcadas com os termos/promoções da fonte,
 * descarta o que não é do nicho e cura com destino. TELEGRAM: etapa 2 (leitura com conta dedicada).
 */
export async function runSource(sourceId: string): Promise<Record<string, unknown>> {
  const source = await loadSource(sourceId);
  if (!source) return { error: 'fonte não existe' };
  const started = new Date();
  let summary: Record<string, unknown>;
  try {
    if (source.kind === 'API') {
      const rule = { categories: source.channel.categories, keywords: source.keywords, excludeWords: source.excludeWords };
      const found: string[] = [];
      const perStore: Record<string, unknown> = {};
      let offNiche = 0;
      for (const store of source.stores) {
        const provider = registry.list().find((p) => p.store === store);
        if (!provider?.discover) {
          perStore[store] = store === 'AMAZON' ? 'sem API (precisa da Creators API)' : 'sem credencial';
          continue;
        }
        const items = await provider.discover({
          limit: Math.max(10, source.maxPerRun * 4),
          keywords: source.keywords,
          promos: source.promos,
        });
        let kept = 0;
        for (const { commissionRate: _c, ...item } of items) {
          if (!matchesNiche(item.title, rule)) {
            offNiche++;
            continue;
          }
          found.push((await upsertProduct({ ...item, store: provider.store })).id);
          kept++;
        }
        perStore[store] = `${items.length} vistos, ${kept} do nicho`;
      }
      const cur = await curateProducts(found, `${source.channel.name}`, {
        minDiscount: source.minDiscount,
        minRating: source.minRating ? Number(source.minRating) : null,
        minPrice: source.minPrice ? Number(source.minPrice) : null,
        maxPrice: source.maxPrice ? Number(source.maxPrice) : null,
        maxPicks: source.maxPerRun,
        channelId: source.channelId,
        sourceId: source.id,
      });
      summary = { lojas: perStore, foraDoNicho: offNiche, sugestoes: cur.created, avaliados: cur.considered };
    } else if (!readerConfigured()) {
      summary = { aviso: 'conecte a conta dedicada do Telegram (npm run telegram:login) para ler esta fonte' };
    } else {
      summary = await runTelegramSource(source);
    }
  } catch (err) {
    summary = { error: (err as Error).message };
  }
  const text = summary.error
    ? `erro: ${summary.error}`
    : summary.aviso
      ? String(summary.aviso)
      : `${summary.sugestoes} sugestão(ões) · ${summary.avaliados} avaliado(s) · ${summary.foraDoNicho} fora do nicho` +
        (summary.links !== undefined
          ? ` · ${summary.links} link(s) em ${summary.mensagens} msg · ${summary.jaVistos} já vistos` +
            (summary.paraTentarDeNovo ? ` · ${summary.paraTentarDeNovo} p/ tentar de novo` : '')
          : '');
  await prisma.channelSource.update({ where: { id: sourceId }, data: { lastRunAt: started, lastResult: text.slice(0, 300) } });
  return summary;
}

// Amazon vinda de grupos: leitura de página com teto baixo até a Creators API (Condições de Uso)
const amazonReads: number[] = [];
const AMAZON_PER_HOUR = 10;
/** Tentativas de ler um link que falhou antes de desistir dele. */
const MAX_LINK_ATTEMPTS = 3;

/**
 * Fonte TELEGRAM: lê as mensagens novas do grupo de origem, pega só os links de produto
 * (já sem o rastreio de quem postou), busca os dados pela nossa integração e cura com destino.
 */
async function runTelegramSource(source: NonNullable<Awaited<ReturnType<typeof loadSource>>>): Promise<Record<string, unknown>> {
  const read = await readSource(source.telegramChat!, source.lastMessageId);
  const rule = { categories: source.channel.categories, keywords: source.keywords, excludeWords: source.excludeWords };
  const ids: string[] = [];
  let seen = 0;
  let offNiche = 0;
  let skipped = 0;
  let retry = 0;
  // links novos + os que falharam por motivo passageiro em rodadas anteriores
  const pending = await prisma.seenLink.findMany({
    where: { sourceId: source.id, status: 'RETRY', url: { not: null } },
    orderBy: { updatedAt: 'asc' },
    take: 10,
  });
  const urls = [...new Set([...read.productUrls.map((p) => p.canonical), ...pending.map((p) => p.url!)])];
  for (const canonical of urls) {
    const hash = linkHash(source.id, canonical);
    const prev = await prisma.seenLink.findUnique({ where: { urlHash: hash } });
    if (prev?.status === 'DONE') {
      seen++;
      continue;
    }
    // Marca o link DEPOIS de saber o resultado: falha da loja não pode descartá-lo para sempre.
    const mark = (status: 'DONE' | 'RETRY', failed = false) => {
      const attempts = (prev?.attempts ?? 0) + (failed ? 1 : 0);
      const final = status === 'RETRY' && attempts >= MAX_LINK_ATTEMPTS ? 'DONE' : status;
      return prisma.seenLink.upsert({
        where: { urlHash: hash },
        create: { urlHash: hash, sourceId: source.id, url: canonical, status: final, attempts },
        update: { status: final, attempts },
      });
    };
    let provider: ReturnType<typeof registry.providerFor>;
    try {
      provider = registry.providerFor(canonical);
    } catch {
      skipped++; // loja sem integração: não adianta tentar de novo
      await mark('DONE');
      continue;
    }
    if (provider.store === 'AMAZON') {
      const hourAgo = Date.now() - 3_600_000;
      while (amazonReads.length && amazonReads[0]! < hourAgo) amazonReads.shift();
      if (amazonReads.length >= AMAZON_PER_HOUR) {
        retry++; // teto de leitura da Amazon: fica para a próxima rodada
        await mark('RETRY');
        continue;
      }
      amazonReads.push(Date.now());
    }
    try {
      const data = await provider.enrich(canonical);
      if (!matchesNiche(data.title, rule)) {
        offNiche++;
        await mark('DONE');
        continue;
      }
      ids.push((await upsertProduct({ ...data, store: provider.store, url: canonical })).id);
      await mark('DONE');
      await sleep(1500); // volume humano nas páginas das lojas
    } catch {
      retry++; // produto indisponível ou loja fora do ar: tenta de novo nas próximas rodadas
      await mark('RETRY', true);
    }
  }
  if (read.lastMessageId) await prisma.channelSource.update({ where: { id: source.id }, data: { lastMessageId: BigInt(read.lastMessageId) } });
  const cur = await curateProducts(ids, source.channel.name, {
    minDiscount: source.minDiscount,
    minRating: source.minRating ? Number(source.minRating) : null,
    minPrice: source.minPrice ? Number(source.minPrice) : null,
    maxPrice: source.maxPrice ? Number(source.maxPrice) : null,
    maxPicks: source.maxPerRun,
    channelId: source.channelId,
    sourceId: source.id,
  });
  return {
    mensagens: read.messages,
    links: read.productUrls.length,
    jaVistos: seen,
    ignorados: skipped,
    paraTentarDeNovo: retry,
    foraDoNicho: offNiche,
    sugestoes: cur.created,
    avaliados: cur.considered,
  };
}

const loadSource = (id: string) => prisma.channelSource.findUnique({ where: { id }, include: { channel: true } });

/** Enfileira as fontes ativas cuja vez chegou (lastRunAt + intervalo). */
async function tickSources(): Promise<{ queued: number }> {
  const sources = await prisma.channelSource.findMany({
    where: { enabled: true, channel: { enabled: true } },
    select: { id: true, lastRunAt: true, intervalMin: true },
  });
  const now = Date.now();
  const due = sources.filter((s) => !s.lastRunAt || now - s.lastRunAt.getTime() >= s.intervalMin * 60_000);
  for (const s of due) {
    // jobId por fonte: não empilha a mesma fonte duas vezes enquanto uma rodada está na fila
    await curateQueue.add('source', { kind: 'source', sourceId: s.id }, { jobId: `source-${s.id}`, removeOnComplete: true, removeOnFail: true });
  }
  return { queued: due.length };
}

export function discoverySources(): string[] {
  return registry.list().filter((p) => p.discover).map((p) => p.store);
}

export function createCurateWorker(): Worker {
  const worker = new Worker(
    'curate',
    async (job) => {
      const data = job.data as CurateJob;
      const result =
        data.kind === 'urls'
          ? await curateUrls(data.urls)
          : data.kind === 'source'
            ? await runSource(data.sourceId)
            : data.kind === 'sources-tick'
              ? await tickSources()
              : await discover();
      if (!(data.kind === 'sources-tick' && (result as { queued: number }).queued === 0)) {
        console.log(`[curadoria] ${data.kind}:`, JSON.stringify(result));
      }
      return result;
    },
    { connection: { url: config.redisUrl }, concurrency: 1 },
  );
  worker.on('failed', (job, err) => console.error(`[curadoria] job ${job?.id} falhou: ${err.message}`));
  return worker;
}

/** Agenda a descoberta periódica (se ligada e se houver rede com API configurada). */
export async function scheduleDiscovery(): Promise<void> {
  // fontes dos canais: confere a cada 5 min quais estão na vez
  await curateQueue.upsertJobScheduler('sources-tick', { every: 5 * 60_000 }, { name: 'sources-tick', data: { kind: 'sources-tick' } });

  const every = config.curation.discoveryIntervalMin * 60 * 1000;
  if (!config.curation.discoveryEnabled || discoverySources().length === 0) {
    await curateQueue.removeJobScheduler('discover').catch(() => undefined);
    return;
  }
  await curateQueue.upsertJobScheduler('discover', { every }, { name: 'discover', data: { kind: 'discover' } });
  console.log(`[curadoria] descoberta a cada ${config.curation.discoveryIntervalMin} min: ${discoverySources().join(', ')}`);
}
