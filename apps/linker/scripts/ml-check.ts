/**
 * Diagnóstico da conversão, SEM postar nada:
 *
 *   npm run ml:check -- https://meli.la/abc            → abre o link e mostra o produto (URL limpa, preço…)
 *   npm run ml:check -- https://meli.la/abc --gerar    → também gera o link de afiliado (usa a sessão)
 *   npm run ml:check -- https://amzn.to/abc            → Amazon: URL limpa, NOSSO link (tag trocada) e dados da página
 *   npm run ml:check -- --sessao                       → só confere se a sessão do ML vale
 *   npm run ml:check -- --cupom TODOSITE10             → testa um cupom do ML (válido = fica na conta de afiliado)
 *
 * No Docker: docker compose exec linker npm run ml:check -w @cupons/linker -- https://meli.la/abc
 */
import '../src/env.js';
import { closeBrowser, hasMlSession, withPage } from '../src/browser.js';
import { mirrorLinkType } from '@cupons/shared';
import { convertAmazon } from '../src/amazon.js';
import { checkMlSession, ConversionError, generateAffiliateLink, resolveProduct } from '../src/mercadolivre.js';

const args = process.argv.slice(2);
const link = args.find((a) => /^https?:\/\//.test(a));
try {
  if (args.includes('--cupom')) {
    const code = args[args.indexOf('--cupom') + 1]?.toUpperCase();
    if (!code) throw new Error('informe o código: --cupom CODIGO');
    const { testMlCode } = await import('../src/couponTest.js');
    console.log(JSON.stringify(await testMlCode(code), null, 2));
  } else if (args.includes('--sessao')) {
    console.log(`arquivo de sessão: ${hasMlSession() ? 'existe' : 'NÃO existe (rode npm run ml:login)'}`);
    if (hasMlSession()) console.log('sessão:', await withPage({ session: true }, (page) => checkMlSession(page)));
  } else if (link && mirrorLinkType(link) === 'AMAZON') {
    const out = await convertAmazon(link, async () => null);
    console.log(JSON.stringify(out, null, 2));
  } else if (link) {
    const out = await withPage({ session: args.includes('--gerar') }, async (page, ctx) => {
      const product = await resolveProduct(page, ctx, link);
      const affiliateUrl = args.includes('--gerar') ? await generateAffiliateLink(page, ctx, product.productUrl) : null;
      return { ...product, affiliateUrl };
    });
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log('uso: npm run ml:check -- <link meli.la> [--gerar] | --sessao');
  }
} catch (err) {
  if (err instanceof ConversionError) {
    console.error(`FALHOU [${err.kind}]: ${err.message}${err.debugFile ? ` (print: data/linker/debug/${err.debugFile}.png)` : ''}`);
  } else console.error('FALHOU:', err);
  process.exitCode = 1;
} finally {
  await closeBrowser();
  // as filas (Redis) importadas pelo teste de cupom mantêm o processo vivo: encerra explicitamente
  process.exit(process.exitCode ?? 0);
}
