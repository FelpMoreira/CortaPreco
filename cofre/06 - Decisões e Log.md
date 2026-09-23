# 06 — Decisões e Log

## Decisões abertas (votadas)

| # | Decisão | Opção escolhida | Justificativa |
|---|---------|-----------------|---------------|
| D1 | Linguagem | **TypeScript/Node** | Baileys/Next/BullMQ são do ecossistema, um idioma só |
| D2 | Canal inicial | **Telegram** (canal, API oficial) | Sem risco de ban; WhatsApp só na fase 3 |
| D3 | Lojas MVP | Shopee, AliExpress, Amazon | Tem credenciais / melhor custo-benefício |
| D4 | IA no copy | **Sem LLM no MVP** (templates) | Custo zero e determinístico; IA pluga depois no mesmo renderer |
| D5 | Dashboard | **Painel admin + site público** | Painel valida operação; site público completa a landing |
| D6 | Fila | **BullMQ + Redis** | Ecossistema Node; desacopla coletores de IA |
| D7 | Filtro | **Regras simples, sem IA** | 95% dos casos resolvem com regras (concordo com o desenho do J.) |
| D8 | Link de afiliado | **Gerado no agendamento** (não no coletor) | Links expiram e precisam de subID por campanha |
| D9 | Estrutura de dados | **products / posts / clicks separados** | Mesmo produto pode ir a N canais/posts |

## Log

- **2026-09-23** — decidi arquitetura com o Théo. Plano: MVP manual → coleta automática → automação completa → SaaS.
- **2026-09-23** — scaffold iniciado (monorepo + provs + painel + bot). Próximo passo listado em [[04 - Fases e Roadmap]].

- **2026-09-23** — revisão (Claude Code). Corrigido: posts saíam com placeholder no lugar do link
  (override do painel sempre vencia); rotas `/api/*` do Next estavam sem auth (qualquer um agendava post);
  subID era por produto, não por post; worker marcava FAILED na 1ª tentativa; scheduler disparava em rajada.
  Decisão **D10**: mensagem usa marcador `{link}`, trocado no agendamento por `PUBLIC_BASE_URL/c/{postId}`
  (ou link direto se `PUBLIC_BASE_URL` vazio). Decisão **D11**: intervalo mínimo entre posts = 60min / `POSTS_PER_HOUR`.
- **2026-09-23** — hardening para lançamento + painel novo. Proxy único `/api/admin/*` com allowlist;
  CSRF por Origin; login com rate limit; CSP/HSTS; API com validação de schema, rate limit e sem CORS;
  `/c/` ignora robôs de preview (TelegramBot etc.). Painel: editar preço/título/cupom antes de agendar,
  preview estilo Telegram, cancelar/reenviar post, `lastError` visível. Decisão **D12**: a API só é
  chamada pelo servidor do Next; o navegador nunca vê a `ADMIN_API_KEY`.

## Regras de ouro

1. **Números nunca vêm de IA** — LLM escreve só copy; preço/desconto vêm do banco.
2. **Teto diário de posts** — anti-spam é o que mantém o número vivo (telegram e, depois, whatsapp).
3. **subID único por post** — é a chave pra atribuir conversão por campanha.
4. **`.env` nunca versionado**; segredos só na [[03 - Credenciais]].