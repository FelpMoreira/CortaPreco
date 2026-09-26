# 10 — Espelhamento de grupo (Mercado Livre)

> Feature pedida em **2026-09-25**. Observa um grupo de promoções no Telegram e, para cada mensagem com link
> do Mercado Livre (`meli.la`), gera o **nosso** link de afiliado e posta no nosso canal com atraso aleatório.
> Decisão: [[06 - Decisões e Log#Decisões]] (D24). Operação do dia a dia: [[07 - Operação#Espelhamento de grupo]].

## O pedido (como veio)

1. Observar um grupo de promoções no Telegram; para cada mensagem recebida, ver se tem link de produto.
2. Se o link é do Mercado Livre (**host `meli.la`**):
   - abrir e achar o botão **"Ir para produto"** (`<a class="poly-component__link poly-component__link--action-link">`, sem `href`);
   - copiar a URL **sem os query params**;
   - abrir `https://www.mercadolivre.com.br/afiliados/linkbuilder#hub`, colar em `textarea#url-0`, apertar **Gerar**
     (`button#_R_199rpa_`), esperar e copiar a **URL curta** (`button#_r_0_`);
   - montar o post com os dados do produto.
3. O navegador precisa estar **logado na conta de afiliado** (login feito antes, uma vez).
4. Se a conversão falhar → **alerta no painel, no canal** que observa o grupo. Se der certo → post no canal.
5. Repost com **atraso aleatório de 0 a 2min30s**.
6. Em **Administração → Canais**, um controle que mostre **qual grupo** está sendo observado e **que tipo de link**
   (ex.: Mercado Livre), para **ligar/desligar o fluxo em qualquer canal**.

## Como ficou (visão geral)

```text
 grupo de promoções (Telegram)
        │ mensagem nova (evento em tempo real + conferência a cada 1 min)
        ▼
 [worker] mirror.ts ── conta DEDICADA do Telegram (GramJS, só leitura; mesma do "Grupo do Telegram")
        │ 1º link meli.la da mensagem → SourceEvent (PENDING) + sorteia postAt = hora da msg + 0…150 s
        ▼ fila BullMQ "mirror"
 [linker] (serviço novo, Chromium/Playwright, sessão da conta de afiliado)
        │ meli.la → página /social do afiliado de origem → card em destaque → URL do produto sem query/hash
        │ dados do post = card em destaque (título, preço, preço antigo, desconto, imagem)
        │ já postado neste canal nas últimas 24h? → ignora
        │ gerador de links (logado) → link curto NOSSO (https://meli.la/…)
        │ cria Post (POSTING, prioridade 100) + job "publish" com delay até postAt
        ▼ fila BullMQ "publish" (a mesma de sempre)
 [worker] publish ──► Telegram Bot API ──► nosso canal
 falhou em qualquer passo → SourceEvent FAILED + ChannelSource.alert → painel (card do canal + Visão geral)
```

## Peças e arquivos

| Peça | Onde | O que faz |
|------|------|-----------|
| Tipos de link | `packages/shared/src/mirror.ts` | `MIRROR_LINK_TYPES` (hoje só `MERCADOLIVRE`), `mirrorLinkType(url)` (só olha o host: `meli.la`), nome da fila e chaves de status |
| Ouvinte | `apps/worker/src/mirror.ts` | eventos `NewMessage` do GramJS + conferência a cada 60 s; dedup; cria `SourceEvent`; enfileira |
| Cliente Telegram | `apps/worker/src/telegramReader.ts` | `getClient()` único por processo (a mesma sessão em 2 conexões derruba as duas); `whenClientCreated` re-registra o ouvinte em reconexão |
| Conversor | `apps/linker/src/mercadolivre.ts` | passos no navegador, seletores (`SELECTORS`), classificação de falha (`ConversionError.kind`) |
| Navegador | `apps/linker/src/browser.ts` | Chromium único, contexto por conversão, UA fixo, sessão salva, bloqueio de rede interna, prints de falha |
| Job | `apps/linker/src/mirror.ts` | filtros (desligado, silêncio, repetido, atraso), conversão com 1 nova tentativa, `createMirrorPost` |
| Status | `apps/linker/src/status.ts` | batimento no Redis a cada 60 s; confere a sessão do ML no início e a cada 6 h |
| Login ML | `apps/linker/scripts/ml-login.ts` | abre o **seu Google Chrome comum** (perfil próprio `data/linker/chrome-profile`, porta de depuração local, **sem Playwright controlando**); só observa a lista de abas; quando o gerador aparece, conecta e salva cookies + User-Agent |
| Diagnóstico | `apps/linker/scripts/ml-check.ts` | converte um link **sem postar** (`--gerar` também gera o link; `--sessao` só confere o login) |
| API | `apps/api/src/server.ts` | validação do tipo `MIRROR`, eventos, dispensar alerta, status nas presets, alertas na Visão geral |
| Painel | `apps/web/app/admin/_ui/Mirror.tsx` | card do fluxo (grupo, tipo de link, interruptor, saúde, alerta, histórico) e campos do formulário |

## Modelo de dados

- `ChannelSource.kind = 'MIRROR'` (as outras são `API` e `TELEGRAM`). Campos usados:
  `telegramChat` (@grupo, link t.me ou ID), `chatTitle` (nome real, preenchido pelo worker), `linkTypes` (`['MERCADOLIVRE']`),
  `maxDelaySec` (padrão 150, máx. 600), `respectQuiet` (padrão sim), `enabled` (o interruptor), `lastMessageId`
  (até onde leu), `lastRunAt`/`lastResult` (última oferta espelhada ou último erro),
  `alert`/`alertAt`/`alertCount` (alerta que fica até alguém **dispensar**).
- `SourceEvent`: uma linha por mensagem com link tratável. `status`: `PENDING` (na fila do linker) → `CONVERTED`
  (post criado; `postId`, `productUrl`, `affiliateUrl`, `postAt`) | `FAILED` (`detail` = motivo) | `SKIPPED` (`detail` = por quê).
- Post do espelhamento: `status POSTING` desde a criação (o scheduler não mexe), `priority 100`, `price` do card,
  `affiliateUrl` = link curto gerado. Loja do produto: **`MERCADOLIVRE`** (nova em `STORES`), `storeProductId` = `MLB…`/`MLBU…`.

## Regras do fluxo (decisões de detalhe)

| Regra | Valor | Por quê |
|-------|-------|---------|
| Que link | só host `meli.la` (e subdomínios) | pedido; é o encurtador de afiliado do ML. `mercadolivre.com.br/...` direto é ignorado (dá para ligar depois) |
| Mais de um link na mensagem | vale **o primeiro** `meli.la` | 1 mensagem do grupo = no máximo 1 post nosso |
| Atraso | sorteado 0…`maxDelaySec`, **contado da hora da mensagem original** | pedido (0–2min30s). Se a conversão demorar mais que o sorteio, posta assim que terminar |
| Mensagem velha | > 10 min quando vista → ignorada | worker parado / conferência atrasada não despeja oferta velha |
| Conversão tardia | terminou > 10 min depois do `postAt` → ignora | idem |
| Ao ligar/religar | começa da **próxima** mensagem | não espelha o histórico do grupo |
| Repetido | mesmo produto (MLB) no mesmo canal em 24h → ignora (antes de abrir o gerador) | grupos repetem oferta; poupa a conta de afiliado |
| Silêncio | com `respectQuiet`, oferta cujo `postAt` cai no silêncio do canal (ex. 23h–7h) é ignorada | D16: madrugada incomoda o público |
| Ritmo do canal | **não** passa pela fila/teto por hora | pedido: repostar em até 2min30s. O post conta no ritmo (o próximo da fila respeita o intervalo depois dele) |
| Canal | só **Telegram** | rajada no WhatsApp = risco de ban (D18) |
| Texto do post | **nosso template** com dados do produto; nada do texto/imagem do grupo | regra do projeto desde D21 |
| Conversões | 1 por vez (concorrência 1), 1 nova tentativa em falha de layout/rede | volume humano na conta de afiliado |
| Conferência de preço | não se aplica (ML não tem API de preço aqui; o `publish` loga "sem conferência") | D23 só vale para AliExpress |

## O que a página real mostrou (investigado em 2026-09-25)

- `meli.la/<código>` → **301** para `https://www.mercadolivre.com.br/social/<afiliado>?matt_word=…&matt_tool=…&ref=…`
  (página "social" do afiliado que postou).
- Link de **produto**: a página tem um card em destaque `.poly-card.poly-card--list.poly-card--xlarge` com o
  `a.poly-component__link.poly-component__link--action-link` "Ir para produto". **Sem login, esse `<a>` vem com `href`**
  (ex.: `…/up/MLBU4880400472?pdp_filters=item_id%3AMLB7470662084&matt_…#polycard_client=…`). Se vier sem `href`
  (como no navegador logado do pedido), o linker **clica** e pega o destino (mesma aba ou aba nova).
- Link de **vitrine**: alguns `meli.la` apontam para o perfil inteiro (41 produtos em grade, nenhum em destaque) →
  evento `FAILED` com "o link aponta para a vitrine do afiliado, sem um produto em destaque" (e alerta).
- Formatos de URL do produto: catálogo `…/p/MLB52192170`, "user product" `…/up/MLBU4880400472`,
  anúncio `produto.mercadolivre.com.br/MLB-4320637847-…-_JM`. Tirar a query tira também o `pdp_filters=item_id:…`
  (vendedor específico): o link cai na página do produto e o ML escolhe a oferta — foi o pedido ("sem os query params").
  O `#polycard_client=…` (rastreio) também sai.
- **Página do produto sem login cai em `/gz/account-verification`** (verificação anti-robô). Por isso os dados do post
  vêm do **card em destaque** (mesmos título, preço, preço antigo, desconto e imagem) — e é um acesso a menos à conta.
- Preço no card: `aria-label` "664 reais com 05 centavos" em `.poly-price__current .andes-money-amount`;
  preço antigo em `s.andes-money-amount--previous` (quando há desconto); `%` em `.andes-money-amount__discount`.
  Conferido: R$ 129 de R$ 338 → −61% (igual ao selo do ML); R$ 307,70 de R$ 323,90 → −5%.
- Gerador de links **sem sessão** → `…/login/identification?challenge_id=…` (antes era `/jms/mlb/lgz/login`), com reCAPTCHA.
  O linker reconhece os dois e dá o erro de **sessão** (não de layout).
- Pegadinha técnica: o `tsx` (esbuild keepNames) injeta `__name(...)` nas funções passadas a `page.evaluate` →
  "ReferenceError: __name is not defined" na página. Contorno: `NAME_SHIM` via `addInitScript` em todo contexto.

## Seletores (em `apps/linker/src/mercadolivre.ts` → `SELECTORS`)

| Passo | Seletor principal | Alternativa |
|-------|-------------------|-------------|
| Card em destaque | `.poly-card--xlarge` + `a.poly-component__link--action-link` | primeiro `.poly-card` com o "Ir para produto" |
| URL do produto | `href` do "Ir para produto" | `href` do título do card; senão clique e captura da navegação (e `?go=` da verificação) |
| Campo do gerador | `textarea#url-0` | — (se sumir: erro de layout + print) |
| Botão Gerar | `button#_R_199rpa_` | botão com texto "Gerar" |
| Link curto | texto `https://meli.la/…` (ou `mercadolivre.com/sec/…`) que **apareceu depois** do clique | botão copiar `button#_r_0_` / "Copiar" + área de transferência |

`_R_199rpa_` e `_r_0_` são ids do **React `useId`**: mudam quando o ML reorganiza a página. Por isso há alternativa por
texto. Mudou o layout? Os prints ficam em `data/linker/debug/` (PNG + HTML da página, só os 40 mais recentes) e o
motivo aparece no alerta. Ajuste `SELECTORS` e teste com `npm run ml:check -- <link> --gerar`.

**Gerador logado — conferido em 2026-09-26** (1ª conversão real): `textarea#url-0` e `button#_R_199rpa_` batem com o
pedido. Achado: **colar (`fill`) deixa o "Gerar" desabilitado; digitar (`pressSequentially`, 12 ms/caractere) habilita**
— o site só reage a eventos de teclado. O link curto aparece no painel da direita e é lido do texto da página.
Resultado: `meli.la/12hnEiy` (grupo, etiqueta `reduza`) → produto `…/p/MLB70042169` → **`meli.la/2zFYfUp`**, que
redireciona para `/social/<nossa etiqueta>?matt_word=<nossa etiqueta>&matt_tool=<nosso matt_tool>` = **a nossa etiqueta**.
A página tem um reCAPTCHA invisível; não impediu a geração.

## Falhas e alertas

| Tipo (`ConversionError.kind`) | Exemplo | Nova tentativa? | Status do conversor |
|------|---------|-----------------|--------------------|
| `SESSION` | gerador caiu no login | não | "sessão expirou: rode npm run ml:login" |
| `BLOCKED` | ML pediu verificação de conta | não | "ML pediu verificação" |
| `NO_PRODUCT` | link de vitrine; link levou para fora do ML | não | — |
| `LAYOUT` | campo/botão/link curto não apareceu; card incompleto | sim (1×, após 5 s) | — |
| `NETWORK` | página não abriu | sim (1×) | — |

- Falha final → `SourceEvent FAILED` + `ChannelSource.alert = "Conversão do link falhou (<link>): <motivo>"`,
  `alertCount++`. Aparece em **Canais** (card do fluxo, em vermelho) e na **Visão geral** (faixa no topo), com
  **Dispensar** (qualquer perfil; auditado como `source.dismiss_alert`). O histórico continua em "Últimas mensagens".
- Grupo inacessível (conta não é membro, @ errado) → alerta "Não consegui ler o grupo …" (só quando o texto muda).
- Saúde no card (lida do Redis, validade 3 min): **Ouvinte** (`mirror:status:listener`: ouvindo "<grupo>" /
  conta não conectada / fora do ar) e **Conversor** (`mirror:status:linker`: no ar + sessão ok/expirou/sem login/verificação).

## Como ligar (passo a passo)

1. **Conta dedicada do Telegram** (se ainda não fez): `TELEGRAM_API_ID/HASH` no `.env` →
   `docker compose exec -it worker npm run telegram:login -w @cupons/worker` → `TELEGRAM_USER_SESSION` no `.env` →
   `docker compose up -d --force-recreate worker api`. A conta precisa **ser membro** do grupo observado.
2. **Login no Mercado Livre** (na sua máquina, fora do Docker — abre uma janela): `npm run ml:login` na raiz do repo.
   Abre o Google Chrome comum num perfil separado. Entre na conta **de afiliado**; quando o gerador de links aparecer,
   o script salva `data/linker/mercadolivre-state.json` (cookies) e `mercadolivre-meta.json` (User-Agent do seu Chrome,
   que o linker passa a usar) e fecha a janela. O perfil fica guardado: no próximo `ml:login`, se a sessão ainda valer
   no Chrome, salva em segundos sem digitar senha.
3. Conferir: `docker compose exec linker npm run ml:check -w @cupons/linker -- --sessao` → `sessão: ok`.
   Teste completo sem postar: `… ml:check -w @cupons/linker -- https://meli.la/XXXX --gerar`.
4. Painel → **Administração → Canais** → no canal de destino (Telegram) → **Espelhar grupo** → grupo observado,
   "Mercado Livre", atraso (150 s), silêncio → **Salvar**. O interruptor **Ativo/Desligado** liga e desliga a qualquer momento.
5. Em até 1 min o card mostra "Ouvindo <nome do grupo>". Cada oferta aparece em "Últimas mensagens com link".

## Testes feitos (2026-09-25)

- `meli.la` reais (de canais públicos) no Chrome do host e no Chromium do container: URL limpa, id, título, preço,
  preço antigo e desconto corretos em 9 produtos; link de vitrine recusado com o motivo certo.
- Filtro do ouvinte (8 casos): `https://meli.la/x`, `meli.la/x` sem https, link escondido em palavra, link em botão,
  vários links (vale o 1º), só Amazon/Shopee (ignora), domínio falso `meli.la.golpe.com`/`xmeli.la` (ignora),
  link direto do ML (ignora).
- Detecção de login (6 casos) — achado: o ML mudou para `/login/identification`; corrigido.
- Ponta a ponta **da falha**, com canal falso: evento na fila → linker leu o produto → gerador sem sessão → evento
  `FAILED` + alerta no canal + status "sem login" + faixa na Visão geral.
- Ponta a ponta **do post** (a partir de uma conversão pronta, `createMirrorPost`): post criado com o nosso texto
  ("🤝 OFERTA MERCADO LIVRE", De R$ 338 / Por R$ 129 / −61%), job de envio disparou em **20:09:50.075** para
  `postAt` 20:09:50.002; canal falso → "chat not found" → FAILED (nada publicado).
- API: sem tipo de link (400), canal WhatsApp (400), tipo inválido (400), "rodar agora" no espelhamento (400),
  desligar/religar (religar zera a posição de leitura), dispensar alerta (limpa + auditoria).
- Painel: capturas do card (escuro/claro), formulário, histórico e faixa da Visão geral.
- 2026-09-26: `ml:login` com o Chrome comum funcionou (44 cookies, UA do Chrome 153); sessão **válida dentro do
  Docker** (`ml:check -- --sessao` → ok); conversão real completa gerou `meli.la/2zFYfUp` com a nossa etiqueta.
- **Não testado ainda**: ouvir um grupo de verdade com o fluxo ligado (conta do Telegram já conectada em 2026-09-26).

## Incidente: "limite de tentativas" no login (2026-09-26)

- A 1ª versão do `ml:login` abria a janela **pelo Playwright** (`chromium.launch({ headless: false })`). Janela assim
  se anuncia como automação (`navigator.webdriver`, flag `--enable-automation`) e o login do ML/reCAPTCHA respondeu
  **"limite de tentativas"**.
- Correção: o script sobe o **Chrome comum** com `--user-data-dir=data/linker/chrome-profile --remote-debugging-port=9223`
  e **não se conecta à página durante o login** (só lê `http://127.0.0.1:9223/json/list`). Conecta (`connectOverCDP`)
  apenas quando o gerador já está aberto, copia a sessão (`storageState`) e o `User-Agent` de `/json/version`, e fecha.
- Testado sem login: Chrome 153 aceita a porta com perfil próprio (desde o Chrome 136 ela é recusada no perfil padrão),
  as abas aparecem sem conectar e os cookies saem no `storageState` (conferido com um site que grava cookie).
- O bloqueio do ML é temporário: **não insistir** (cada tentativa estende); esperar algumas horas.
- O linker usa o UA salvo (`sessionUserAgent()`, recusa UA com "Headless"); sem arquivo, o UA padrão.

## Conta de afiliado: aviso do ML (2026-09-26)

O gerador mostra: **"Valide sua identidade para continuar no Programa — preencha todos os dados em até 96 dias para
evitar que sua conta seja suspensa"** (visto em 2026-09-26 → prazo por volta de **2026-12-31**). Não bloqueia hoje, mas se
a conta for suspensa o espelhamento para (alerta de sessão/verificação). Etiqueta em uso: `<nossa etiqueta>`.

## Riscos

- **Termos do Mercado Livre**: automatizar o portal de afiliados com robô pode violar as regras do programa → risco de
  bloqueio da conta de afiliado. Mitigação: 1 conversão por vez, sem acessos extras (dados vêm do card), sessão
  conferida só a cada 6 h. Se o ML oferecer API oficial de links, trocar o passo do gerador por ela.
- **Detecção de robô**: o ML já manda anônimo para verificação na página do produto. Logado pode acontecer também →
  alerta `BLOCKED`; resolver entrando pelo navegador e rodando `ml:login` de novo.
- **Mudança de layout**: seletores quebram sem aviso → alerta `LAYOUT` + print; ajustar `SELECTORS`.
- **Clique no link de outro afiliado**: abrir o `meli.la` do grupo conta um clique para quem postou. Irrelevante.
- **Grupo observado posta demais**: sem teto por hora no espelhamento (pedido). Se incomodar, dá para somar um teto.

## Ideias para depois

- Aceitar também links diretos `mercadolivre.com.br/...` e `mercadolivre.com/sec/...` (novo tipo em `MIRROR_LINK_TYPES`).
- Outros tipos de link (Amazon, Shopee) reaproveitando o mesmo ouvinte: só precisa de um conversor novo no linker.
- Aviso do alerta também por DM do bot aos admins.
- Teto opcional de posts/hora por fluxo.
