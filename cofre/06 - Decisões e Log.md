# 06 — Decisões e Log

## Decisões

| # | Decisão | Escolha | Por quê |
|---|---------|---------|---------|
| D1 | Linguagem | **TypeScript/Node** | Baileys/Next/BullMQ são do ecossistema; um idioma só |
| D2 | Canal inicial | **Telegram** (canal, API oficial) | Sem risco de ban; WhatsApp só na fase 3 |
| D3 | Lojas MVP | Shopee, AliExpress, Amazon | Credenciais acessíveis, melhor custo-benefício |
| D4 | IA no texto | **Sem LLM no MVP** (templates) | Custo zero e determinístico; IA pluga depois no mesmo template |
| D5 | Interface | **Painel admin + site público** | Painel valida a operação; site vira vitrine/landing |
| D6 | Fila | **BullMQ + Redis** | Ecossistema Node; desacopla coleta de envio |
| D7 | Filtro | **Regras simples, sem IA** | 95% dos casos resolvem com regras |
| D8 | Link de afiliado | **Gerado no agendamento** (não na coleta) | Links expiram e precisam de subID por post |
| D9 | Dados | **products / posts / clicks separados** | Mesmo produto pode ir a N posts/canais |
| D10 | Link na mensagem | Marcador `{link}` → `PUBLIC_BASE_URL/c/{postId}` (ou link direto sem domínio) | Link rastreado depende do id do post |
| D11 | Ritmo | Intervalo mínimo = 60 min ÷ `POSTS_PER_HOUR` | Espalha os posts em vez de rajada no início da hora |
| D12 | Fronteira da API | Só o servidor do Next chama a API admin; navegador nunca vê a `ADMIN_API_KEY` | Uma chave vazada não pode vir do front |
| D13 | Cofre | Versionado no git, **exceto** a nota 03 | Contexto do projeto precisa viajar com o código |
| D14 | Identidade visual | **Verdes da logo** (`#0b2219` + `#22a06e`), tema escuro e claro com botão em todas as páginas; logo oficial em `assets/brand/`; ícones Lucide (`react-icons/lu`), sem emoji na interface | Marca CortaPreço; emoji só dentro da mensagem do Telegram |
| D15 | IA nos posts | Fluxo (não agente): regras filtram → `Curator` escolhe e escreve chamada → **aprovação humana** → scheduler. Provedor trocável; padrão `rules` | Custo previsível, auditável; provedor de IA ainda em avaliação de preço |
| D16 | Ritmo no Telegram | **Sem teto diário** (`POSTS_PER_DAY=0`), 3/h espaçados e **silêncio 23h–7h** (`QUIET_HOURS`) | Telegram só limita velocidade; o que incomoda o público é rajada e madrugada. Teto diário volta para WhatsApp |
| D17 | Subida local | **`docker compose up -d` sobe o stack inteiro em modo dev**; `db-init` roda `db:push` automaticamente; bot desativado sem `TELEGRAM_BOT_TOKEN`; override monta `apps/` + `packages/` p/ hot reload | Réplica do README num comando só, com rebuild necessário apenas quando `package.json`/schema mudarem |
| D18 | Multicanal | Tabela `Channel` com ritmo **por canal**; post aprovado vira um envio por canal ativo (subID próprio, formato da plataforma). WhatsApp via **Evolution API** com padrões conservadores: 2/h, teto 15/dia, silêncio 22h–8h, intervalo ±35%, aquecimento de 14 dias | API oficial não serve (grupo máx. 8 pessoas, sem canais); não oficial = risco de ban, então ritmo humano |

## Log

- **2026-09-23** — arquitetura decidida. Plano: MVP manual → coleta automática → automação completa → SaaS.
- **2026-09-23** — scaffold (monorepo, providers, painel, bot).
- **2026-09-23** — primeiros 3 posts reais (Amazon) no canal. 2 saíram com o texto do placeholder no lugar do link (bug corrigido a seguir).
- **2026-09-23** — revisão: link rastreado na mensagem (D10), rotas `/api/*` do Next sem auth fechadas,
  subID por post, worker marcava FAILED já na 1ª tentativa, scheduler em rajada (D11).
