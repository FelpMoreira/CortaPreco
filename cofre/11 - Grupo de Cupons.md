# 11 — Grupo de cupons (coleta, teste e uso)

> Pedido em **2026-09-26**: "tenho um grupo que é só de cupons; coletar os cupons e salvar para mandar junto com os
> produtos; testar se o cupom está funcionando". Decisões do dono (2026-09-26):
> - lojas: **Mercado Livre, Amazon, Shopee, AliExpress**;
> - uso: **junto do produto** + **guardar no painel** + (planejado) **um grupo só para mandar cupons**;
> - teste: **ML automático na conta de afiliado + validade** (as outras lojas por tempo e marcação manual).
> Relacionado: [[10 - Espelhamento Mercado Livre]] (mesmo ouvinte e mesmo linker), decisão D26 em [[06 - Decisões e Log]].

## Visão geral

```text
 grupo de cupons (Telegram)
   │ mensagem nova (mesmo ouvinte do espelhamento: conta dedicada, tempo real + conferência a cada 1 min)
   ▼
 [worker] coupons.ts → parseCouponMessage → Coupon (1 por loja+código; visto de novo = renova)
   ├─ Mercado Livre → fila "mirror" → [linker] couponTest.ts: "Cupons → Inserir código" na conta de afiliado
   │                                   → VALID / RESTRICTED / INVALID + condições de "Meus cupons"
   ├─ outras lojas → NEW, vale 24 h (ou até marcar "não funciona")
   └─ "Publicar os cupons neste canal" ligado → fila "coupon-post" → post espaçado no canal (só código, sem links do grupo)

 post de produto (fila, sugestão, espelhamento) → bestCouponFor(loja, preço) → linha "🎟️ Cupom: CODE (10% OFF, até R$ 15)"
```

## Peças e arquivos

| Peça | Onde | O que faz |
|------|------|-----------|
| Leitor de mensagem | `packages/shared/src/coupons.ts` → `parseCouponMessage`, `couponSummary` | código, loja, %/R$, mínimo, teto, escopo, geral?, link |
| Texto do post de cupom | `packages/shared/src/template.ts` → `renderCouponHtml` | código em `<code>` (toque = copiar), condições, validade, "📌 Anúncio" |
| Cupom junto do produto | `packages/db/src/coupons.ts` → `bestCouponFor`, `couponLine` | escolhe o melhor cupom geral e válido para loja+preço |
| Coleta / canal de cupons | `apps/worker/src/coupons.ts` | `collectCoupons` (ouvinte), fila `coupon-post` (agenda + envia), `expireCoupons` (tick) |
| Teste ML | `apps/linker/src/couponTest.ts` | insere o código, lê a resposta, lê o card de "Meus cupons" |
| API | `apps/api/src/server.ts` | `GET /api/coupons`, `PATCH /api/coupons/:id`, `POST /api/coupons/:id/test`; fonte `COUPONS` |
| Painel | `_ui/Coupons.tsx` (aba Catálogo → Cupons), `_ui/Mirror.tsx` (`CouponFormFields`, `CouponSourceCard`) | lista, filtros, copiar, testar, funciona/não funciona, usar nos posts |

## Modelo

- `ChannelSource.kind = 'COUPONS'`: `telegramChat` (grupo observado), `stores` (lojas que interessam),
  `postCoupons` (publicar no canal da fonte), `minGapSec` (intervalo entre cupons publicados), `respectQuiet`.
- `Coupon` (único por `store + code`): `title` (nosso resumo; no ML vira o título oficial ao validar, ex.
  "10% OFF TODO O SITE"), `discountPct`/`discountValue`, `minPurchase`, `maxDiscount`, `scope`, `attachable`
  (vai junto dos posts), `status` NEW | VALID | RESTRICTED | INVALID | EXPIRED, `statusDetail`, `checkedAt`,
  `expiresAt`, `sourceLink` (**link do afiliado que postou — só referência, nunca vai para os nossos posts**),
  `seenCount`, `firstSeenAt`/`lastSeenAt`, `postAt`/`postedAt`/`postError` (canal de cupons), `usedInPosts`.

## Como a mensagem é lida (calibrado com canais reais em 2026-09-26)

Formato típico dos grupos de cupons:

```text
🚨 SAIU!!! CUPOM MERCADO LIVRE 🚨
🎟️ APROVEITAHOJE                       ← código em monoespaçado (entidade code do Telegram)
10% OFF acima de R$149 máx R$200       ← condições na linha de baixo
Na lista: https://meli.la/2qTdA7r      ← link do afiliado que postou (não usamos)
App todo (ou maior parte dele):        ← cabeçalho = cupom geral
🎟️ TODOSITE10
10% acima de R$99 máx R$15
🎟️ TODOSITE2509 - R$25/219             ← compacto: R$ 25 OFF a partir de R$ 219
🎟️ DECOR20
20% OFF acima de R$119 máx R$35 em Decoração & Eletros   ← escopo = não é geral
```

- Códigos: os de `extractCoupon` (monoespaçado primeiro; senão "Cupom: X"/"use o cupom X" em MAIÚSCULAS).
- Bloco do cupom: da linha do código até o próximo código (máx. 3 linhas), parando em linha vazia.
- Loja: pelo bloco; senão pela mensagem (título, `#MercadoLivre`, links `meli.la`/`amzn.to`/`shope.ee`/…); loja fora
  das escolhidas (ex.: Zé Delivery, iFood) → ignorado.
