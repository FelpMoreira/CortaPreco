# 01 — Visão do Projeto

## O que é

Canal de **ofertas e cupons** (Telegram agora, WhatsApp depois) que:

1. Coleta produtos com desconto (Shopee, AliExpress, Amazon; outras lojas no futuro).
2. Enriquece os dados (título, preço, preço antigo, imagem, cupom) — e o admin corrige o que vier errado.
3. Converte a URL em **link de afiliado** (comissão por venda), com **subID único por post**.
4. Gera a mensagem e publica no canal, respeitando teto por hora/dia.
5. Rastreia **cliques** (redirector próprio) e, na fase 2, **conversões/comissões**.

## Objetivo

Validar o fluxo completo manualmente (MVP) → automatizar coleta e filtros → IA no texto → SaaS multi-tenant.

## Canais

| Canal | Como | Risco |
|-------|------|-------|
| **Telegram** (canal) | Bot API oficial | Nenhum de ban. Canal do MVP. |
| **WhatsApp** (grupo) | Só API não oficial (Baileys/Evolution) | **Ban permanente possível.** Fase 3, chip separado. |

## Lojas

| Loja | Dados do produto | Link de afiliado | Status |
|------|------------------|------------------|--------|
| Amazon | scrape leve da página (JSON-LD, `productTitle`, `og:*`) | `/dp/{ASIN}?tag=` | ✅ em uso |
| Shopee | página do produto (JSON-LD / meta) | GraphQL `generateShortLink` | ⏳ falta credencial |
| AliExpress | TOP API `productdetail.get` → fallback página | TOP API `link.generate` | ⏳ falta credencial |

## Receita

Comissão das lojas sobre vendas pelos links. Medição:
- **Cliques:** redirector `/c/{postId}` (exige `PUBLIC_BASE_URL`, ver [[07 - Operação]]).
- **Vendas (fase 2):** relatório de conversão de cada rede cruzado pelo `subId` do post
  (Shopee `conversionReport`, AliExpress `order.list`, relatório da Amazon).

## Não-objetivos no MVP

- LLM no texto (templates determinísticos — ver D4 em [[06 - Decisões e Log]]).
- Coleta automática em massa (entra na fase 2).
- WhatsApp.

## Obrigações

- Todo post e o site identificam **publicidade/link de afiliado** (CONAR). Template termina com "📌 Anúncio"; site tem aviso no rodapé.
- Cliques guardam só `referrer` — **nenhum IP ou dado pessoal** (LGPD).
