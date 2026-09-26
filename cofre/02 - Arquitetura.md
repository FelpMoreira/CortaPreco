# 02 — Arquitetura

Monorepo npm workspaces, TypeScript estrito, Node 20+. Etapas desacopladas por fila (BullMQ + Redis).

```text
 navegador ──► [web] Next.js ──(Bearer ADMIN_API_KEY, só servidor)──► [api] Fastify ──► Postgres
   painel /admin    proxy /api/admin/* (allowlist)                     preview/enrich
   site público /   catálogo (ISR 60s)                                 agenda post (link + subID)
                                                                           │
                               [worker] scheduler (tick 60s) ◄─────────────┘ posts SCHEDULED
                                   │ claim SCHEDULED→POSTING + fila "publish"
                                   ▼
                               [worker] publish ──► Telegram Bot API ──► canal
                                                                           │ membro clica
                                                                           ▼
                               [api] /c/{postId} ── registra clique ──► 302 link de afiliado
```

## Serviços e onde fica cada coisa

| App/pacote | Papel | Arquivos-chave |
|-----------|-------|----------------|
| `apps/api` | Fastify: preview, produtos, posts, métricas, catálogo público, redirector `/c/` | `server.ts` (rotas + auth), `services/deals.ts` (regras) |
| `apps/worker` | Scheduler (tick 60s) + envio + curadoria/fontes + ouvinte do espelhamento | `scheduler.ts`, `worker.ts`, `curation.ts`, `mirror.ts`, `telegramReader.ts` |
| `apps/bot` | grammY: `/start`, `/whoami`, `/stats`, `/channel` | `index.ts` |
| `apps/linker` | Navegador (Playwright/Chromium) logado na conta de afiliado do ML: converte links do espelhamento | `mercadolivre.ts`, `mirror.ts`, `browser.ts` — ver [[10 - Espelhamento Mercado Livre]] |
| `apps/web` | Next.js: painel `/admin` + site público `/` | `middleware.ts` (sessão + CSRF), `app/api/admin/[...path]` (proxy), `app/admin/_ui/*` |
| `packages/affiliates` | Providers Shopee/AliExpress/Amazon, interface única; resolvedor seguro de links de terceiros | `types.ts` (`AffiliateProvider`), `links.ts` (`resolveLink`, `canonicalProductUrl`, `isAllowedHop`) |
| `packages/shared` | Tipos + template da mensagem | `template.ts` (`LINK_PLACEHOLDER`) |
| `packages/db` | Prisma schema + client | `prisma/schema.prisma` |

Cada app carrega o `.env` da raiz num `src/env.ts` importado **primeiro** (imports ESM rodam antes do corpo do módulo).

## Fluxo de um post

1. **Preview** — `POST /api/preview` identifica a loja pela URL, enriquece e faz upsert do produto (dedup por `tenantId + store + storeProductId`).
2. **Conferência** — admin corrige título/preço/cupom/imagem no painel (`PATCH /api/products/:id`, desconto recalculado).
3. **Agendamento** — `POST /api/posts`:
   - recusa produto sem preço e post duplicado pendente (SCHEDULED/POSTING) do mesmo produto;
   - gera `subId` aleatório (`p` + 12 hex) e o link de afiliado;
   - mensagem usa o marcador `{link}`, trocado **na mesma transação** que cria o post por
     `PUBLIC_BASE_URL/c/{postId}` (ou link direto se `PUBLIC_BASE_URL` vazio).
4. **Scheduler** — a cada 60s, se não houver post em POSTING, estiver abaixo dos tetos e passado o intervalo mínimo,
   faz claim atômico do SCHEDULED mais antigo e enfileira (`jobId = postId`, 3 tentativas).
5. **Envio** — foto + legenda se houver imagem e a legenda couber (1024); senão só texto. Grava `telegramMessageId`.
6. **Clique** — `/c/{postId}` registra clique (só post POSTED, ignora robôs de preview) e redireciona 302.

## Status

**Produto:** `NEW` (coletado) → `READY` (aprovado) | `FILTERED` (descartado no painel) | `EXPIRED` (já postado).

**Post:**

```text
SCHEDULED ──scheduler──► POSTING ──ok──► POSTED
    │                       │
    │ cancelar              ├─ 3 falhas ──────────► FAILED ──reenviar──► SCHEDULED
    ▼                       └─ travado >15min ────► FAILED (lastError avisa p/ conferir o canal)
CANCELED ──reenviar──► SCHEDULED
```

`lastError` guarda o motivo da última falha e aparece no painel.

## Anti-spam

- Teto `POSTS_PER_HOUR` e, opcional, `POSTS_PER_DAY` (janela móvel de 24h; `0` = sem teto — o Telegram não limita volume diário).
- Janela de silêncio `QUIET_HOURS` (ex.: `23-7`, horário de Brasília): o scheduler não posta; o "postar agora" do painel ignora.
- Intervalo mínimo entre posts = 60 min ÷ `POSTS_PER_HOUR` (3/h → um a cada 20 min).
- Um envio por vez + pausa de 1,2–2s antes de cada envio.

## Multi-tenant (fase 4)

`Product.tenantId` já existe; o MVP usa `'default'` (nunca null — NULL em índice único do Postgres quebra o dedup).
No SaaS: credenciais e providers por tenant, mesma pipeline.

## Filas (BullMQ)

| Fila | Quem põe | Quem consome | Para quê |
|------|----------|--------------|----------|
| `publish` | scheduler, "postar agora", linker (com `delay`) | worker `worker.ts` | enviar um post (confere o preço antes, D23) |
| `curate` | API (lote, descoberta, fonte "rodar agora"), `sources-tick` a cada 2 min | worker `curation.ts` | buscar produtos e criar sugestões |
| `mirror` | worker `mirror.ts` (mensagem com `meli.la`/`amzn.to`) e worker `coupons.ts`/API (teste de cupom) | linker | converter o link ou testar o cupom do ML e agendar |
| `coupon-post` | worker `coupons.ts`, linker (cupom ML válido) | worker `coupons.ts` | publicar cupons no canal de cupons, espaçados |

## Espelhamento (resumo)

`grupo observado → [worker] ouvinte (conta dedicada do Telegram) → fila mirror → [linker] navegador logado no ML
(card do produto + gerador de links) → Post POSTING + publish com atraso 0–150 s → canal`.
Falha → alerta no canal (painel). Detalhes, seletores e testes: [[10 - Espelhamento Mercado Livre]].

## Serviços no Docker

`postgres`, `redis`, `db-init` (db push), `api`, `web`, `worker`, `bot` usam a imagem `cupons-app:dev` (alvo `app` do
Dockerfile). O `linker` usa `cupons-linker:dev` (alvo `linker` = mesma base + Chromium do Playwright), `shm_size: 1gb`
e o volume `./data/linker` (sessão do ML e prints de falha, fora do git).

