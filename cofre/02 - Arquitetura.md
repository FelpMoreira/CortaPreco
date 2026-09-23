# 02 — Arquitetura

Pipeline em etapas, desacoplado por fila (BullMQ + Redis).

```text
        APIs / Página das lojas
                  │
                  ▼
   [api] preview/enrich  (handoff manual no MVP)
                  │
                  ▼
         Banco de Dados (Postgres/Prisma)
   products(NEW) → READY/FILTERED/EXPIRED
                  │
                  ▼
   [api] schedulePost → gera link afiliado + subID + mensagem → posts(SCHEDULED)
                  │
                  ▼
   [worker] scheduler (cron 1min + tetos/dia/hora) → fila publish
                  │
                  ▼
   [worker] publish → envia Telegram → posts(POSTED)
                  │
                  ▼
   [api] /c/{postId} → redirector rastreia clicks
                  │
                  ▼
   (fase 2) import conversions das redes por subID
```

## Serviços

| App | Papel |
|-----|-------|
| `apps/api` | Fastify: preview/enrich, produtos, posts, cliques, catálogo público, auth admin |
| `apps/worker` | BullMQ: scheduler (cron) + worker de publish (envio Telegram) |
| `apps/bot` | grammY: comandos admin (/stats, /whoami) |
| `apps/web` | Next.js: painel admin (/admin) + site público (catálogo) |
| `packages/affiliates` | Providers: Shopee, AliExpress, Amazon (interface única) |
| `packages/shared` | Tipos + renderer de template de mensagem |
| `packages/db` | Prisma schema + client |

## Fluxo de status

**Produto:** `NEW` (coletado) → `READY` (aprovou filtro — manual no MVP) | `FILTERED` | `EXPIRED`.
`POSTING` é estado transitório **do post** (scheduler enfileirou).

**Post:** `SCHEDULED` → `POSTING` → `POSTED` | `FAILED`.

## Deduplicação

- Produto: `@@unique([tenantId, store, storeProductId])` → upsert no preview.
- Post: scheduler só pega `SCHEDULED`; agendamento não cria duplicado pendente.

## Anti-spam

- Teto por hora e por dia (`POSTS_PER_HOUR`, `POSTS_PER_DAY`) verificados no scheduler.
- Pacing de ~1,2–2s entre envios no worker.
- WhatsApp (fase 3) exige identação ainda maior (aquecimento de número).

## Multi-tenant (fase 4)

`Product.tenantId` nullable já existe no schema — credenciais por tenant no SaaS,
mesma automação, providers instanciados por tenant.