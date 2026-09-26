# 05 — Pesquisa de APIs

> Pesquisa feita em set/2026. Contratos de API mudam: revalide antes de depender de um detalhe.

## Amazon
- **PA-API 5.0 deprecated** em 15/mai/2026 → migrar para **Creators API**.
- Creators API (REST) exige **10 vendas qualificadas nos últimos 30 dias** para acesso.
- Credenciais agora ficam na Central de Associados (não mais AWS console).
- Para o MVP: **link manual `https://{marketplace}/dp/{ASIN}?tag={tag}`** funciona sem API.
- Enrich por scrape leve da página (JSON-LD `application/ld+json`).

## Shopee
- Programa: affiliate.shopee.com.br — conta aprovada necessária.
- **Open API** (GraphQL, endpoint `https://open-api.affiliate.shopee.com.br/graphql`):
  - `generateShortLink` → encurta URL com tracking de afiliado.
  - `productOfferV2` → dados de oferta do produto.
  - `conversionReport` → relatório de conversões (fase 2).
- Auth: **`Authorization: SHA256 Credential={app_id}, Timestamp={ts}, Signature={sig}`**
  onde `sig = sha256(appId + timestamp + body + secret)`.
- Precisa ativar a aba **Open API** no painel (pode exigir gerente/suporte).

## AliExpress
- Programa: AliExpress Portals (affiliate) — tracking ID (PID).
- **Open Platform** (TOP API): `host: api-sg.aliexpress.com/sync?method=...`
  - `appKey`/`appSecret` criados no App Console (tipo app de afiliado).
  - Assinatura: HMAC-SHA256, mensagem = concat `chave+valor` dos params ordenados, HEX uppercase.
- Limite: ~5.000 req/dia.

## Mercado Livre (fora do MVP, analisado)
- API pública oficial `api.mercadolibre.com/sites/MLB/search` (preço, original_price, vendas, thumb).
- Programa de afiliado existe mas menos maduro → fica fora do MVP.

## KaBuM! (fora do MVP)
- Sem API pública oficial; endpoint `servicespub.prod.api.aws.grupokabum.com.br` é interno → pode quebrar.
- Programa de afiliado incerto → **adiado**.

## Telegram
- Bot API oficial (`sendMessage`, `sendPhoto`, long polling). Limites: ~20 msg/min por chat, 1 msg/s por chat; 429 com `retry_after`.
- Canal one-to-many é o formato ideal p/ ofertas (não sofre flood de grupo).
- **Legenda de foto: máx. 1024 caracteres**; texto puro: 4096. Acima de 1024 o worker manda só texto.
- `parse_mode: HTML` aceita só `b i u s code pre a` e poucas outras; HTML inválido → erro 400 e post FAILED.
- O Telegram **abre o link para gerar a prévia** (user-agent `TelegramBot`) — o redirector ignora esse acesso ao contar cliques.
- Em grupos com privacy mode (padrão), o bot só recebe comandos e menções.

## WhatsApp
- API oficial (Cloud/Business) **não serve grupos comuns**; exige templates pagos p/ proativo.
- Bibliotecas não oficiais (Baileys, whatsapp-web.js, Evolution API): **violam o ToS**,
  risco de **banimento permanente** (código erro #1603 detecta automação).
- Mitigação quando for usar (fase 3): número/chip separado, aquecimento, respostas a quem chamou,
  pacing, opt-out fácil. Nunca número pessoal/principal.

## Referências de implementação
- `gregojoao/shopee-affiliate` (.NET), `Afilimax/*-provider` (Node), `DaniloCDev/lainMonitor` (ótimo modelo de conteúdo).

## Mercado Livre (2026-09-25)

- Links de afiliado do ML são gerados no **portal de afiliados** (`/afiliados/linkbuilder`), logado. O encurtador é `meli.la`.
  Não usamos API oficial para isso: o espelhamento ([[10 - Espelhamento Mercado Livre]]) usa um navegador logado.
- `meli.la/<código>` → 301 para `/social/<afiliado>?matt_word=…&matt_tool=…` (página do afiliado com o produto em destaque).
- Página de produto acessada sem login por robô → `/gz/account-verification` (verificação). O card da página social traz
  os mesmos dados (título, preço, preço antigo, desconto, imagem).
- Rastreio de afiliado fica na query (`matt_word`, `matt_tool`, `ref`) e no hash (`#polycard_client=…`): tirar os dois
  remove o afiliado de quem postou.

