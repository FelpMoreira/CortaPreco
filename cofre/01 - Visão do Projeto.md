# 01 — Visão do Projeto

## O que é

Grupo/canal de **ofertas e cupons** (Telegram como canal inicial, WhatsApp depois) que:
1. Coleta produtos com desconto (Shopee, AliExpress, Amazon e outras no futuro).
2. Enriquece dados (título, preço, desconto, imagem, cupom).
3. Converte URLs em **links de afiliado** (comissão por venda).
4. Gera a mensagem do post e publica nos canais.
5. Rastreia **cliques** e (fase 2) **conversões/comissões**.

## Objetivo

Validar com um MVP o fluxo completo (manual) → depois automatizar coleta, filtros,
IA no copy e virar SaaS multi-tenant.

## Canais

- **Telegram** (canal): **API oficial**, sem risco de ban. É o canal do MVP.
- **WhatsApp** (grupo): só com API não oficial (Baileys/Evolution) — **risco de banimento**.
  Entra na fase 3 com chip separado, aquecimento do número e pacing.

## Lojas do MVP

| Loja | Descoberta | Link de afiliado |
|------|-----------|------------------|
| Shopee | página produto / API de oferta | `generateShortLink` (GraphQL, appId/secret) |
| AliExpress | página produto / OPEN Platform | TOP API (`appKey`/`secret` + `trackingId`) |
| Amazon | página produto (JSON-LD) | tag `?tag=` (SiteStripe); Creators API pluga depois |

## Modelo de receita

Comissão por venda gerada nos links de afiliado. Medida via:
- cliques no redirector próprio (`/c/{postId}`)
- relatório de conversão da rede (Shopee `conversionReport`, AliExpress `order.list`, Amazon reporting) cruzado por **subID único por post**.

## Não-objetivos no MVP

- Sem LLM no copy (templates determinísticos; IA vira fase 3).
- Sem scraping em massa ainda (coleção manual no painel).
- Sem WhatsApp ainda.