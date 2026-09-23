# 04 — Fases e Roadmap

## Fase 0 — Credenciais e setup
- [ ] `.env` preenchido (ver [[03 - Credenciais]])
- [ ] `docker compose up -d` (Postgres + Redis)
- [ ] `npm run db:generate && npm run db:push`
- [ ] Canal do Telegram criado + bot admin
- [ ] Validar providers Shopee/AliExpress/Amazon no painel

## Fase 1 — MVP (manual) ✅ escopo
- [x] Scaffold monorepo (api, worker, bot, web, packages)
- [ ] Painel: colar URL → preview → agendar post
- [ ] Scheduler + publish no Telegram
- [ ] Redirector de cliques
- [ ] Catálogo público no site
- [ ] Validar com uma oferta real de cada loja

### Débitos técnicos (revisão 2026-09-23)
- [ ] Expor a API num domínio público (ou túnel `cloudflared`) e preencher `PUBLIC_BASE_URL` → cliques rastreados
- [x] Editar preço/título/cupom no painel antes de agendar (enrich falha com frequência)
- [x] Ações no painel: reagendar/cancelar post FAILED, marcar produto FILTERED
- [ ] Testes (vitest): template, `parseBRL`, parse de URL/ID dos providers, assinaturas Shopee/AliExpress
- [x] Rate limit no login do painel e no `/c/:id`
- [x] Versionar o cofre (só a nota 03 fica fora do git)

## Fase 2 — Coleta automática
- [ ] `packages/collectors` com `Collector.collect(): Promise<Product[]>` por loja
- [ ] Cron + fila `collect` (5–15 min por loja)
- [ ] **Filtro de regras** (sem IA): desconto > %, nota, vendas, categoria on/off,
      preço mínimo, anti-desconto falso (histórico de preço), cooldown por produto
- [ ] Importação de **conversões** por subID (Shopee `conversionReport`, AliExpress orders, Amazon report)
- [ ] Métricas: CTR, comissão por loja/categoria/horário (alimenta "quando postar")

## Fase 3 — Automação completa
- [ ] IA no copy (mesmo renderer de template, LLM só escreve texto; números vêm do banco)
- [ ] WhatsApp via **Evolution API** (chip separado, aquecimento, pacing, opt-out)
- [ ] Assinatura por interesse (`/add palavra`) — DM do Telegram
- [ ] Board de aprovação (fila de curadoria)

## Fase 4 — SaaS multi-tenant
- [ ] Auth de clientes + credenciais por tenant
- [ ] Mesmo pipeline, providers por tenant
- [ ] Billing/webhooks

## Métricas de validação (MVP)
- Conseguiu postar 3 ofertas reais (1 por loja) com dados corretos?
- Clico no redirector? Contagem de cliques incrementa?
- Scheduler não trava com teto diário?