- **2026-09-23** — hardening para lançamento + painel novo (D12): proxy com allowlist, CSRF, rate limit,
  CSP/HSTS, validação de schema; editar dados antes de agendar, preview estilo Telegram, cancelar/reenviar.
  Bug achado: `.env` era carregado **depois** das configs (ordem dos imports ESM).
- **2026-09-23** — cofre passa a ser versionado (D13). Commits sem coautoria do assistente.
- **2026-09-23** — identidade visual (D14): logo oficial, tema escuro verde, ícones Lucide no lugar de emojis.
  Variantes da logo geradas por `python3 assets/brand/build.py` (recorte, fundo transparente, versão para fundo escuro, favicon, imagem de compartilhamento).
- **2026-09-23** — botão de tema claro/escuro em todas as páginas; escolha salva no navegador, padrão segue o sistema.
- **2026-09-23** — extrator da Amazon: preço perdia os centavos (`29.99` → 29), entidades `&#34;` no título; corrigido.
  Preço antigo ("De:") segue sem extração. Após ~45 consultas seguidas a Amazon passou a devolver tela anti-robô:
  scrape não escala para automação — caminho é a Creators API (10 vendas/30d). 10 mais vendidos agendados como
  "MAIS VENDIDO NA AMAZON" (sem desconto, não chamados de oferta). Objetivo futuro: IA responsável pelos posts (fase 3).
- **2026-09-23** — subida local automatizada (D17, colega; numerada D15 no commit original): `docker compose up -d` sobe Postgres, Redis, API, Web, Worker e Bot.
  `db-init` executa `db:push`, e um override de dev monta `apps/`/`packages/` para hot reload com tsx watch e next dev.

- **2026-09-23** — curadoria com IA (D15): aba Sugestões, lote de links, coletores Shopee/AliExpress, histórico de preço.
  Amazon automática descartada até a Creators API (Condições de Uso proíbem robôs; risco à conta de associado).
  Botão "Postar agora" (pula fila/intervalo, respeita teto diário). Corrigido: job de reenvio ignorado pelo BullMQ
  por reaproveitar o id do job com falha; upsert zerava preço quando a loja bloqueava.

- **2026-09-24** — fila parou: os 10 posts de 23/09 (14h40–17h40) lotaram o teto de 10 em janela móvel de 24h.
  Teto diário virou opcional e foi desligado; entrou a janela de silêncio 23h–7h (D16). Fila retomou às 13h22.

- **2026-09-24** — merge do Docker Compose do colega (numerado D17 aqui). Compose passou a ler o `.env` inteiro.
  Preparo do WhatsApp (D18): canais com ritmo próprio, conversor HTML→WhatsApp, envio pela Evolution API
  testado contra servidor falso. Falta: subir a Evolution, conectar o chip e preencher `WHATSAPP_*`/`EVOLUTION_*`.

- **2026-09-24** — AliExpress ligado: busca, leitura e link funcionando. `hotproduct.query` sem permissão → descoberta
  por palavra-chave girando categorias (`ALIEXPRESS_KEYWORDS`). Corrigidos: espaçamento contra `ApiCallLimit`,
  erro claro para item não promovível no Brasil, links curtos do app. Primeira busca: 30 avaliados → 5 sugestões.
  Pontuação por regras recalibrada (antes saturava em 100). Títulos do AliExpress vêm com tradução ruim.

## Regras de ouro

1. **Números nunca vêm de IA** — texto pode ser gerado; preço/desconto vêm do banco.
2. **Ritmo, não rajada** — Telegram: espaçamento + silêncio de madrugada. WhatsApp (fase 3): teto diário rígido, é o que evita ban.
3. **subID único por post** — é a chave para atribuir venda a post.
4. **`.env` nunca versionado**; segredos só nele (status em [[03 - Credenciais]]).
5. **Todo post se identifica como anúncio** (CONAR).
