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
curl -s "https://http--stockgap-seller--6h2d2gps9lkr.code.run/x402?prompt=get_spread"   # gap report
# MCP face (streamable HTTP): POST /mcp
```

## Current status (honest)

- The deployed seller currently runs in **free mode** (`price_usd = "0"`, testnet assets in `app/agent/studio.toml`); the mainnet paid flow through this agent is **not** switched on.
- The **mainnet pay-per-call** evidence lives in the main repo, through StockGap's own x402 gate: tx [`0x656e0477…957d`](https://bscscan.com/tx/0x656e0477b5fa3cb0f470c56ef6ec7eb9709047163ae303efb9bcc0a66645957d), see [`docs/evidence/prueba2`](https://github.com/Alejdro83/stockgap-agent/tree/master/docs/evidence/prueba2).
- An ERC-8183 negotiation was signed on testnet; the funded `bag erc8183 buy` was not completed.

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
