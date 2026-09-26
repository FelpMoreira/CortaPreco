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

- **Worker ligado = posts agendados vão para o canal real.** Rode os apps **ou** local **ou** no Docker (`docker compose up -d`), nunca os dois: seriam dois workers disputando a fila.
  Para testar sem publicar, deixe o worker parado.
- Mudou o `schema.prisma`? `npm run db:push` e **reinicie** api, worker e bot (o `tsx watch` não recarrega o client do Prisma).
- Mudou o `next.config.ts`? O `next dev` reinicia sozinho.

## Acesso ao painel

- Cada pessoa tem o próprio login (perfil DEV ou GERENTE). DEV cria usuários em **Administração → Usuários**;
  o sistema gera uma senha provisória (mostrada uma vez) e a pessoa troca no 1º acesso.
- Esqueceu a senha? Um DEV gera nova provisória na tela de Usuários, ou pelo terminal:
  `docker compose exec api npm run admin:create -w @cupons/api -- --email pessoa@x.com --reset`
- Conta bloqueada (5 senhas erradas): espera 15 min ou um DEV gera nova provisória.

## Grupos por categoria

1. Crie o grupo/canal no Telegram e adicione **o mesmo bot** como administrador.
2. Mande `/chatid` lá dentro (o bot responde o ID — só para admins do bot).
3. Painel → Administração → **Canais** → Novo canal: cole o ID, marque as categorias. O sistema confere se o bot pode postar.
4. "Testar" manda uma mensagem de verificação. Canal sem categoria marcada = **geral** (recebe tudo).
- Prefira **canal** do Telegram (ou supergrupo) já na criação: grupo comum muda de ID quando vira supergrupo
  (histórico visível, link público, muitos membros) e o bot pode perder o cargo de administrador.
- Cada oferta vai para o geral + os canais da categoria dela. Ajuste a categoria no editor, na sugestão ou em Produtos.

## Fontes de ofertas por canal

- Canais → em cada canal, **Fontes de ofertas**:
  - **APIs oficiais**: lojas disponíveis (AliExpress hoje), termos prontos da categoria do canal (editáveis),
    promoções do AliExpress, desconto/nota/preço mínimos, palavras a excluir, quantas sugestões a cada X min.
  - **Grupo do Telegram**: `@canal` ou ID de outro grupo; lê as ofertas novas, aproveita **só o link do produto**
    (sem o rastreio de quem postou) e gera sugestões com o nosso link, texto e imagem.
- Sugestões chegam com **"Para: <canal>"**. O grupo geral só recebe nicho com nota ≥ o limiar dele (padrão 80).
- "▶" roda a fonte na hora; o resultado da última rodada aparece no card da fonte.
- 🗑️ (lixeira, só DEV) remove a fonte depois de confirmar: some o histórico dela (espelhamento, links vistos);
  sugestões, cupons e posts já agendados continuam. Fica na auditoria como `source.delete`.
- **Postar automaticamente** (na fonte): busca sozinha quando a fila do canal baixa de 2 e manda para a fila o que
  tiver nota ≥ o mínimo (checagem a cada 1–2 min). O intervalo da fonte vira o mínimo entre buscas.
  Acompanhe em **Operação → Filas**.
- **Ordem da fila**: maior nota primeiro (agendado à mão = prioridade máxima). Post automático com 24h na fila expira.
- **Antes de postar** o worker confere o preço na loja (AliExpress): subiu > 2% ou saiu da promoção → post cancelado
  com o motivo ("Oferta expirou…") e a vez passa para o próximo; mudou pouco ou caiu → sai com o preço atual.
  Freios: até 8 posts na fila por canal; sugestão com mais de 12h fica para decisão manual. Cada aprovação automática
  aparece na Auditoria (`suggestion.auto_approve`).

### Conectar a conta que lê outros grupos (uma vez)
1. Conta/chip **dedicado** (não o pessoal). Entre nos grupos privados que quiser usar como fonte.
2. my.telegram.org → API development tools → `TELEGRAM_API_ID` e `TELEGRAM_API_HASH` no `.env`.
3. `docker compose exec -it worker npm run telegram:login -w @cupons/worker` → telefone, código, 2FA → copie `TELEGRAM_USER_SESSION` para o `.env`.
4. `docker compose up -d --force-recreate worker api`.

## Espelhamento de grupo

Nota completa: [[10 - Espelhamento Mercado Livre]]. Resumo:
1. Conta dedicada do Telegram conectada (acima) e **membro** do grupo observado.
2. `npm run ml:login` **na sua máquina**: abre o Google Chrome comum (perfil separado); entre na conta de afiliado.
   Sessão → `data/linker/`. Se o ML disser "limite de tentativas", **pare** e tente de novo horas depois.
3. Conferir: `docker compose exec linker npm run ml:check -w @cupons/linker -- --sessao` (e `-- <meli.la> --gerar`).
4. Canais → canal de destino → **Espelhar grupo** → grupo, tipos de link (**Mercado Livre** e/ou **Amazon**), atraso,
   silêncio → Salvar. Amazon não precisa de login: usa `AMAZON_PARTNER_TAG` do `.env` (troca a tag de quem postou).
   O interruptor **Ativo/Desligado** do card liga/desliga; religar começa da próxima mensagem.
