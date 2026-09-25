import type { FastifyRequest } from 'fastify';

/** Rotas /api/* que não exigem login nem chave de admin. */
const PUBLIC_API = ['/api/health', '/api/public/'];

/**
 * A rota casada exige autenticação de admin?
 * Decide pelo padrão da rota (`/api/users/:id`), nunca por `req.url`: o roteador decodifica
 * `%61pi` → `api` antes de casar, então checar o texto cru deixava `/%61pi/users` passar sem auth.
 * Sem rota casada (404) não há handler para proteger.
 */
export function isProtectedApi(req: FastifyRequest): boolean {
  const route = req.routeOptions.url;
  if (!route) return false;
  return route.startsWith('/api/') && !PUBLIC_API.some((p) => route.startsWith(p));
}
