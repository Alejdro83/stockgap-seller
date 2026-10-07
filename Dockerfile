# StockGap seller agent — production image (Bloque 2, 2026-10-07).
#
# Plain long-lived Node 22 process: `node dist/mcpMain.js` — the N15 GO
# verdict (no `bag dev`, no sidecar, no daemon). Wallet material is NEVER
# baked into the image: `.studio/` is gitignored AND dockerignored; the
# container receives WALLET_KEYSTORE_JSON + WALLET_PASSWORD as secrets at
# start (the same env-injection mechanism used by AWS Secrets Manager
# deploys), and the runtime materializes the keystore 0600 before signing.
FROM node:22-bookworm-slim

WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY app/agent/package.json app/agent/package.json
RUN corepack enable && pnpm install --frozen-lockfile

COPY app/agent ./app/agent
RUN pnpm --dir app/agent build

# The runtime resolves studio.toml and ../../.studio relative to app/agent
# (mirrors run-plain.sh).
WORKDIR /repo/app/agent
ENV AGENT_BIND_HOST=0.0.0.0 AGENT_PORT=8000
EXPOSE 8000
CMD ["node", "dist/mcpMain.js"]