- Alerta vermelho no card/Visão geral = conversão falhou (motivo no texto). Resolva e clique **Dispensar**.
- Sessão do ML expira de tempos em tempos: o card avisa "sessão expirou" → rode `npm run ml:login` de novo.
- Prints das falhas: `data/linker/debug/` (PNG + HTML, os 40 mais recentes). Logs: `docker compose logs -f linker`.

## Grupo de cupons

Nota completa: [[11 - Grupo de Cupons]]. Canais → canal → **🎟️ Grupo de cupons** → grupo (a conta dedicada precisa ser
membro), lojas, e (opcional) **Publicar os cupons neste canal** + intervalo. Acompanhe em **Catálogo → Cupons**:
- ML é testado sozinho (fica na conta de afiliado); "Testar" repete; "Funciona"/"Não funciona" corrige à mão;
  "Usar nos posts" decide se vai junto das ofertas da loja (só cupons gerais vêm marcados).
- Teste manual: `docker compose exec linker npm run ml:check -w @cupons/linker -- --cupom CODIGO`.

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
| Agendado e nada acontece | Worker parado, teto diário (janela **móvel** de 24h), intervalo mínimo ou janela de silêncio | Veja `/stats` no bot e o log do worker; `POSTS_PER_DAY=0` desliga o teto |
| Preço R$ 0,00 / "sem preço" | Scrape bloqueado pela loja | Preencha o preço no painel |
| "Nenhum provider configurado para a URL" | Loja sem credencial no `.env` | Ver [[03 - Credenciais]] |
| Painel: "Muitas tentativas" | 5 senhas erradas em 15 min | Aguarde 15 min (ou reinicie o web em dev) |
| Cliques sempre 0 | `PUBLIC_BASE_URL` vazio → posts usam link direto | Configure domínio/túnel |
| API/painel no Docker: `Can't reach database server at postgres:5432` | Container criado num `up` que falhou (porta ocupada) ficou **sem rede** | Libere a porta e rode `docker compose up -d --force-recreate --no-deps api web` |
| Build do Docker trava em `apt-get` / "Temporary failure resolving" | DNS do host é `systemd-resolved` (127.0.0.53), inalcançável dos containers (comum no Fedora) | Já tratado no compose: build com `network: host` e `dns: [1.1.1.1, 8.8.8.8]` nos serviços |
| Página 500 "Can't resolve './types.js'" | Webpack sem `extensionAlias` | Já corrigido no `next.config.ts` — não remova |
| Espelhamento: "Conta dedicada do Telegram não conectada" | `TELEGRAM_API_ID/HASH/USER_SESSION` vazios | Ver "Conectar a conta que lê outros grupos" |
| Espelhamento: "Sem login"/"sessão expirou" no Mercado Livre | Falta `data/linker/mercadolivre-state.json` ou cookies vencidos | `npm run ml:login` na sua máquina |
| Espelhamento: "Conversor fora do ar" | Container `linker` parado/caído | `docker compose up -d linker`; `docker compose logs linker` |
| Espelhamento: "campo textarea#url-0 não apareceu" / "link curto não apareceu" | ML mudou o gerador | Ver o print em `data/linker/debug/`, ajustar `SELECTORS` em `apps/linker/src/mercadolivre.ts` |
| Espelhamento: "vitrine do afiliado, sem um produto em destaque" | O `meli.la` do grupo era de perfil, não de produto | Normal; nada a fazer (dispense o alerta) |
| Espelhamento Amazon: "falta AMAZON_PARTNER_TAG" | Tag de afiliado vazia no `.env` | Preencher e `docker compose up -d --force-recreate linker api` |
| Espelhamento Amazon: "a Amazon não mostrou o preço" | Tela anti-robô da Amazon | Passa sozinho; se repetir muito, o grupo posta Amazon demais (teto 30/h) |
| Evento "ignorado: não é de um produto" | Link do grupo era Prime/lista/vitrine | Normal, sem alerta |
| Fonte automática demora a repor a fila | "Ofertas por busca / intervalo mín." alto | Use 15 min (padrão ao ligar o automático) |
| FAILED "group chat was upgraded to a supergroup chat" | Grupo virou supergrupo (ex.: ligaram "histórico visível para novos membros") e mudou de ID | Desde 2026-09-26 o sistema troca o ID sozinho e reenvia; o botão "Testar" do canal mostra o ID novo |
| FAILED `CHAT_WRITE_FORBIDDEN` / "not enough rights" | O bot não é administrador (na conversão para supergrupo ele pode perder o cargo) | Tornar o bot administrador com permissão de postar e reativar o canal |
| Novos membros não veem mensagens antigas | Grupo comum esconde o histórico | Configurações do grupo → "Histórico do chat para novos membros: Visível" (vira supergrupo; confira o bot como admin). Canal do Telegram mostra tudo por padrão |
| `ml:login`: "limite de tentativas" | Antifraude do ML (tentativas seguidas ou janela de automação) | Parar, esperar algumas horas; o `ml:login` atual usa o Chrome comum (sem automação) |
| Espelhamento: "Não consegui ler o grupo …" | Conta dedicada não é membro, @ errado ou ID sem cache | Entrar no grupo com a conta; preferir `@usuario` |
