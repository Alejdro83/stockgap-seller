#!/usr/bin/env bash
# N15 proof: run the seller as a PLAIN long-lived node process — NO `bag dev`.
# Secrets come from env/secret material only (never argv, never logged):
#   WALLET_KEYSTORE_JSON  raw keystore JSON (deploy: AWS Secrets Manager style)
#   WALLET_PASSWORD       keystore unlock password
# Optional:
#   STOCKGAP_MCP_URL      our StockGap MCP endpoint (default http://localhost:8098/mcp)
#   SPIKE_EVIDENCE_DIR    verbatim request/response evidence sink
#   AGENT_PORT / AGENT_BIND_HOST  (default 0.0.0.0:8000)
set -euo pipefail
cd "$(dirname "$0")/app/agent"

if [ -z "${WALLET_KEYSTORE_JSON:-}" ]; then
  if [ -n "${WALLET_KEYSTORE_FILE:-}" ]; then
    WALLET_KEYSTORE_JSON="$(cat "$WALLET_KEYSTORE_FILE")"
    export WALLET_KEYSTORE_JSON
  else
    echo "FATAL: set WALLET_KEYSTORE_JSON or WALLET_KEYSTORE_FILE" >&2
    exit 1
  fi
fi

if [ -z "${WALLET_PASSWORD:-}" ] && [ -f ../../.studio/.env.local ]; then
  set -a
  # shellcheck disable=SC1091
  . ../../.studio/.env.local
  set +a
fi

export STOCKGAP_MCP_URL="${STOCKGAP_MCP_URL:-http://localhost:8098/mcp}"

exec node dist/mcpMain.js
