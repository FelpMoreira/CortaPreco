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
| POST | `/api/posts/:id/publish` | — | **Postar agora**: só SCHEDULED; pula fila e intervalo, respeita `POSTS_PER_DAY` |
| POST | `/api/posts/:id/requeue` | — | só FAILED/CANCELED, sem outro pendente do mesmo produto |
| GET | `/api/suggestions` | `?status=PENDING\|APPROVED\|REJECTED` | `{ suggestions, curator, discoverSources, running }` |
| POST | `/api/suggestions/batch` | `{ urls: string[] }` (1–15) | enfileira lote para o worker buscar e curar |
| POST | `/api/suggestions/discover` | — | busca nas APIs oficiais (Shopee/AliExpress) — 400 se nenhuma configurada |
| POST | `/api/suggestions/:id/approve` | `{ hook?, publishNow? }` | agenda (ou posta já) com a chamada; hook validado sem números |
| POST | `/api/suggestions/:id/reject` | — | só PENDING |
| GET | `/api/stats` | — | `clicks, clicks24h, scheduled, posted, posted24h, failed, postedWithClicks, top[5]` |
| GET | `/api/overview` | — | números, ritmo/fila por canal, publicados recentes e `alerts` (fontes com alerta) |
| GET | `/api/queues` | — | fila completa de cada canal (ordem por nota) + fontes que a abastecem |
| GET | `/api/channels` | — | canais com as fontes (`lastMessageId` como texto) |
| GET | `/api/sources/presets` | — | termos por categoria, promoções AliExpress, lojas disponíveis, `telegramReader`, `mirror` (tipos de link + saúde do ouvinte e do conversor) |
| POST | `/api/channels/:id/sources` | `kind` `API`\|`TELEGRAM`\|`MIRROR` + campos | DEV. `MIRROR` exige `telegramChat` e `linkTypes` (`MERCADOLIVRE`); só canal Telegram; `maxDelaySec` 0–600, `respectQuiet` |
| PATCH | `/api/sources/:id` | campos a mudar | DEV. Valida o estado final; trocar grupo/tipo ou **religar** espelhamento zera a posição de leitura |
| POST | `/api/sources/:id/run` | — | DEV. Roda a fonte agora (400 para `MIRROR`: roda sozinho) |
| GET | `/api/sources/:id/events` | — | últimas 30 mensagens do espelhamento (`status`, `detail`, links, post) |
| POST | `/api/sources/:id/dismiss-alert` | — | limpa o alerta da fonte (qualquer perfil; auditado) |
| GET | `/api/coupons` | `?status=NEW\|VALID\|RESTRICTED\|INVALID\|EXPIRED&store=MERCADOLIVRE\|AMAZON\|SHOPEE\|ALIEXPRESS` | `{ coupons (200), counts por status }` |
| PATCH | `/api/coupons/:id` | `{ status?: VALID\|INVALID, attachable?: boolean }` | corrige à mão (auditado) |
| POST | `/api/coupons/:id/test` | — | re-testa na conta de afiliado (só ML) |

## Mensagem

- Template em `packages/shared/src/template.ts`, HTML do Telegram.
- `{link}` é trocado no agendamento; se faltar, o link vai no fim.
- Ao mexer em rotas: atualizar a **allowlist** em `apps/web/app/api/admin/[...path]/route.ts` e esta nota.
