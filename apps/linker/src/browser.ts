import { existsSync, readFileSync } from 'node:fs';
import { chmod, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { config } from './config.js';

/**
 * Navegador do linker. Um Chromium por processo (aberto sob demanda e fechado depois de um tempo
 * parado); um contexto novo por conversão, carregando a sessão salva da conta de afiliado.
 */

/**
 * UA padrão de Chrome de desktop (sem sessão salva). Com sessão, vale o UA do Chrome onde ela foi
 * criada (`sessionUserAgent`). Sem isso o headless se anuncia como "HeadlessChrome".
 */
export const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

export const CONTEXT_OPTIONS = {
  userAgent: USER_AGENT,
  locale: 'pt-BR',
  timezoneId: 'America/Sao_Paulo',
  viewport: { width: 1366, height: 900 },
} as const;

/**
 * O tsx (esbuild com keepNames) envolve funções em `__name(...)`; o código passado a
 * `page.evaluate` roda na página, onde esse helper não existe → "ReferenceError: __name".
 */
export const NAME_SHIM = 'globalThis.__name = globalThis.__name || ((f) => f);';

const IDLE_CLOSE_MS = 10 * 60_000;
const MAX_DEBUG_FILES = 40;

let browser: Browser | null = null;
let idleTimer: NodeJS.Timeout | null = null;

async function getBrowser(): Promise<Browser> {
  if (idleTimer) clearTimeout(idleTimer);
  if (browser?.isConnected()) return browser;
  browser = await chromium.launch({ headless: config.headless, channel: config.browserChannel });
  return browser;
}

function scheduleIdleClose(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => void closeBrowser(), IDLE_CLOSE_MS);
  idleTimer.unref();
}

export async function closeBrowser(): Promise<void> {
  const b = browser;
  browser = null;
  await b?.close().catch(() => undefined);
}

export const hasMlSession = (): boolean => existsSync(config.mlStatePath);

export interface SessionMeta {
  userAgent: string;
  browser?: string;
  savedAt: string;
}

/** UA do navegador em que você fez o `ml:login` (lido a cada conversão: um login novo vale na hora). */
export function sessionUserAgent(): string {
  try {
    const meta = JSON.parse(readFileSync(config.mlMetaPath, 'utf8')) as Partial<SessionMeta>;
    // nunca se anunciar como headless, mesmo se o arquivo vier de um navegador assim
    if (meta.userAgent && !/headless/i.test(meta.userAgent)) return meta.userAgent;
  } catch {
    /* sem arquivo: UA padrão */
  }
  return USER_AGENT;
}

export async function saveSessionMeta(meta: SessionMeta): Promise<void> {
  await mkdir(config.dataDir, { recursive: true });
  await writeFile(config.mlMetaPath, JSON.stringify(meta, null, 2), { mode: 0o600 });
  await chmod(config.mlMetaPath, 0o600).catch(() => undefined);
}

/**
 * Nada de rede interna a partir do navegador: os links vêm de grupos de terceiros e um redirect
 * poderia apontar para `http://api:3001`, `localhost` ou o IP de metadados da nuvem.
 */
export function isAllowedBrowserUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol === 'data:' || u.protocol === 'blob:') return true;
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host.includes('.') || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return false;
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return false;
  if (host.includes(':')) return false; // IPv6 literal (::1, fc00::/7...): nenhum site do ML usa
  return true;
}

async function newContext(withSession: boolean): Promise<BrowserContext> {
  const b = await getBrowser();
  const session = withSession && hasMlSession();
  const ctx = await b.newContext({
    ...CONTEXT_OPTIONS,
    userAgent: session ? sessionUserAgent() : USER_AGENT,
    storageState: session ? config.mlStatePath : undefined,
  });
  await ctx.addInitScript(NAME_SHIM);
  await ctx.route('**/*', (route) => (isAllowedBrowserUrl(route.request().url()) ? route.continue() : route.abort('blockedbyclient')));
  return ctx;
}

/** Salva a sessão atualizada (o ML renova cookies): gravação atômica, só o dono lê. */
export async function saveSession(ctx: BrowserContext, path = config.mlStatePath): Promise<void> {
  await mkdir(config.dataDir, { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(await ctx.storageState()), { mode: 0o600 });
  await rename(tmp, path);
  await chmod(path, 0o600).catch(() => undefined);
}

/** Print + HTML da página no momento da falha. Devolve o nome do arquivo (sem o caminho). */
export async function saveDebug(page: Page, label: string): Promise<string | null> {
  try {
    await mkdir(config.debugDir, { recursive: true });
    const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${label.replace(/[^a-z0-9-]/gi, '')}`;
    await page.screenshot({ path: join(config.debugDir, `${name}.png`), fullPage: true, timeout: 10_000 });
    await writeFile(join(config.debugDir, `${name}.html`), await page.content(), { mode: 0o600 });
    // guarda só os mais recentes
    const files = (await readdir(config.debugDir)).sort();
    for (const f of files.slice(0, Math.max(0, files.length - MAX_DEBUG_FILES))) await rm(join(config.debugDir, f)).catch(() => undefined);
    return name;
  } catch {
    return null;
  }
}

/**
 * Roda `fn` numa aba nova. Com `session`, carrega a conta de afiliado e, se tudo deu certo,
 * salva os cookies renovados. O contexto é sempre fechado.
 */
export async function withPage<T>(opts: { session: boolean }, fn: (page: Page, ctx: BrowserContext) => Promise<T>): Promise<T> {
  // só regrava a sessão se ela existia: senão gravaria cookies anônimos como se fosse um login
  const hadSession = opts.session && hasMlSession();
  const ctx = await newContext(opts.session);
  try {
    const page = await ctx.newPage();
    page.setDefaultTimeout(20_000);
    const result = await fn(page, ctx);
    if (hadSession) await saveSession(ctx);
    return result;
  } finally {
    await ctx.close().catch(() => undefined);
    scheduleIdleClose();
  }
}
