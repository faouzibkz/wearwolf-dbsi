# Build context is the monorepo root (see docker-compose.yml: context: .)
FROM node:20-bookworm-slim AS base
WORKDIR /app

# Copy only manifests first so `npm install` is cached unless a dependency changes.
COPY package.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/game-engine/package.json packages/game-engine/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm install --no-audit --no-fund

COPY packages/shared packages/shared
COPY packages/game-engine packages/game-engine
COPY apps/server apps/server

WORKDIR /app/apps/server
RUN npx prisma generate

EXPOSE 4000
CMD ["npx", "tsx", "src/index.ts"]
