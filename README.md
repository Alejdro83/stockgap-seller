# StockGap Seller

A BNB Agent Studio **seller agent** for [StockGap](https://github.com/Alejdro83/stockgap-agent), built for **BNB Hack: Tokenized Stocks Edition** (track *Tokenized Stocks Products & Agents*).

It sells StockGap's tokenized-stock price-gap reports to other agents. Each request is turned into a `get_spread` / `get_cross_issuer` / `get_oracle_latest` call against StockGap's MCP server, and the answer comes back as a gap report. Pricing and signing live in deterministic code; no LLM touches prices or signatures (`llm.provider = "none"`).

## Identity (ERC-8004)

| Network | agent_id | Notes |
|---|---|---|
| **BSC mainnet (chain 56)** | **365285** | owner is the seller wallet `0x60EAB5FbE65f88abbc5EF49BEac52b4d7Cb8e079`; `tokenURI` points to the production endpoint |
| BSC testnet (chain 97) | 2572 | spike/dev registration |

Check it with `bag erc8004 show --network bsc-mainnet`.

## Live endpoint

Production (Northflank): `https://http--stockgap-seller--6h2d2gps9lkr.code.run`

```bash
curl -s https://http--stockgap-seller--6h2d2gps9lkr.code.run/health      # {"ok":true}
# MCP face (streamable HTTP): POST /mcp  (tools: negotiate, notify_funded, read-only chain tools)
# Deliverables: GET /erc8183/job/<id>/response
```

The paid rail is **ERC-8183** (the `/x402` route is dormant: no B402 merchant credentials). Flow: `negotiate` (seller-signed quote in U) → buyer `bag erc8183 buy --provider 0x60EAB5FbE65f88abbc5EF49BEac52b4d7Cb8e079 --quote-json <quote> --network bsc-mainnet` → `notify_funded` → the seller submits the report on-chain.

## Mainnet evidence

Job **56937** on BSC mainnet: a real 0.10 U payment through this agent, delivered and hashed on-chain. Hashes and the honest log of what failed first: [docs/evidence/mainnet-job-56937](./docs/evidence/mainnet-job-56937/NOTES.md). Settlement is optimistic (about 7 days), so the funds are still in escrow.

## Current status (honest)

- The deployed seller runs on **BSC mainnet** (`price_usd = "0.10"`, asset U). One real job was paid through it and delivered (job 56937, above).
- The job is **not settled**: the buyer can settle only after the optimistic dispute window (~7 days), so the 0.10 U is still in escrow.
- `/x402` is dormant (no B402 merchant credentials); payments use ERC-8183 only.
- Deliverables are stored on the container's local disk and are served by `/erc8183/job/<id>/response`; they do not survive a redeploy.
- StockGap's own x402 gate has a separate mainnet pay-per-call run: [`docs/evidence/prueba2`](https://github.com/Alejdro83/stockgap-agent/tree/master/docs/evidence/prueba2).

## Layout

- `app/agent/` — the agent and sole on-chain signer (TypeScript, `src/`; `sellerCore.runWork` builds the report).
- `docs/BLOQUE2-LOG.md`, `SPIKE-LOG.md` — build logs; `docs/reviews/` — external code-review gates (gate 12: APPROVED); `docs/evidence/` — captures.
- `Dockerfile` — multi-stage, digest-pinned `node:22-bookworm-slim`, runs as `USER node`.
- `.studio/` — keystore and secrets, **gitignored, never committed**.

## Run locally

```bash
corepack enable && pnpm install
cd app/agent && pnpm test            # 37 deterministic tests
STOCKGAP_MCP_URL=https://http--stockgap-app--6h2d2gps9lkr.code.run/mcp ../../run-plain.sh
```

`run-plain.sh` needs a wallet keystore under `.studio/` (`bag init`); without one the agent will not start. Docker: `docker build -t stockgap-seller .`

## License

MIT, see [LICENSE](./LICENSE).
