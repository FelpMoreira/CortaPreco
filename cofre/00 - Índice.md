# 🏷️ CortaPreco — cofre de contexto

Pipeline de ofertas com links de afiliado: colar URL → conferir → agendar → publicar no Telegram → contar cliques.
Repo: `FelpMoreira/CortaPreco` · pasta local `cupons/`.

## Estado atual (2026-09-23)

- **Fase 1 (MVP manual)** funcionando: 3 posts reais da Amazon publicados no canal.
- Painel completo (editar dados, preview estilo Telegram, cancelar/reenviar, métricas) e hardening de segurança feitos.
- **Bloqueia o lançamento:** segredos fracos no `.env`, domínio público/HTTPS, credenciais Shopee e AliExpress.
  Ver [[08 - Segurança#Checklist de lançamento]].

## Notas

| # | Nota | Para quê |
|---|------|----------|
| 01 | [[01 - Visão do Projeto]] | O que é, receita, não-objetivos |
| 02 | [[02 - Arquitetura]] | Serviços, fluxo, status, onde fica cada coisa |
| 03 | [[03 - Credenciais]] | Status de cada chave — **fora do git** |
| 04 | [[04 - Fases e Roadmap]] | O que está feito e o que falta |
| 05 | [[05 - Pesquisa de APIs]] | Amazon, Shopee, AliExpress, Telegram, WhatsApp |
| 06 | [[06 - Decisões e Log]] | Decisões (D1…) e histórico |
| 07 | [[07 - Operação]] | Rodar, deploy, problemas comuns |
| 08 | [[08 - Segurança]] | Controles e checklist de lançamento |
| 09 | [[09 - API]] | Contrato das rotas |

## Regras do cofre

- Concluiu item de fase → marque `[x]` em [[04 - Fases e Roadmap]].
- Decisão nova ou que mudou de rumo → linha na tabela e entrada no log de [[06 - Decisões e Log]].
- **Segredo só em [[03 - Credenciais]]** (única nota ignorada pelo git) e no `.env`. Nunca cole valor em outra nota.
- Datas absolutas (`2026-09-23`), nunca "ontem"/"semana que vem".
