# Mainnet ERC-8183 job 56937 — paid through the seller agent (BSC, chain 56)

Date: 2026-10-08 (UTC). Buyer pays 0.10 U (United Stables) to the StockGap Seller; the seller delivers an on-chain-hashed gap report.

| Step | Tx / value | Status |
|---|---|---|
| Quote (seller-signed, EIP-191) | `negotiate` via MCP, price `100000000000000000` (0.1 U), chain 56, verifying contract `0xEa4DAa3100A767e86FDed867729ae7446476EBA6` | accepted |
| Create job | [`0xcc9af2f8…3f6c`](https://bscscan.com/tx/0xcc9af2f8f76cb4c9ea0e7f785b3fbfd9238c1fb9dc9e0287a625f8ac51b33f6c) | ok |
| Register policy | [`0x47c43fbf…5779`](https://bscscan.com/tx/0x47c43fbf35db7b97271d8322ae86ffa7d54f304741fb7a0377951c3a6a615779) | ok |
| Set budget | [`0xec95f051…a227`](https://bscscan.com/tx/0xec95f051000fa400cf0eb0fc188d33b78e4421f8459e16a374de02b1c052a227) | ok |
| Fund (0.10 U into escrow) | [`0x6e366044…04fd`](https://bscscan.com/tx/0x6e366044d302dd45e89c63b1ed88018df837ff47f1d5bd83c4f62ce2d90504fd) | ok |
| Seller submits deliverable | [`0x73b3a2f4…e0dd`](https://bscscan.com/tx/0x73b3a2f41971f0b1292e2642122ede6e5bebaec6d61294f0fac77998a9fde0dd) (block 126535244, status 0x1) | ok |

- Buyer: `0xEC629448D495242a2e61B5EaB7746a474e6E1BB0` · Seller / provider: `0x60EAB5FbE65f88abbc5EF49BEac52b4d7Cb8e079` (ERC-8004 agent #365285).
- Job status read with `bag erc8183 status 56937 --network bsc-mainnet`: `SUBMITTED`, settlement mode `optimistic`, deliverable `0xa651c4b4…e60f`, URL `https://http--stockgap-seller--6h2d2gps9lkr.code.run/erc8183/job/56937/response` (HTTP 200, copy in `deliverable.json`).
- **Not settled yet**: in optimistic mode the buyer can `settle` only after the dispute window (about 7 days from submission, `settle_available_at` 1792108421). The 0.10 U stays in escrow until then; the seller is not paid before that.

## What it took (honest log)
- Job 56933 (first attempt) was funded but the seller could not publish the deliverable: `Cannot publish deliverable: storage returned a non-public URL and ERC8183_AGENT_URL is not set`. Fixed by setting `ERC8183_AGENT_URL` and adding the read-only route `GET /erc8183/job/:id/response` (commit `6cf8abd`). By then the 600 s submit window had passed, so 56933 stays funded and undeliverable (refundable after expiry). Jobs 56925, 56932 and several others were created and left empty after hangs.
- Root cause of the hangs: `bag` (viem) defaults to `bsc-rpc.publicnode.com`, and its connection stalls intermittently. Running with `RPC_URL=https://bsc-dataseed1.bnbchain.org` finished the purchase in 8 seconds. Public RPCs also reject `eth_getLogs` ranges, which breaks `bag erc8183 list`.
- The seller wallet needs a little BNB for gas on mainnet; the registration was sponsored, the delivery was not (0.0003 BNB sent from the buyer).
