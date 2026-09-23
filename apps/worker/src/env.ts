// Importado primeiro no index: imports ESM são avaliados antes do corpo do módulo,
// então o .env precisa carregar num módulo próprio, antes de qualquer config.
import { config as loadEnv } from 'dotenv';

loadEnv({ path: new URL('../../../.env', import.meta.url) });
