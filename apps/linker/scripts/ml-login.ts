/**
 * Login na CONTA DE AFILIADO do Mercado Livre (uma vez; repetir quando o painel avisar que a sessão expirou).
 *
 *   npm run ml:login          (na raiz do repo, FORA do Docker: abre uma janela, precisa de tela)
 *
 * Abre o SEU Google Chrome como um navegador comum — perfil próprio em data/linker/chrome-profile, SEM
 * Playwright controlando a janela. Janela controlada por automação é detectada pelo ML/reCAPTCHA e o login
 * cai em "limite de tentativas" (aconteceu em 2026-09-26). O script só observa, pela porta de depuração
 * local, qual endereço está aberto; quando o gerador de links aparece, conecta, copia os cookies e o
 * User-Agent do Chrome e salva em data/linker/ (o container do linker lê pelo volume ./data/linker).
 *
 * Os arquivos são o acesso à conta: não versione, não compartilhe (data/ fica fora do git).
 */
import '../src/env.js';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { saveSession, saveSessionMeta } from '../src/browser.js';
import { config } from '../src/config.js';
import { LINKBUILDER_URL } from '../src/mercadolivre.js';

const PORT = Number(process.env.LINKER_LOGIN_PORT || 9223);
const WAIT_MS = 20 * 60_000;
const CDP = `http://127.0.0.1:${PORT}`;

function findChrome(): string | null {
  const candidates = [
    process.env.LINKER_CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/opt/google/chrome/chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  return candidates.find((p): p is string => Boolean(p && existsSync(p))) ?? null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function openTabs(): Promise<{ url: string; type: string }[]> {
  const res = await fetch(`${CDP}/json/list`).catch(() => null);
  return res?.ok ? ((await res.json()) as { url: string; type: string }[]) : [];
}

const chrome = findChrome();
if (!chrome) {
  console.error('Google Chrome não encontrado. Instale o Chrome ou informe o caminho em LINKER_CHROME_PATH.');
  process.exit(1);
}

const profileDir = `${config.dataDir}/chrome-profile`;
await mkdir(profileDir, { recursive: true, mode: 0o700 });

// Chrome comum: só perfil próprio + porta de depuração local (nada de --enable-automation)
const proc = spawn(
  chrome,
  [`--user-data-dir=${profileDir}`, `--remote-debugging-port=${PORT}`, '--no-first-run', '--no-default-browser-check', LINKBUILDER_URL],
  { stdio: 'ignore' },
);
proc.on('exit', () => {
  console.error('\nA janela do Chrome foi fechada antes de salvar a sessão. Rode de novo.');
  process.exit(1);
});

console.log('\nAbri o Chrome (perfil separado, só para o linker).');
console.log('Entre na sua conta de AFILIADO do Mercado Livre como faria normalmente.');
console.log('Quando a tela do gerador de links aparecer, eu salvo a sessão sozinho (espero até 20 min).');
console.log('Se o ML disser "limite de tentativas": feche, espere algumas horas e tente de novo — insistir estende o bloqueio.\n');

// só observa a lista de abas (não conecta na página durante o login)
const deadline = Date.now() + WAIT_MS;
let ready = false;
while (Date.now() < deadline) {
  await sleep(2_000);
  const tabs = await openTabs();
  const onBuilder = tabs.some((t) => t.type === 'page' && /^https:\/\/www\.mercadolivre\.com\.br\/afiliados\/linkbuilder/.test(t.url));
  if (onBuilder) {
    await sleep(4_000); // deixa terminar redirecionamentos e cookies assentarem
    if ((await openTabs()).some((t) => /^https:\/\/www\.mercadolivre\.com\.br\/afiliados\/linkbuilder/.test(t.url))) {
      ready = true;
      break;
    }
  }
}
if (!ready) {
  console.error('O gerador de links não apareceu a tempo. Rode de novo.');
  proc.kill();
  process.exit(1);
}

proc.removeAllListeners('exit');
const version = (await (await fetch(`${CDP}/json/version`)).json()) as { 'User-Agent': string; Browser: string };
const browser = await chromium.connectOverCDP(CDP);
const ctx = browser.contexts()[0];
if (!ctx) {
  console.error('Não consegui ler a sessão do Chrome. Rode de novo.');
  proc.kill();
  process.exit(1);
}
await saveSession(ctx);
// o linker se apresenta com o MESMO User-Agent do navegador onde a sessão nasceu
await saveSessionMeta({ userAgent: version['User-Agent'], browser: version.Browser, savedAt: new Date().toISOString() });
console.log(`Sessão salva em ${config.mlStatePath} (permissão 600), navegador ${version.Browser}.`);
await browser.close().catch(() => undefined); // só desconecta
proc.kill();
console.log('Pode conferir: docker compose exec linker npm run ml:check -w @cupons/linker -- --sessao');
process.exit(0);
