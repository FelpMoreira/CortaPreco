# 08 — Segurança

## O que proteger

| Ativo | Se vazar/abusar |
|-------|-----------------|
| Painel / `ADMIN_API_KEY` | Qualquer um publica no canal em seu nome |
| `TELEGRAM_BOT_TOKEN` | Controle total do bot e do canal |
| Credenciais de afiliado | Links com o tracking de outra pessoa, perda de comissão |
| Redirector `/c/` | Cliques falsos distorcem métricas; abuso de carga |

## Acesso ao painel (por usuário)

- Uma conta por pessoa (`AdminUser`). Perfis: **DEV** (tudo + usuários + auditoria) e **GERENTE** (operação).
  A checagem de perfil é na **API** (guard em toda rota `/api/*`), não só no menu.
- Senha: `scrypt` (N=2^15), mínimo 12 caracteres, bloqueia senhas óbvias/que contêm o e-mail.
- Bloqueio: 5 senhas erradas → conta travada 15 min (no banco); limite por IP no Next e na API.
  Mensagem genérica e tempo de resposta igual para e-mail inexistente.
- Sessão no servidor (`AdminSession`): token aleatório de 256 bits no cookie (`HttpOnly`, `SameSite=Strict`,
  `Secure` + `__Host-` em produção); no banco só o SHA-256. Cai após 2h sem uso ou 12h no total.
  Logout revoga; trocar senha derruba as outras sessões; desativar/mudar perfil derruba todas.
- Senha provisória (criada por DEV ou pelo script) obriga troca no 1º acesso — nada abre antes.
- Sempre sobra pelo menos um DEV ativo. Auditoria (`AuditLog`) de logins, falhas, bloqueios, usuários e ações.
- Criar/redefinir acesso pelo terminal: `npm run admin:create -w @cupons/api -- --email ... --name ... [--role GERENTE] [--reset]`.

## Controles implementados

**Painel (web)**
- Middleware exige sessão em `/admin/*` e `/api/*` (exceto login/logout). Rotas novas nascem protegidas.
- **CSRF:** escrita em `/api/*` só com `Origin` igual ao host.
- Proxy `/api/admin/*` só repassa uma **allowlist** de método + rota para a API.
- `lib/api.ts` é `server-only`: a chave nunca vai pro bundle do navegador.
- Cabeçalhos: CSP (`frame-ancestors 'none'`, `object-src 'none'`), `X-Frame-Options: DENY`, `nosniff`,
  `Referrer-Policy`, `Permissions-Policy`, HSTS em produção; `/admin` com `noindex`.
- Preview da mensagem renderiza só tags de formatação sem atributos (`telegramToSafeHtml`) — sem XSS.

**API**
- Toda `/api/*` exige `Bearer ADMIN_API_KEY` (comparação em tempo constante), exceto `/api/health` e `/api/public/*`.
- Sem CORS: navegador não chama a API direto.
- Schemas JSON em todas as entradas (ids no formato cuid, preços > 0, `additionalProperties: false`, tamanhos máximos).
- Rate limit: 300/min por IP geral; 120/min no `/c/` (folgado por causa de CGNAT de operadora móvel).
- Erro 5xx responde "Erro interno" — detalhes só no log.
- Preview só busca URLs de lojas conhecidas (provider identifica pelo host) → sem SSRF para rede interna.

**Configuração**
- Em produção a API **não sobe** com `ADMIN_API_KEY` < 32 ou `PUBLIC_BASE_URL` sem https;
  o painel não abre com `JWT_SECRET` < 32 nem aceita `ADMIN_PASSWORD` < 12.

## Riscos aceitos (por enquanto)

- Rate limit do login em memória — vale para uma instância só do web.
- `script-src 'unsafe-inline'` na CSP (exigência do Next sem nonce). Melhorar com nonce se houver conteúdo de terceiros.
- Alerta do `npm audit` no PostCSS embutido no Next: roda só no build com o nosso CSS; resolver quando migrar para Next 16.

## Checklist de lançamento

- [ ] `ADMIN_API_KEY` com `openssl rand -hex 32`; cada pessoa com o próprio usuário (sem conta compartilhada)
- [ ] `NODE_ENV=production` em todos os processos
- [ ] HTTPS no site e no domínio do `/c/`; `PUBLIC_BASE_URL` com `https://`
- [ ] Proxy expõe da API **só** `/c/*` e `/api/public/*`
- [ ] `TRUST_PROXY=true` (apenas se estiver atrás de proxy)
- [ ] Postgres e Redis **sem porta aberta** para a internet; senha do Postgres trocada (padrão é `cupons`)
- [ ] Backup do Postgres agendado
- [ ] `.env` com permissão `600` no servidor
- [ ] `npm audit` revisado
- [ ] Bot: `TELEGRAM_ADMIN_IDS` só com ids de quem administra
