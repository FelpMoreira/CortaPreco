# CUPONS · pipeline de ofertas com links de afiliado

Pipeline automatizado: coleta ofertas → enriquece (preço/desconto/imagem) → gera link de afiliado → gera mensagem → agenda → publica no Telegram (futuro: WhatsApp) → rastreia cliques e conversões.

## Stack

- Node 20+ / TypeScript estrito · monorepo npm workspaces
- **API**: Fastify · **Web**: Next.js · **Fila**: BullMQ (Redis) · **DB**: Prisma (Postgres)
- **Bot Telegram**: grammY (API oficial)

## Estrutura

```
apps/
  api/      Fastify — preview/enriquecimento de URL, produtos, posts, cliques, auth admin
  web/      Next.js — painel admin (/admin) + site público (catálogo + landing)
  worker/   BullMQ — workers (collect, publish) + cron do scheduler
  bot/      grammY — publica posts agendados e comandos admin (/stats etc.)
packages/
  affiliates/  Providers de afiliado: Shopee | AliExpress | Amazon
  db/          Prisma schema + client
  shared/      Tipos compartilhados + renderer de templates de mensagem
cofre/      Vault Obsidian com todo o contexto do projeto
```

## Quickstart — tudo com um comando

```bash
cp .env.example .env          # preencher credenciais (segredos ficam fora do Git)
docker compose up -d          # build + sobe Postgres, Redis, API, Web, Worker e Bot
docker compose ps             # confira se todos estão Up
```

- Painel/site: <http://localhost:3000> (`/admin`)
- API: <http://localhost:3001> (`/api/health`)
- O job `db-init` roda `npm run db:push` automaticamente na primeira subida.
- Sem `TELEGRAM_BOT_TOKEN`, o bot encerra desativado (sem loop de restart).
- O override de dev monta `apps/` e `packages/`: tsx watch / next dev recarregam
  sozinhos quando o código muda. Após mudanças em `package.json` ou no schema
  Prisma, rode `docker compose up -d --build`.

### Alternativa: infra no Docker + apps rodando locais

```bash
docker compose up -d postgres redis   # só Postgres + Redis (portas 5434/6379)
npm ci
npm run db:generate           # gera client Prisma
npm run db:push               # cria as tabelas
npm run dev:api               # API na porta 3001
npm run dev:worker            # workers BullMQ
npm run dev:bot               # bot do Telegram
npm run dev:web               # painel/site na porta 3000
```

## Fases

1. **MVP (atual)**: cadastro manual de oferta no painel (colar URL → preview → aprovar) + post no Telegram + rastreio de cliques + catálogo público. Sem LLM (templates determinísticos).
2. Coleta automática por cron e filtro de regras.
3. IA no copy, WhatsApp (Evolution API), importação de conversões por subID.
4. SaaS multi-tenant.

Detalhes e decisões em [`cofre/`](./cofre/).