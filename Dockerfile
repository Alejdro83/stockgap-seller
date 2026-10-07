# syntax=docker/dockerfile:1
# StockGap seller agent — production image (Bloque 2, gate-1 + gate-2 fixes).
# Multi-stage: devDependencies stay in the build stage; the runtime stage
# ships only the deploy snapshot (dist/ + pruned prod node_modules) and runs
# as the unprivileged `node` user (gate-1 finding 5). The shipped code stays
# root-owned and read-only; only the keystore-materialization dir is writable
# by `node` (gate-2 findings 2 and 3).
#
# Base pinned by digest — node:22-bookworm-slim manifest-list digest resolved
# from Docker Hub on 2026-10-07:
#   sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392
FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS build
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY app/agent/package.json app/agent/package.json
RUN corepack enable && pnpm install --frozen-lockfile
COPY app/agent ./app/agent
RUN pnpm --dir app/agent build \
  && pnpm --filter stockgapseller-agent deploy --legacy --prod /out \
  && test -f /out/dist/mcpMain.js \
  && test -f /out/studio.toml \
  && test ! -e /out/dist/dist

FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392
ENV NODE_ENV=production
WORKDIR /repo/app/agent
COPY --from=build /out ./
# Only the keystore-materialization dir (workspace-root .studio/) is writable
# by the runtime user; `dist/`, `node_modules/` and `studio.toml` keep
# root-owned read-only permissions (gate-2 finding 2).
RUN mkdir -p /repo/.studio/wallets && chown -R node:node /repo/.studio
USER node
ENV AGENT_BIND_HOST=0.0.0.0 AGENT_PORT=8000
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.AGENT_PORT||8000}/health`).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/mcpMain.js"]
