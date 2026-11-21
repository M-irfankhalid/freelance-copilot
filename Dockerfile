# Single-user Freelance Copilot image. The API serves the built web app from
# the same origin, so one container is all that is needed.

FROM node:22-bookworm-slim AS build

# Build tools are only needed if better-sqlite3 has to compile from source.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@11.22.0

WORKDIR /app

# Install dependencies against the lockfile before copying source so normal
# code changes do not invalidate the expensive install layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter web build \
  && pnpm --filter server build


FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    SERVER_PORT=4000 \
    DATABASE_PATH=/app/apps/server/data/app.db \
    LOG_STDOUT=true

WORKDIR /app

# Runtime only needs the server, its installed dependencies, and the web build.
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist

# unzip is used by the Secure MCP Tunnel client installer.
RUN apt-get update \
  && apt-get install -y --no-install-recommends unzip ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /app/apps/server/data \
  && chown -R node:node /app
USER node

EXPOSE 4000
VOLUME ["/app/apps/server/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.SERVER_PORT || 4000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "apps/server/dist/src/index.js"]
