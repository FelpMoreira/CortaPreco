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
| D19 | Acesso ao painel | Login **por usuário** com perfis **DEV** e **GERENTE**, sessões no servidor revogáveis, bloqueio por tentativas, auditoria (arquitetura do credluz adaptada) | Mais de uma pessoa opera o painel; saber quem aprovou/postou; senha única não escala |
| D20 | Grupos por categoria | **Um bot só** para todos os grupos; canais cadastrados no painel com as categorias que recebem (nenhuma = geral). Produto ganha categoria automática por palavra-chave, ajustável no painel | Limites do Telegram são por chat; um token só; `.env` vira só semente do 1º canal |
| D21 | Fontes por canal | Cada canal escolhe as fontes: **APIs oficiais** (lojas + termos prontos por categoria, editáveis + filtros) ou **outros grupos do Telegram** (conta de usuário dedicada, só leitura). Sugestão nasce com destino; o geral só recebe nicho com nota ≥ limiar (80). **1 bot posta tudo** | Grupo de nicho precisa de garimpo de nicho; bot não lê canais de terceiros; organização vem dos canais/filas, não do nº de bots |
| D22 | Modo automático | **Por fonte**: "Postar automaticamente" + nota mínima (padrão 70). A API aprova a cada 1 min o que passar; freio de 8 posts na fila por canal e sugestão com mais de 12h não vai sozinha | Tira o gargalo da aprovação sem abrir mão do controle: dá para ligar só na fonte em que se confia; ritmo/silêncio seguem no scheduler |
| D23 | Fila por qualidade | A fila sai pela **nota** (agendado à mão = 100, vai primeiro); post automático que passa 24h sem sair expira. **Preço conferido na loja antes de postar** (AliExpress via API): subiu > 2% ou sumiu → cancela; mudou pouco/caiu → sai com o valor de agora. Sem limite de tamanho de fila | O risco não é fila grande, é oferta velha; conferir na hora resolve na raiz e deixa a fila crescer à vontade |
| D24 | Espelhamento de grupo | Fonte `MIRROR` por canal: conta dedicada do Telegram **ouve** o grupo; 1º link `meli.la` de cada mensagem vai para o **linker** (serviço novo com navegador logado na conta de afiliado do ML) que pega o produto do card em destaque, gera o nosso link no gerador e posta com atraso 0–150 s da mensagem original. Falha → alerta no canal. Só Telegram, sem fila/ritmo, respeita silêncio, ignora repetido em 24h | Pedido do usuário; o ML não tem API de link de afiliado para isso, então é navegador. Dados do card (não da página do produto, que cai em verificação anti-robô sem login). Serviço separado para o Chromium não pesar/derrubar o worker |
| D25 | Espelhamento Amazon | Tipo de link `AMAZON` no mesmo fluxo: resolvedor seguro → `/dp/ASIN` → `?tag=AMAZON_PARTNER_TAG` (troca a tag de quem postou), dados pela leitura da página com teto de 30/h. Link sem produto (Prime, lista) e teto → **ignorados sem alerta** (vale também para vitrine do ML) | Pedido do usuário ("só trocar a tag"); não precisa navegador. Alerta vermelho só para falha de verdade |
| D26 | Grupo de cupons | Fonte `COUPONS` por canal: o mesmo ouvinte lê cupons (ML, Amazon, Shopee, AliExpress) e guarda em `Coupon`; ML é testado na conta de afiliado ("Inserir código": VALID/RESTRICTED/INVALID + condições de "Meus cupons"); outras lojas valem 24 h. Cupom **geral** e válido vai junto dos posts da loja (mínimo ≤ preço, maior desconto); opcional publicar os cupons no canal, espaçados, sem os links do grupo | Pedido do dono; teste no ML sem comprar nada (combinado que o cupom fica na conta); só cupom geral junto do produto para não prometer desconto que não vale |

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

- **2026-09-24** — descoberta do AliExpress passa a usar as **promoções em destaque** (curadoria deles, equivalente aos
  "Hot Deals" do painel): 1 promoção relevante (BR/eventos) + 1 palavra-chave por rodada. "Ship From BR" tem 48 mil itens
  com envio nacional. Stack passou a rodar inteira no Docker.

- **2026-09-24** — painel novo (inspirado no admin do credluz, não cópia): barra lateral recolhível, Visão geral com
  cards, **"próximo post às HH:MM · motivo"** por canal e previsão da fila. Regras de ritmo movidas para
  `@cupons/db/pacing`: scheduler e painel usam a mesma conta. Cards da vitrine com tamanho uniforme.
  Dump do banco em `backups/` (fora do git) para o colega.

