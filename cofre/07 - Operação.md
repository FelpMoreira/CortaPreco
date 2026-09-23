# 07 — Operação

## Rodar local

```bash
docker compose up -d          # Postgres (porta 5434) + Redis (6379)
npm install
npm run db:generate && npm run db:push
npm run dev:api               # :3001
npm run dev:worker            # scheduler + envio  ⚠️ publica de verdade no canal
npm run dev:bot
npm run dev:web               # :3000 — site em /, painel em /admin
```

- **Worker ligado = posts agendados vão para o canal real.** Para testar sem publicar, deixe o worker parado.
- Mudou o `schema.prisma`? `npm run db:push` e **reinicie** api, worker e bot (o `tsx watch` não recarrega o client do Prisma).
- Mudou o `next.config.ts`? O `next dev` reinicia sozinho.

## Uso diário

1. Painel → **Nova oferta** → cole a URL → **Buscar**.
2. Confira título, preço (obrigatório), preço antigo, cupom, imagem. O quadro da direita mostra o post como vai sair.
3. **Agendar post.** O scheduler publica no próximo espaço livre (ver anti-spam em [[02 - Arquitetura]]).
4. Acompanhe em **Posts**; falha mostra o motivo e tem **Reenviar**.

## Deploy

Mínimo para lançar (detalhes em [[08 - Segurança#Checklist de lançamento]]):

- Um host (VPS) com Docker para Postgres/Redis, ou serviços gerenciados.
- `NODE_ENV=production`, segredos fortes, HTTPS em tudo.
- **Web** (Next) público: `npm run build -w @cupons/web && npm run start -w @cupons/web`.
- **API** pública só por causa do `/c/{id}`: domínio próprio (ex.: `go.seudominio.com.br`) em `PUBLIC_BASE_URL`.
  As rotas `/api/*` de admin exigem a chave, mas o ideal é o proxy só expor `/c/` e `/api/public/`.
- Atrás de nginx/Caddy/cloudflared: `TRUST_PROXY=true` (senão o rate limit vê todo mundo como um IP só).
- Worker e bot: processos sempre ligados (systemd, pm2 ou container), **uma instância de cada**.
- Teste rápido sem servidor: `cloudflared tunnel --url http://localhost:3001` e use a URL gerada em `PUBLIC_BASE_URL`.

## Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---------|----------------|-------------|
| Post em FAILED "Envio interrompido" | Worker caiu no meio do envio (POSTING >15 min) | **Confira o canal** antes de reenviar — pode ter saído |
| FAILED com `Telegram: Bad Request: can't parse entities` | HTML inválido na mensagem editada | Corrija as tags (`<b>…</b>`) e agende de novo |
| FAILED `chat not found` / `not enough rights` | `TELEGRAM_CHANNEL` errado ou bot não é admin | Ajuste o canal / dê permissão de postar ao bot |
| Post saiu sem foto | Legenda > 1024 caracteres ou imagem inacessível | Encurte o texto ou troque a URL da imagem |
| Agendado e nada acontece | Worker parado, teto atingido ou intervalo mínimo | Veja `/stats` no bot e o log do worker |
| Preço R$ 0,00 / "sem preço" | Scrape bloqueado pela loja | Preencha o preço no painel |
| "Nenhum provider configurado para a URL" | Loja sem credencial no `.env` | Ver [[03 - Credenciais]] |
| Painel: "Muitas tentativas" | 5 senhas erradas em 15 min | Aguarde 15 min (ou reinicie o web em dev) |
| Cliques sempre 0 | `PUBLIC_BASE_URL` vazio → posts usam link direto | Configure domínio/túnel |
| Página 500 "Can't resolve './types.js'" | Webpack sem `extensionAlias` | Já corrigido no `next.config.ts` — não remova |
