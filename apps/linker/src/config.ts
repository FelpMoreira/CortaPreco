import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Pasta de dados do linker: sessão do Mercado Livre (cookies = acesso à conta) e prints de falha.
// Fica em data/linker/ na raiz do repo (fora do git); no Docker é o volume ./data/linker.
const dataDir = process.env.LINKER_DATA_DIR || fileURLToPath(new URL('../../../data/linker', import.meta.url));

export const config = {
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  /** Domínio do redirector /c/{postId}; vazio = a mensagem leva o link de afiliado direto. */
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
  dataDir,
  /** storageState do Playwright com a sessão da conta de afiliado (gerado por `npm run ml:login`). */
  mlStatePath: join(dataDir, 'mercadolivre-state.json'),
  /** User-Agent do Chrome onde a sessão foi criada (o linker se apresenta igual). */
  mlMetaPath: join(dataDir, 'mercadolivre-meta.json'),
  /** Print + HTML da página quando a conversão falha (para ajustar seletor). */
  debugDir: join(dataDir, 'debug'),
  /** `chrome` usa o Google Chrome instalado (útil fora do Docker); vazio = Chromium do Playwright. */
  browserChannel: process.env.LINKER_BROWSER_CHANNEL || undefined,
  headless: process.env.LINKER_HEADLESS !== 'false',
};