- **2026-09-24** — login por usuário (D19): DEV/GERENTE, scrypt, sessões com hash no banco, bloqueio 5×/15 min,
  troca obrigatória de senha provisória, auditoria, páginas Usuários/Auditoria/Minha conta. Testado ponta a ponta
  com usuário descartável (removido). Primeiro DEV criado pelo script `admin:create`. `JWT_SECRET` deixou de ser usado.

- **2026-09-24** — grupos por categoria (D20): 10 categorias padrão, classificador por palavra-chave (77 produtos
  classificados), direcionamento geral + categoria, página Canais (DEV) que confere no Telegram se o bot pode
  postar e manda mensagem de teste. Canais agora são geridos pelo painel.

- **2026-09-24** — fontes por canal (D21). Etapa 1 (APIs) testada com AliExpress real: 18 vistos → 13 do nicho →
  5 sugestões "Para: Games". Filtro de nicho, limiar do geral (85 → nicho+geral; 72 → só nicho). Etapa 2 (Telegram):
  leitor GramJS, extração/limpeza de links (11 casos ok), login interativo; falta conta dedicada p/ teste real.
  Corrigido: edição de canal mandava campos extras (a API recusaria).

- **2026-09-25** — revisão de segurança (3 agentes: revisão, checagem técnica, lacunas de lançamento). Corrigido:
  **auth da API burlável** com caminho codificado (`/%61pi/users` passava sem login; guard agora decide pela rota casada,
  `apps/api/src/routeGuard.ts`); portas de Postgres/Redis/API só em `127.0.0.1`; bloqueio de login atômico
  (20 tentativas paralelas → só 5 senhas conferidas) + limite por e-mail no painel + IP pelo `TRUST_PROXY_HOPS`;
  SSRF nos links de outros grupos (cada salto conferido, só encurtador/loja, máx. 5 saltos, 30 links/rodada);
  post repetido nos gerais (intervalo de repost vale para eles) e aprovação dupla (reserva atômica); trocar o grupo
  de uma fonte zera a leitura; grupo por ID numérico carrega os diálogos; link que falhou na loja volta a ser tentado
  (até 3×). Painel com paleta neutra (verde só em ação principal/item ativo/sucesso).

- **2026-09-25** — modo automático por fonte (D22). Testado com canal falso: fonte desativada → nada; ativa → nota 75
  aprovada só no canal de nicho (geral exige 80), nota 60 ficou para decisão manual. Auditoria `suggestion.auto_approve`.
- **2026-09-25** — fonte automática **busca quando a fila do canal acaba** (< 2 posts + sugestões prontas), não por relógio;
  o intervalo virou "mínimo entre buscas" (15 min ao ligar o automático). Testado: fila com 3 → não buscou em 22 min;
  vazia → buscou em < 2 min. Página **Filas** (uma por grupo: horários previstos, postar agora/tirar da fila, fontes
  de reposição) e filtro por grupo em Posts.
- **2026-09-25** — fila por nota + conferência de preço antes de postar (D23); limites de 8 na fila removidos.
  Testado com a API real: mesmo preço → posta; subiu 20% → cancela; caiu → posta com o preço novo; item inexistente → cancela.
  API fora do ar: post com < 3h sai assim mesmo; mais velho volta para a fila e desiste na 3ª falha.
- **2026-09-25** — espelhamento de grupo com links do Mercado Livre (D24, nota [[10 - Espelhamento Mercado Livre]]).
  Investigado nas páginas reais: `meli.la` → `/social/<afiliado>` com card em destaque; sem login o "Ir para produto"
  tem `href`; há `meli.la` de vitrine (sem produto); página do produto anônima cai em `/gz/account-verification`;
  gerador sem sessão cai em `/login/identification` (detecção corrigida durante o teste). Pegadinha: `tsx` injeta
  `__name` em `page.evaluate` (contorno `NAME_SHIM`). Serviço `linker` (Playwright 1.63, Chromium no alvo `linker` do
  Dockerfile). Loja `MERCADOLIVRE` nova ("ACHADO NO MERCADO LIVRE"). Testes: 9 produtos reais, filtro de links (8),
  login (6), falha ponta a ponta (alerta no painel), post com atraso (saiu em 20:09:50.075 para 20:09:50.002), regras da
  API. Falta: conta dedicada do Telegram e `ml:login` para o primeiro teste real.
