# Compile TypeScript on the host with `pnpm build:cloudflare` first. Runtime-only
# installation avoids shipping the compiler, Docker tools, or platform credentials.
FROM node:22-bookworm-slim
RUN corepack enable && corepack prepare pnpm@10.7.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
COPY apps/server ./apps/server
COPY scripts/cloud-runtime.mjs ./scripts/cloud-runtime.mjs
# better-sqlite3 13 includes Linux N-API prebuilds; no compiler is needed.
RUN pnpm install --prod --ignore-scripts --frozen-lockfile --filter @aituber/server... && pnpm store prune
ENV NODE_ENV=production AITUBER_DATA_DIR=/data AITUBER_PORT=4310
EXPOSE 8080
CMD ["node", "scripts/cloud-runtime.mjs"]
