# Production-like images for a local preview (compose.preview.yaml).
# The API runs its TypeScript source with Node type stripping. Workspace
# packages stay symlinks to packages/, because Node does not strip types
# under node_modules.

FROM node:26-alpine AS base
WORKDIR /app
RUN npm install --global pnpm@12.18.0

FROM base AS install
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

FROM install AS web-build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter "./apps/web" build

FROM base AS api
ENV NODE_ENV=production
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --prod
COPY packages/db packages/db
COPY packages/shared packages/shared
COPY apps/api/src apps/api/src
USER node
EXPOSE 3000
CMD ["node", "apps/api/src/server.ts"]

FROM caddy:2-alpine AS web
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=web-build /app/apps/web/dist /srv
