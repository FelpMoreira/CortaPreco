# 09 — API

Base: `http://localhost:3001` (dev). Respostas JSON com `ok: boolean`; erro traz `error: string`.
Admin = header `Authorization: Bearer <ADMIN_API_KEY>`. O painel chama tudo via `/api/admin/<rota>` no Next,
que injeta a chave (ver [[08 - Segurança]]).

## Públicas

| Método | Rota | O que faz |
|--------|------|-----------|
| GET | `/api/health` | `{ ok: true }` |
| GET | `/api/public/catalog` | Últimos 60 posts publicados + `base` do redirector |
| GET | `/c/:postId` | Registra clique (post POSTED, sem robô) e 302 para o link de afiliado; 404 se não existe/cancelado |

## Admin

| Método | Rota | Corpo / query | Resposta |
|--------|------|---------------|----------|
| POST | `/api/preview` | `{ url }` (http/https, ≤2048) | `{ product, message }` — cria/atualiza o produto |
| GET | `/api/products` | — | `{ products }` (100 mais recentes, com `_count.posts`) |
| PATCH | `/api/products/:id` | qualquer de `title, price, oldPrice, coupon, imageUrl, status` | `{ product, message }` — desconto recalculado |
| GET | `/api/posts` | `?status=SCHEDULED\|POSTING\|POSTED\|FAILED\|CANCELED` | `{ posts, publicBaseUrl }` |
| POST | `/api/posts` | `{ productId, messageOverride? }` (≤3500, use `{link}`) | `{ post }` — 400 se sem preço |
| POST | `/api/posts/:id/cancel` | — | só SCHEDULED |
| POST | `/api/posts/:id/requeue` | — | só FAILED/CANCELED, sem outro pendente do mesmo produto |
| GET | `/api/stats` | — | `clicks, clicks24h, scheduled, posted, posted24h, failed, postedWithClicks, top[5]` |

## Mensagem

- Template em `packages/shared/src/template.ts`, HTML do Telegram.
- `{link}` é trocado no agendamento; se faltar, o link vai no fim.
- Ao mexer em rotas: atualizar a **allowlist** em `apps/web/app/api/admin/[...path]/route.ts` e esta nota.
