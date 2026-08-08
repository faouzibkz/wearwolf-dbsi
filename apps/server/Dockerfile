# Build context is the monorepo root (see docker-compose.yml: context: .)
FROM node:20-bookworm-slim AS base
WORKDIR /app

# Prisma's query engine AND schema engine (used by `prisma generate` /
# `prisma db push` / `prisma migrate`) both dynamically link against
# OpenSSL. The bookworm-slim base doesn't ship it, which makes the schema
# engine fail with an empty, undiagnosable "Schema engine error:" — this is
# the fix Prisma's own warning points at.
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Copy only manifests first so `npm install` is cached unless a dependency changes.
COPY package.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/game-engine/package.json packages/game-engine/package.json
COPY packages/rating/package.json packages/rating/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm install --no-audit --no-fund

COPY packages/shared packages/shared
COPY packages/game-engine packages/game-engine
COPY packages/rating packages/rating
COPY apps/server apps/server

WORKDIR /app/apps/server
RUN npx prisma generate

EXPOSE 4000
CMD ["npx", "tsx", "src/index.ts"]
