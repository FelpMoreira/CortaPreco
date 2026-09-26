# 04 — Fases e Roadmap

## Fase 0 — Credenciais e setup
- [x] `docker compose up -d` (Postgres + Redis)
- [x] `npm run db:generate && npm run db:push`
- [x] Canal do Telegram criado + bot admin
- [x] Amazon validada (3 posts reais publicados)
- [ ] Trocar segredos fracos (`ADMIN_API_KEY`, `ADMIN_PASSWORD`, `JWT_SECRET`) — ver [[03 - Credenciais]]
- [ ] Credenciais Shopee e validar no painel
- [x] Credenciais AliExpress e validar (link, leitura e descoberta funcionando em 24/09)

## Fase 1 — MVP manual
- [x] Scaffold monorepo (api, worker, bot, web, packages)
- [x] Painel: colar URL → conferir/editar dados → preview estilo Telegram → agendar
- [x] Scheduler (tetos + intervalo mínimo) + envio no Telegram (foto + legenda)
- [x] Redirector de cliques `/c/{postId}` (ignora robôs de preview)
- [x] Catálogo público no site
- [x] Cancelar/reenviar posts, descartar produtos, motivo de falha visível
- [x] Segurança: auth painel/API, CSRF, rate limit, CSP — ver [[08 - Segurança]]
- [ ] Domínio + HTTPS + `PUBLIC_BASE_URL` (sem isso não há contagem de cliques) — ver [[07 - Operação#Deploy]]
- [ ] 1 oferta real de cada loja com dados corretos

## Débitos técnicos
- [ ] Testes (vitest): template, `parseBRL`, parse de URL/ID dos providers, assinaturas Shopee/AliExpress, `telegramToSafeHtml`
- [ ] `next build` de produção validado (não roda junto com o `next dev`)
- [ ] Rate limit do login é em memória: se tiver mais de uma instância do web, mover para Redis
- [ ] Logs estruturados do worker/bot (hoje `console`) + alerta quando post vira FAILED
- [ ] Backup automático do Postgres
- [x] Versionar o cofre (só a nota 03 fica fora do git)

## Fase 2 — Coleta automática
- [ ] `packages/collectors`: `Collector.collect(): Promise<Product[]>` por loja
- [ ] Cron + fila `collect` (5–15 min por loja)
- [ ] **Filtro de regras** (sem IA): desconto mínimo, nota, vendas, categorias on/off, preço mínimo,
      anti-desconto falso (histórico de preço), cooldown por produto
- [ ] Importar **conversões** por `subId` (Shopee `conversionReport`, AliExpress orders, relatório Amazon)
- [ ] Métricas: CTR, comissão por loja/categoria/horário (alimenta "quando postar")

## Fase 3 — Automação completa
- [x] Curadoria com aprovação: lote de links → regras/IA escolhem e escrevem a chamada → aba Sugestões (aprovar/rejeitar)
- [x] Interface `Curator` trocável: `rules` (sem custo) e `claude` (liga com `LLM_PROVIDER=claude` + chave)
- [x] Coletores Shopee (`productOfferV2`) e AliExpress (`hotproduct.query`) prontos — **validar com credencial real**
- [x] Histórico de preço (anti-desconto-falso) e cooldown de repost
- [x] Fontes de ofertas por canal: APIs oficiais (termos/filtros por nicho) e outros grupos do Telegram (D21)
- [ ] Conectar a conta dedicada do Telegram e validar leitura de um grupo real
- [x] Espelhamento de grupo do Telegram com conversão de links do Mercado Livre (D24, [[10 - Espelhamento Mercado Livre]])
- [x] Espelhamento: `npm run ml:login` na conta de afiliado e validar o gerador de links logado (1ª conversão real, 2026-09-26)
- [ ] Validar a identidade na conta de afiliado do ML (prazo ~2026-12-31, senão a conta é suspensa)
- [x] Espelhamento ligado em grupos reais (2026-09-26)
- [ ] Espelhamento: acompanhar alertas/histórico na 1ª semana
- [x] Espelhamento também para links da Amazon (troca de tag, D25)
- [x] Espelhamento lê o cupom da mensagem e espaça posts de rajadas (2026-09-26)
- [x] Grupo de cupons: coleta, teste ML, cupom junto dos posts, canal de cupons (D26, [[11 - Grupo de Cupons]])
- [ ] Ligar o grupo de cupons real e criar o canal só de cupons
- [ ] Coletar cupons direto da página "Todos os cupons" do ML (~2.800) — ideia
- [ ] Escolher provedor de IA (comparar custo) e ligar
- [ ] Aprovação pelo privado do bot no Telegram (botões)
- [x] Modo automático (sem aprovação) por fonte, com nota mínima (D22)
- [ ] Amazon automática só via Creators API (scraping viola as Condições de Uso)
- [x] Multicanal: um post aprovado sai em cada canal ativo, cada um com seu ritmo (D18)
- [x] Envio WhatsApp pela Evolution API + formatação própria + aquecimento/jitter/silêncio
- [ ] WhatsApp de verdade: subir Evolution API, conectar chip dedicado, preencher `.env`, validar envio
- [ ] Opt-out fácil no WhatsApp e respostas a quem chama (reduz risco de ban)
- [ ] Alertas por interesse (`/add palavra`) em DM do Telegram
- [ ] Fila de curadoria (aprovar em lote o que a coleta trouxe)

## Fase 4 — SaaS multi-tenant
- [ ] Auth de clientes + credenciais por tenant
- [ ] Mesmo pipeline, providers por tenant
- [ ] Billing/webhooks

## Métricas de validação do MVP
- Postou ofertas reais das 3 lojas com preço e link corretos?
- Clique no canal incrementa a contagem no painel?
- Scheduler respeita o teto diário sem travar?
