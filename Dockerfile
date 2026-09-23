# Syntax moderna do Docker (suporte a heredoc/cache de BuildKit)
# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim

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