- **2026-09-26** — `ml:login` deu "limite de tentativas" no ML: a janela era controlada pelo Playwright (detectável).
  Refeito: abre o Google Chrome comum (perfil `data/linker/chrome-profile`, porta de depuração local), não toca na
  página durante o login e só copia cookies + User-Agent quando o gerador aparece. Linker passa a usar esse UA.
  Detalhes em [[10 - Espelhamento Mercado Livre#Incidente: "limite de tentativas" no login (2026-09-26)]].
- **2026-09-26** — conta do Telegram conectada; `ml:login` ok. 1ª conversão real: o "Gerar" só habilita **digitando**
  a URL (colar deixa desabilitado) — corrigido. `meli.la/12hnEiy` → `meli.la/2zFYfUp` com a nossa etiqueta
  (`<nossa etiqueta>`). ML pede validação de identidade da conta de afiliado em até 96 dias.
- **2026-09-26** — espelhamento também para **Amazon** (D25): testado com 5 `amzn.to` reais e ponta a ponta com canal
  falso; tag do link = `AMAZON_PARTNER_TAG`. Resolvedor seguro de links movido para `packages/affiliates/src/links.ts`
  (worker e linker usam o mesmo). Conversores do linker separados por tipo (`conversion.ts`, `amazon.ts`).
- **2026-09-26** — AliExpress "100% automático": a busca já funcionava (aprovações em lotes de 5, fila reposta, madrugada
  respeitada), mas as fontes estavam com **intervalo mínimo de 120 min** → fila vazia ~45 min entre buscas. Ajustado para
  **15 min** nas duas fontes automáticas. Filtro de nicho passou a comparar **palavra a palavra com sinônimos**
  (gamer = jogos/gaming/e-sports; headset = fone; mouse = rato; controle = controlador/joystick): em 39 produtos reais dos
  termos de Games, 26 → 35 aceitos, e continuam recusados mouse/fone comuns, "jogo de panelas", "controle remoto de TV".
- **2026-09-26** — espelhamento lê o **cupom** da mensagem (código em monoespaçado ou "Cupom: X"; cupom de página
  "20% OFF") e põe no nosso post; só o código, nunca o texto de quem postou. 16 casos testados.
- **2026-09-26** — espelhamento em rajada: o grupo mandou 6 ofertas de uma vez e saíram 6 posts em 1min40s. Agora há
  **intervalo mínimo entre posts** (padrão 3 min + variação) contando o último post publicado ou reservado no canal;
  `Post.sendAt` marca o horário reservado (a guarda de "envio travado" e o ritmo da fila respeitam). Oferta que só
  sairia 45 min depois é ignorada.
- **2026-09-26** — grupo de cupons (D26, nota [[11 - Grupo de Cupons]]). Leitor calibrado com 14 mensagens reais (16 cupons,
  Zé Delivery ignorado; "em todo o site" = geral). Teste do ML na conta de afiliado: código inventado → inválido;
  TODOSITE10 → válido e depois "já foi adicionado"; DECOR20 → "não se aplica a você". Achados: o "Inserir código" só abre
  depois da página hidratar; aceitar o cupom navega para "Meus cupons" no meio da leitura; o card tem título + "Cupom
  ativado de…", valores em linha separada e validade como cronômetro ("Encerra em 01:45:00"). Ponta a ponta com canal
  falso: 3 cupons do ML válidos + 1 da Amazon agendados a cada ~35 s e enviados ("chat not found"); escolha do cupom junto
  do post conferida (ML R$ 300 → TODOSITE10; R$ 50 → nenhum; Amazon R$ 150 → cupom; R$ 80 → nenhum).
- **2026-09-26** — bot estava parado desde 2026-09-25 21:14 UTC (recebeu SIGTERM numa recriação e tinha `restart: "no"`).
  Não afetou posts (quem publica é o worker). Religado com `restart: on-failure` (sem token sai com 0 e não entra em loop).

## Regras de ouro

1. **Números nunca vêm de IA** — texto pode ser gerado; preço/desconto vêm do banco.
2. **Ritmo, não rajada** — Telegram: espaçamento + silêncio de madrugada. WhatsApp (fase 3): teto diário rígido, é o que evita ban.
3. **subID único por post** — é a chave para atribuir venda a post.
4. **`.env` nunca versionado**; segredos só nele (status em [[03 - Credenciais]]).
5. **Todo post se identifica como anúncio** (CONAR).