- Geral: sem escopo e (cabeçalho "APP TODO"/"todo o site" na mensagem ou acima, ou código com SITE/TODOAPP).
- Link: do bloco; senão o primeiro link da loja **depois** do código ("👇 RESGATE APENAS AQUI:\n…").
- Teste com 14 mensagens reais: 16 cupons, todos com loja/código/desconto/mínimo/teto/escopo corretos; Zé Delivery ignorado.

## Teste do Mercado Livre (visto na conta de afiliado em 2026-09-26)

Página `https://www.mercadolivre.com.br/cupons` → link **"Inserir código"** → modal com
`#inputcode-textfield-with-link` ("Inserir código do cupom", máx. 23) e botão **Inserir** (digitar, não colar).

| Resposta do ML | Status |
|----------------|--------|
| "Você aplicou o cupom de 10% OFF TODO O SITE!" (vai para `/cupons/active`) | **VALID** — o cupom fica na conta de afiliado |
| "Erro · Este cupom não se aplica a você." | **RESTRICTED** (existe, mas não para esta conta/público) |
| "Erro · Confira se o cupom está correto" | **INVALID** |
| "Este cupom já foi adicionado, mas ainda pode ser usado em produtos selecionados." | **VALID** (já estava na conta) |

Testado: `CORTAPRECOTESTE1` → inválido; `TODOSITE10` → válido (e depois "já foi adicionado"); `DECOR20` → restrito.
Pegadinha: clicar "Inserir código" logo após carregar não abre o modal (página ainda hidratando) → espera `load` e tenta até 3×.
Depois de aplicar, **Meus cupons** mostra o card: "10% OFF TODO O SITE · Em produtos selecionados · Compra mínima
R$ 99 · Limite de R$ 15 · Termina em 2 horas!" → `minPurchase`, `maxDiscount`, `expiresAt` (`parseMlExpiry` entende
"Termina em N horas/minutos", "Vence hoje/amanhã", "Vence em quarta-feira", "Vence 31 de outubro"; fim do dia = 23:59
de Brasília). "Em produtos de <loja>" = escopo de loja → não vai junto dos posts.
O título oficial com "TODO O SITE" marca o cupom como geral.
Tetos: 40 testes/h; um por vez (fila do linker). Cupom visto de novo re-testa se o último teste tem > 30 min.
Diagnóstico: `docker compose exec linker npm run ml:check -w @cupons/linker -- --cupom CODIGO`.
Página do ML também lista ~2.800 cupons da loja ("Todos os cupons") — ideia futura: coletar direto de lá.

## Cupom junto do post de produto

- `bestCouponFor(loja, preço)`: `attachable` e não vencido; **ML só VALID**; outras lojas NEW visto nas últimas 24 h;
  compra mínima ≤ preço; maior desconto efetivo no preço (respeita o teto).
- Linha no post: `🎟️ Cupom: TODOSITE10 (10% OFF, até R$ 15)`.
- Onde entra: agendamento na API (Nova oferta, sugestões, aprovação automática — só quando a mensagem é a gerada;
  mensagem editada no painel já traz o que a pessoa quis) e espelhamento (só se a mensagem do grupo não tinha cupom).
- `usedInPosts` conta quantas vezes foi usado.

## Canal de cupons (publicar)

- "Publicar os cupons neste canal" na fonte → cada cupom **postável** (ML: VALID; outras: NEW/VALID não vencido) é
  agendado com intervalo (`minGapSec`, +0–30%) depois do último cupom e do último post do canal; de madrugada
  (silêncio do canal) vai para o fim do silêncio.
- Na hora de enviar confere de novo o status (vencido/inválido não sai). Erro de envio fica em `postError`.
- O texto é o nosso (`renderCouponHtml`), com o código em monoespaçado e **sem os links do grupo**.

## Vencimento

`expireCoupons()` no tick do scheduler (a cada 1 min): NEW/VALID/RESTRICTED com `expiresAt` passado → EXPIRED.
Validade: ML = a do card; outras lojas = 24 h desde a última vez que o grupo divulgou.

## Como ligar

1. Conta dedicada do Telegram conectada e **membro** do grupo de cupons (igual ao espelhamento).
2. Para testar ML: sessão do ML válida (`npm run ml:login`).
3. Canais → canal → **🎟️ Grupo de cupons** → grupo, lojas, (opcional) publicar neste canal → Salvar.
4. Acompanhe em **Catálogo → Cupons** (filtros por status/loja; Testar, Funciona, Não funciona, Usar nos posts).

## Riscos

- Testar cupom do ML **adiciona o cupom à conta de afiliado** (combinado). Automação da conta pode ir contra as regras
  do ML — mesmos cuidados do linker (um por vez, teto por hora).
- Amazon/Shopee/AliExpress não são testados: um cupom inválido pode ir junto de um post até alguém marcar
  "não funciona" ou vencer (24 h). Por isso só vão junto os marcados como gerais.
- Cupom "geral" do ML diz "Em produtos selecionados" mesmo quando é "TODO O SITE": pode não valer para algum produto.
