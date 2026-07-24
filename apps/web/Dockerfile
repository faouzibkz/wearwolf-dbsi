# Build context is the monorepo root (see docker-compose.yml: context: .)
FROM node:20-bookworm-slim AS base
WORKDIR /app

COPY package.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/game-engine/package.json packages/game-engine/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm install --no-audit --no-fund

COPY packages/shared packages/shared
COPY apps/web apps/web

ARG NEXT_PUBLIC_SERVER_URL=http://localhost:4000
ENV NEXT_PUBLIC_SERVER_URL=$NEXT_PUBLIC_SERVER_URL

WORKDIR /app/apps/web
RUN npm run build

EXPOSE 3000
CMD ["npm", "run", "start"]
