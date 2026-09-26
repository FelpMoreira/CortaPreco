import { canonicalProductUrl, ProviderRegistry, resolveLink, type AffiliateProvider } from '@cupons/affiliates';
import { ConversionError, type BeforeExpensiveStep, type ConversionResult } from './conversion.js';

/**
 * Conversão Amazon (espelhamento): bem mais simples que a do ML — não precisa de navegador nem de login.
 *  1. segue o encurtador (amzn.to / a.co) com o resolvedor seguro (cada salto conferido);
 *  2. pega o ASIN e monta a URL limpa `https://www.amazon.com.br/dp/ASIN` (some a tag e o rastreio de quem postou);
 *  3. nosso link = mesma URL com `?tag=AMAZON_PARTNER_TAG`;
 *  4. título/preço/imagem: leitura da página do produto (a mesma do "Nova oferta"), com teto por hora.
 * Detalhes e testes: cofre/10 - Espelhamento Mercado Livre.md → "Amazon".
 */

const registry = ProviderRegistry.fromEnv(process.env as Record<string, string | undefined>);
const amazonProvider = (): AffiliateProvider | undefined => registry.list().find((p) => p.store === 'AMAZON');

/**
 * A Amazon devolve tela anti-robô depois de ~45 leituras seguidas (visto em 2026-09-23): teto por hora e
 * um intervalo mínimo entre leituras. Passou do teto → a oferta é ignorada (sem alerta).
 */
const READS_PER_HOUR = 30;
const MIN_GAP_MS = 4_000;
const reads: number[] = [];

async function takeReadSlot(): Promise<void> {
  const hourAgo = Date.now() - 3_600_000;
  while (reads.length && reads[0]! < hourAgo) reads.shift();
  if (reads.length >= READS_PER_HOUR) {
    throw new ConversionError(`teto de leitura da Amazon (${READS_PER_HOUR}/h) atingido`, 'RATE');
  }
  const last = reads[reads.length - 1];
  if (last && Date.now() - last < MIN_GAP_MS) await new Promise((r) => setTimeout(r, MIN_GAP_MS - (Date.now() - last)));
  reads.push(Date.now());
}

export async function convertAmazon(link: string, before: BeforeExpensiveStep): Promise<ConversionResult> {
  const provider = amazonProvider();
  if (!provider) throw new ConversionError('AMAZON_PARTNER_TAG não configurada no .env (a nossa tag de afiliado)', 'CONFIG');

  let resolved: string;
  try {
    resolved = await resolveLink(link);
  } catch (err) {
    throw new ConversionError(`não consegui abrir o link da Amazon: ${(err as Error).message}`, 'NETWORK');
  }
  const productUrl = canonicalProductUrl(resolved);
  if (!productUrl || !/amazon\.com\.br$/i.test(new URL(resolved).hostname)) {
    throw new ConversionError('o link da Amazon não é de um produto da loja brasileira (lista, busca, Prime…)', 'NO_PRODUCT');
  }
  const asin = productUrl.split('/dp/')[1]!;

  const skip = await before({ store: 'AMAZON', itemId: asin }); // ex.: repetido → nem lê a página
  if (skip) return { skip };

  // nosso link: mesma URL limpa + a nossa tag (a de quem postou já saiu na limpeza)
  const { affiliateUrl } = await provider.affiliateLink(productUrl);

  await takeReadSlot();
  const data = await provider.enrich(productUrl);
  if (!data.price) {
    throw new ConversionError('a Amazon não mostrou o preço (página bloqueada por anti-robô?)', 'LAYOUT');
  }
  return {
    product: {
      store: 'AMAZON',
      productUrl,
      itemId: asin,
      title: data.title.slice(0, 300),
      price: data.price,
      oldPrice: data.oldPrice && data.oldPrice > data.price ? data.oldPrice : null,
      discountPct: data.discountPct,
      imageUrl: data.imageUrl,
      rating: data.rating,
    },
    affiliateUrl,
  };
}
