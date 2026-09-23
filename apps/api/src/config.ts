const isProd = process.env.NODE_ENV === 'production';

export const config = {
  isProd,
  port: Number(process.env.API_PORT || 3001),
  host: process.env.API_HOST || '0.0.0.0',
  /** Atrás de proxy/túnel (nginx, cloudflared): usa X-Forwarded-For p/ o IP real no rate limit. */
  trustProxy: process.env.TRUST_PROXY === 'true',
  /** Domínio público do redirector `/c/{id}`. Vazio = mensagens usam o link de afiliado direto. */
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
  adminApiKey: process.env.ADMIN_API_KEY || '',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
};

/** Falha cedo se a configuração não é segura o bastante para subir. */
export function assertSafeConfig(): void {
  const problems: string[] = [];
  if (config.adminApiKey.length < 32) problems.push('ADMIN_API_KEY precisa de 32+ caracteres (openssl rand -hex 32)');
  if (isProd && config.publicBaseUrl && !config.publicBaseUrl.startsWith('https://')) {
    problems.push('PUBLIC_BASE_URL deve ser https:// em produção');
  }
  if (problems.length) {
    const msg = `Configuração insegura:\n- ${problems.join('\n- ')}`;
    if (isProd) throw new Error(msg);
    console.warn(`[api] ${msg}`);
  }
}
