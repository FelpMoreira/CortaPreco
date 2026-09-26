# Syntax moderna do Docker (suporte a heredoc/cache de BuildKit)
# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base

# O Prisma precisa do OpenSSL em runtime (a imagem slim não traz libssl)
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copia manifests antes do código p/ aproveitar cache do npm ci
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages

# Instala TODAS as workspaces (inclui devDeps: tsx/next dev)
RUN npm ci --no-audit --no-fund

# Gera o Prisma Client do monorepo dentro da imagem (env só para o CLI, sem segredo)
ENV DATABASE_URL=postgresql://cupons:cupons@postgres:5432/cupons?schema=public
RUN npx prisma generate --schema packages/db/prisma/schema.prisma

# Modo dev padrão: os comandos rodam via docker-compose.yml
ENV NODE_ENV=development
ENV NEXT_TELEMETRY_DISABLED=1

# ------------------------------------------------------------------ linker
# Conversor de links do espelhamento (cofre/10): precisa de um navegador de verdade.
# Chromium na MESMA revisão do pacote `playwright` do package-lock + libs do sistema.
FROM base AS linker
RUN npx playwright install --with-deps chromium && rm -rf /var/lib/apt/lists/*

# ------------------------------------------------------------------ app (padrão)
# Última etapa = alvo padrão do `docker compose build` (api, web, worker, bot, db-init).
FROM base AS app
