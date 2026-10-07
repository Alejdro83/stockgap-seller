# SPIKE-LOG — Bloque 0 (Spike) StockGap Agent Studio

Fecha: **2026-10-07 (UTC)** · Repo: `/home/lab-master/stockgap-seller` (git local, commit `9a0c9f3`, **sin push a ningún remote**) · Duración total ≈ 2h10m (timebox 4h) · Todo TESTNET (chain 97). Cero acciones mainnet, cero fondos reales.

---

## 1. TOOLCHAIN

| Herramienta | Versión | Instalación |
|---|---|---|
| Node.js | **v22.22.3** | preexistente (`/home/lab-master/.local/bin/node`) — no se tocó |
| corepack | 0.34.6 | preexistente, `corepack enable` ejecutado |
| pnpm (global) | **12.9.1** | preexistente (toolchain hackathon) |
| pnpm (workspace) | **10.24.0** | pin oficial vía `packageManager` en el scaffold (`"packageManager": "pnpm@10.24.0"`); corepack la descargó al hacer `pnpm install`. Nota DX: la doc oficial pide "Corepack and pnpm 10" — el pin del scaffold manda sobre el pnpm 12 global. |
| Bun | **1.4.2** | user-space `~/.bun/bin/bun` (≥1.3 requerido). El instalador oficial `bun.sh/install` FALLÓ: `error: unzip is required to install bun` (host sin unzip) → workaround: zip de GitHub releases extraído con `zipfile` de Python. |
| `bag` CLI | **0.0.14** | `npm install -g @bnbagent/studio-cli` → `/home/lab-master/.hermes/node/bin/bag` |

### Procedencia del paquete `bag` (verificada ANTES de instalar)

```
$ curl https://registry.npmjs.org/@bnbagent/studio-cli | …
name: @bnbagent/studio-cli
dist-tags: {'latest': '0.0.14'}
homepage: https://github.com/bnb-chain/bnbagent-studio#readme
repository: git+https://github.com/bnb-chain/bnbagent-studio.git (packages/studio-cli)
maintainers: robotbnb@bnbchain.org, devin@bnbchain.org, aiden.c@nodereal.io
```

Coincide con docs.bnbchain.org (`npm install --global @bnbagent/studio-cli`) y bnbchain.org/en/bnb-agent-studio. Scope oficial `@bnbagent`, org `bnb-chain`. Capturas HTML/texto de la doc oficial en `docs/evidence/bnbdoc_*.html|.txt` (quickstart, configuration, deployment, cli-reference, architecture, SDK quickstart-typescript, SDK configuration, SDK networks).

Comandos de instalación (docs quickstart):
```
npm install --global @bnbagent/studio-cli
bag skills install    # skills de IDE (no aplicaba: sin Claude Code/Cursor en este host headless)
```

---

## 2. SCAFFOLD (repo nuevo `/home/lab-master/stockgap-seller`)

```
$ bag init stockgapseller --network bsc-testnet --wallet-kind evm-local \
    --protocols MCP,X402 --rails both --destination self --llm-provider none \
    --no-onboard --no-install --ide claude-code --seller-price-usd 0.10
```
Output (cola):
```
✓ created stockgapseller/  (agentcore/ + app/agent)
  agentcore/    = AgentCore deploy descriptor (self-rendered; `bag deploy --provider aws` uses it)
  app/agent/    = the valuable Agent + SOLE signer (build your value here)
  app/agent/src/mcpMain.ts  = MCP entrypoint (build your value here)
```
Notas:
- `bag init` **rechaza nombres con `-`/`_`/`.`** (nombre = runtime name, ≤23 chars ASCII). El dir se generó como `stockgapseller/` y se movió a `/home/lab-master/stockgap-seller/` (repo git nuevo, `git init` + commit local).
- `--destination self` = "deploys to YOUR own cloud" (flag explícito del CLI v0.0.14) — clave para N15.
- `pnpm install` → "Done in 3.1s using pnpm v10.24.0"; deps: `@bnbagent/studio-runtime@0.0.14`, `@bnbagent/sdk@0.6.0`, express 5, @modelcontextprotocol/sdk, zod, ai.
- `pnpm run build` (tsc) → `app/agent/dist/mcpMain.js` **sin errores** (entrypoint node plano).
- `git init && git add -A && git commit` → `9a0c9f3, 48 files changed` (commit local, SIN remote).

Estructura generada: `agentcore/{agentcore.json,aws-targets.json}`, `app/agent/src/{mcpMain.ts,signing.ts,tools.ts,model.ts,deliveryPolicy.ts,readToolCatalog.ts,requestLimits.ts}`, `app/agent/studio.toml`, workspace root `package.json` + `pnpm-workspace.yaml`, `.studio/` (secretos, gitignored).

---

## 3. IDENTIDAD TESTNET (ERC-8004)

Wallet del vendedor (SOLO dirección pública aquí; clave jamás impresa):
```
$ (cd app/agent && bag wallet new --generate-password)
✓ studio.toml [wallet].address = 0x60EAB5FbE65f88abbc5EF49BEac52b4d7Cb8e079
Password stored (0600): /home/lab-master/stockgap-seller/.studio/.env.local (WALLET_PASSWORD)
Keystore JSON (0600): /home/lab-master/stockgap-seller/.studio/wallets/0x60EAB5FbE65f88abbc5EF49BEac52b4d7Cb8e079.json
```
Keystore Web3 Secret Storage v3 en `.studio/wallets/`, **chmod 600** (dir 700), fuera de `app/agent/` (codeLocation de deploy) y gitignored. `.gitignore` generado lo excluye explícitamente («Never commit .studio/»).

### Registro ERC-8004 en BSC TESTNET

Primer intento FALLIDO (fricción DX — el claim "gas-free" de la docs no aplica al preflight del CLI):
```
$ bag erc8004 register --network bsc-testnet --protocol MCP --endpoint http://localhost:8000/mcp …
error: ERC-8004 register needs gas to broadcast, but 0x60EA… holds only 0 BNB on bsc-testnet (need ~0.002). …
```
Solución encontrada leyendo el código del CLI (`studio-cli/dist/main-ZNJEQYXO.js:24905` `walletSelfPaysGas()`): **`[wallet] gasless = true`** salta el preflight y usa el relay MegaFuel:
```
$ bag config set wallet.gasless true
$ bag erc8004 register --network bsc-testnet --protocol MCP --endpoint http://localhost:8000/mcp --name stockgapseller --description "StockGap seller agent: tokenized-stock spread gap reports (BNB Hack Tokenized Stocks)"
AUDIT {"ts":"2026-10-07T01:53:03.490Z","op":"8004_register","status":"submitted","chain_id":97,"agent_addr":"0x60EAB5FbE65f88abbc5EF49BEac52b4d7Cb8e079",…}
AUDIT {"ts":"2026-10-07T01:53:21.879Z","op":"8004_register","status":"confirmed","chain_id":97,"context":{"name":"stockgapseller","protocol":"MCP","agent_id":2572},…}
registered: agent_id=2572
```

- **agent_id (BSC testnet): `2572`** · wallet `0x60EAB5FbE65f88abbc5EF49BEac52b4d7Cb8e079`
- Verificación on-chain posterior:
```
$ bag erc8004 show
agent_id:  2572
address:   0x60EAB5FbE65f88abbc5EF49BEac52b4d7Cb8e079
agent_uri: data:application/json;base64,eyJkZX...MSJ9
$ bag erc8004 resolve 2572
data:application/json;base64,eyJkZX...MSJ9
```
- **tx hash: NO expuesto.** El relay MegaFuel devuelve la confirmación sin superficie de tx hash: el AUDIT registra `tx_hash: null` en submitted y confirmed (`bag audit ls`: `8004_register submitted (gas)` / `8004_register confirmed (gas)`). El estado on-chain del registro sí está verificado (`show`/`resolve` hacen eth_call contra el registry). El endpoint registrado es `http://localhost:8000/mcp` (placeholder local del spike; `bag erc8004 update-endpoint` lo fijará al desplegar).

---

## 4. WIRE DE NUESTRO MCP (`POST /mcp`, `get_spread`) — E2E REAL

Target vivo: StockGap local (FastAPI `scripts/dashboard.py` en `:8098`, ledger `data/spread_ticks.db` 2.7 GB con ticks reales). Forma exacta del tool (de `stockgap/mcp_server.py:180-215` y `tests/test_mcp.py:42`):

```
POST /mcp  Content-Type: application/json
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_spread","arguments":{"token_symbol":"…(opcional)"}}}
```

Wiring (en nuestro repo, permitido por diseño — "the only file you normally need to edit is the runWork hook"):
- `app/agent/src/sellerCore.ts` (NUEVO): `runWork` determinista (sin LLM, sin precios, sin firma) → `callGetSpread()` hace el POST anterior contra `STOCKGAP_MCP_URL` (default `http://localhost:8098/mcp`) y devuelve el informe; cada llamada queda en `docs/evidence/spike/get_spread_calls.jsonl` **verbatim** (request + response crudos).
- `app/agent/src/mcpMain.ts` (2 líneas): `const runWork = buildRunWork()` (LLM) → `const runWork = sellerRunWork` en `main()`. Compila con tsc limpio.

### Llamada end-to-end REAL (capturada 2026-10-07T01:49:04.545Z)

Ruta completa: `POST /x402` (face pública del runtime del vendedor, free-route) → `B402Seller.handle` → `sellerCore.runWork` → **`POST http://localhost:8098/mcp` `tools/call get_spread`** → StockGap responde con datos vivos → deliverable JSON devuelto al cliente (HTTP 200, 10768 bytes).

REQUEST crudo hacia StockGap (verbatim, idéntico al guardado en `docs/evidence/spike/get_spread_calls.jsonl`):
```json
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_spread","arguments":{}}}
```

RESPONSE crudo de StockGap (verbatim, 9122 chars; primeros 700):
```json
{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"{\"metric\": \"spread_bps_real\", \"tick_ts\": \"2026-10-07T01:48:33.012Z\", \"rows\": [{\"token_symbol\": \"SILon\", \"underlying_ticker\": \"SIL\", \"platform_id\": \"ondo\", \"token_price\": 85.1110333298628, \"reference_price\": 85.029326, \"market_status\": \"overnight\", \"open_state\": 1, \"metric_bps\": -183.1452816493575}, {\"token_symbol\": \"REGNon\", \"underlying_ticker\": \"REGN\", \"platform_id\": \"ondo\", \"token_price\": 733.0299189334145, \"reference_price\": 731.65931, \"market_status\": \"overnight\", \"open_state\": 1, \"metric_bps\": -105.35003319880327}, {\"token_symbol\": \"IWNon\", \"underlying_ticker\": \"IWN\", \"platform_id\": \"ondo\", \"token_price\": 214.29004367260197, \"reference_price\": 211.205882, \"market_status\": \"overnight\", \"open_state\": 1, \"metric_bps\": -94.92651281228717}, …
```
HTTP crudo del cliente (cabeceras): `HTTP/1.1 200 OK` · `Content-Type: application/json` · `Content-Length: 10768`. Body: `{"result":"{\"service\":\"stockgap-gap-report\",\"prompt\":\"StockGap gap report for NVDA\",\"upstream\":{\"url\":\"http://localhost:8098/mcp\",\"httpStatus\":200,\"result\":{…get_spread response…}}}"}`.

Faces del runtime servidas (misma prueba): `POST /mcp initialize` → 200 SSE con `mcp-session-id` (stateful) · `tools/list` → 17 tools (negotiate, notify_funded + 15 read-only chain) · `/x402` operativo.

---

## 5. N15 — VEREDICTO GO/NO-GO: ¿proceso node/bun plano y long-lived SIN `bag dev`?

## **VEREDICTO: GO**

Pregunta N15 (gate G1): ¿el scaffold corre como un proceso node/bun plano y long-lived en un contenedor genérico, SIN `bag dev`, con el keystore desde env/secret? **SÍ — probado dos veces.**

Evidencia:

1. **Entrypoint real identificado.** `app/agent/package.json`: `"dev": "tsx src/mcpMain.ts"`, `"build": "tsc -p tsconfig.json"`. `tsc` produce `app/agent/dist/mcpMain.js` (CommonJS/ESM node puro). `mcpMain.ts` declara `main()` = express escuchando en `AGENT_BIND_HOST:AGENT_PORT` (default `0.0.0.0:8000`) con `/mcp` (streamable HTTP stateful) y `/x402`. No hay sidecar, daemon ni túnel: **un solo proceso node**.

2. **Lanzado SIN `bag dev`** mediante `./run-plain.sh` → `exec node dist/mcpMain.js` (evidencia de supervivencia: `ps -o pid,etime,cmd` → `4011654 04:16 node dist/mcpMain.js`). Proceso definitivo run #1: arrancado **01:49:04Z**, sirviendo peticiones reales (e2e `get_spread` a las 01:49:04, probes 200 a las 01:52:08 y 01:54:04) = **≥5 min sirviendo**. Run #2 (post-cambio de config) igualmente estable >5 min (`ss -ltnp` → `node pid=4011654` en :8000, `initialize` 200 sostenido). Ninguna llamada a `bag dev` en ninguna de las dos carreras.

3. **Keystore desde env/secret (prueba limpia).** Antes de arrancar se MOVIÓ `.studio/wallets/` fuera del proyecto (`.studio/wallets.offline-keystore/`) para simular un contenedor sin material en disco. El proceso recibió **`WALLET_KEYSTORE_JSON`** (JSON crudo del keystore, path de fichero fuente `WALLET_KEYSTORE_FILE`) + **`WALLET_PASSWORD`** (desde `.studio/.env.local`, cargado por el launcher, jamás en argv). Al arrancar, `ensureKeystoreMaterialized()` (runtime `chunk-VVNTBRAE.js:314`; `KEYSTORE_JSON_ENV="WALLET_KEYSTORE_JSON"` línea 59) materializó el keystore en `.studio/wallets/0x60EA….json` con `-rw-------` (0600) y el proceso firmó con él (negotiate → `provider_sig` EIP-191 real). **Mismo mecanismo que el deploy AWS** («Keystore injected via AWS Secrets Manager as `WALLET_KEYSTORE_JSON`» — doc Deployment), o sea: env/secret injection es el camino oficial de runtime, no una parcheada. Para un contenedor genérico/Northflank bastaría: `node dist/mcpMain.js` + Node 22 + `WALLET_KEYSTORE_JSON`/`WALLET_PASSWORD` como secretos + `STOCKGAP_MCP_URL`. `loadRuntimeSecrets()` (BNBAGENT_RUNTIME_SECRET_ID → AWS Secrets Manager) es opcional y solo para AWS.

4. **Firma operativa en el proceso plano**: la cita ERC-8183 firmada (§7) la produjo el proceso node plano (run #2) — EIP-191 `provider_sig 0xfe1bd271…39c01b` verificable contra `0x60EA…e079`. El proceso contiene y usa la clave sin `bag dev`.

Condiciones/matices del GO (para el plan Bloque 2 → 2º servicio Northflank):
- `bag dev` **no envuelve nada necesario**: es un atajo que corre este mismo runtime localmente («bag dev runs the same single runtime locally» — doc Deployment). Lo que `bag dev` aporta es solo conveniencia (carga de config, puertos).
- Lo que SÍ hay que proveer fuera de `bag dev`: `WALLET_KEYSTORE_JSON` + `WALLET_PASSWORD` (secrets), `STOCKGAP_MCP_URL`, y (opcional) `AGENT_PORT/AGENT_BIND_HOST`. `bag deploy --provider aws/azure/bnb` son los targets gestionados; para self-host el flag `--destination self` existe en `bag init` y `bag deploy package` genera `dist/`.
- Caveat de cara a NF: **2º servicio = plan/coste del tier existente** (mismo plan free/hobby de NF, sin coste nuevo identificado) y su propio grupo de secretos NUNCA linkeado a `stockgap-app` (regla D8). La imagen solo necesita Node 22 (Bun 1.4.2 también vale como runtime, pero lo probado es node).
- Fricción DX registrada (material para el DX Report): la pieza frágil fue el estado del proceso/pid al reiniciar (matar el wrapper no mata al hijo node → proceso viejo siguió sirviendo con config vieja; `ss -ltnp` para encontrar el pid real).

---

## 6. N19 — EXIT-CHECKS

### (a) ¿ERC-8183 / x402 en chain 56 (BSC MAINNET)? → **SOPORTADO, con evidencia de fichero y de docs**

Evidencia de fichero (SDK instalado en el scaffold), `app/agent/node_modules/@bnbagent/sdk/dist/chunk-OXNQ6HN7.js` (fuente `src/networks/addresses.ts`):
```js
var BSC_MAINNET_CHAIN_ID = 56;
var RAW = {
  [BSC_TESTNET_CHAIN_ID]: { paymentToken: "0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565", … commerceProxy: "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de", routerProxy: "0xd7d36d66d2f1b608a0f943f722d27e3744f66f25", policy: "0xd6a4217588f6b1f5657a92a3e94e6422ad771cea" },
  [BSC_MAINNET_CHAIN_ID]: {
    paymentToken: "0xcE24439F2D9C6a2289F741120FE202248B666666",
    treasury:    "0x000000000000000000000000000000000000dEaD",
    commerceProxy: "0xea4daa3100a767e86fded867729ae7446476eba6",
    commerceImpl:  "0xd5f9b570c96b5d67702d508c0bfb8b3b09209787",
    routerProxy:   "0x51895229e12f9876011789b04f8698af06ccd6da",
    routerImpl:    "0xf0cf8f47e5c035f16247ff16e9f367e477ee5007",
    policy:        "0x9c01845705b3078aa2e8cff7520a6376fd766de5" }
};
```
Es decir: **contratos ERC-8183 (AgenticCommerce/EvaluatorRouter/OptimisticPolicy) + token de pago U (United Stables, EIP-3009) desplegados y referenciados para chain 56**. `dist/networks/index.d.ts`: «…commerce/router/policy proxies on bsc-testnet (97) and bsc-mainnet (56)… BSC_MAINNET_CHAIN_ID = 56». El flujo x402 (b402 seller rail) resuelve settlement assets por red incl. bsc-mainnet (runtime `dist/b402/index.cjs`: payloads EIP-3009/Permit2, `resolveX402SettlementAsset(networkName,…)`). El scaffold acepta `--network bsc-mainnet` (`bag init --help`, choices `["bsc-testnet","bsc-mainnet"]` — con `--destination self` obligatorio para mainnet). Docs: «Supported networks: BSC Testnet 97 · BSC Mainnet 56» (https://docs.bnbchain.org/developer-kit/bnbagent-sdk/networks/, capturada en `docs/evidence/bnbdoc_sdk_networks.*`; fuente de direcciones upstream: https://github.com/bnb-chain/apex-contracts#deployments). Matiz honesto: en este spike TODO corrió en 97; mainnet 56 queda para Bloque 3 (D8: wallet nueva, ≤10 USD, executor ≠ merchant ≠ vendedor).

### (b) ¿Qué necesita el COMPRADOR del pago demo? (SOLO requisitos)

- **Wallet fresca en BSC testnet (chain 97)** — distinta de la del vendedor, del executor y de `MCP_MERCHANT` (regla D8/N19).
- **Token de pago: U (TEST_U)** `0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565`, 18 decimales, **≥ el precio de la cita** (dust: 0.1 U = `100000000000000000` atomic units para nuestro precio de $0.10). Allow-list del vendedor: `U/USDC/USDT` (TEST_* en testnet).
- **Gas**: tBNB para `createJob/registerJob/fund` O dependencia del paymaster MegaFuel (gas-free documentado para **ERC-8004**; la patrocinación de llamadas ERC-8183 «depends on the paymaster policy» — no garantizada). El pago en sí (escrow `fund`) transfiere el token de pago — EIP-3009 firmado por el comprador.
- **Plazos**: `expiredAt` del job debe superar `disputeWindow + margen` (SDK `client.createJob` lanza si no); el settlement lo dispara el comprador (approve/reject/dispute) o `bag erc8183 settle --job-id N` tras la ventana.
- Demo vendedor: `notify_funded` con el `job_id` (verifica la cita firmada → produce el deliverable `get_spread` → `submitResult` on-chain).
- Evidencia empírica del requisito mínimo (intento real abortado en funding, output verbatim §7).

---

## 7. ECONOMÍA TESTNET (factura + dust swap + verify)

### ✅ Factura testnet OBTENIDA — cita ERC-8183 firmada por la wallet del vendedor (proceso node plano)

`tools/call negotiate` (términos: deliverables + quality_standards + currency = dirección del token) → sobre firmado (guardado verbatim en `docs/evidence/spike/negotiate_envelope.json` y `negotiate_invoice_raw*.txt`):
```json
{"request":{"task_description":"StockGap gap report for NVDA","terms":{"deliverables":"JSON gap report","quality_standards":"verbatim rows","evaluation_required":true,"evaluator_type":"uma_oov3","currency":"0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565"}},
 "request_hash":"0xba78d2346307e04f050dbc091668a82edeba0431ed5bd5f0feb21976b476c356",
 "response":{"accepted":true,"terms":{"…","price":"100000000000000000","currency":"0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565"},"estimated_completion_seconds":600,"quote_expires_at":1791339062,"negotiated_at":1791338162},
 "response_hash":"0x1ec74d7d55294b13f0e191556bc64d448f29eb7377b6cb12d0fa563635aefacb",
 "negotiation_hash":"0x84d785e2ec63f8ba98bfa9789ae1ba28d058e7413fca5b33388f6e876cb50d3a",
 "provider_sig":"0xfe1bd271f24c8fd7fc8e2180bff7c89b638109e4d093ee692722d7d11b20d7427e5a6391b3ebd85405f071107044d0a2e69167f05deee3918c59151bb4f939c01b",
 "chain_id":97,"verifying_contract":"0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE"}
```
(0.1 U dust, TTL 900 s, evaluator `uma_oov3`, precio fijo determinista desde studio.toml — el LLM no toca precios ni firma.)

### ❌ Dust swap / pago: BLOQUEADO en funding (ver §8). Intento real y fallo verbatim:

```
$ bag erc8183 buy --provider 0x60EAB5FbE65f88abbc5EF49BEac52b4d7Cb8e079 \
    --quote-json docs/evidence/spike/negotiate_envelope.json \
    --task "StockGap gap report for NVDA" --budget-usd 0.10 --network bsc-testnet
error: Insufficient U balance on bsc-testnet.
network:           bsc-testnet
selected_asset_id: TEST_U
selected_asset:    U
token_address:     0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565
decimals:          18
required:          0.1 (100000000000000000 atomic)
current:           0 (0 atomic)
funding_hint:      U testnet funding options: https://docs.bnbchain.org/bnb-smart-chain/developers/faucet/
Studio did not switch assets or pay.
```
Nota: la verificación de la cita firmada PASÓ (el flujo llegó hasta el escrow) — el cuello de botella es únicamente el faucet.

### ✅ Verify

- `bag erc8004 show` / `resolve 2572` → registro ERC-8004 legible on-chain (eth_call al registry) con agentURI.
- `bag audit ls` → traza `8004_register submitted/confirmed` (chain_id 97).
- Identidad técnica en nuestras respuestas: `X-ERC8004-Identity` del propio StockGap sigue siendo `REGISTRY_PLACEHOLDER` (zona prohibida — sin tocar `stockgap-agent`); el ID ERC-8004 del **vendedor** (2572) es el artefacto nuevo del spike.

---

## 8. BLOQUEANTES / FRICCIONES (todo con timestamp, material DX Report)

1. **Faucets tBNB/U inaccesibles en automatización** (≈30 min, luego timebox cortado):
   - Faucet oficial https://www.bnbchain.org/en/testnet-faucet: dos widgets de captcha (Turnstile) y botón «Send» **deshabilitado hasta resolverlos** — no se salta protección anti-bot. Además anuncia «0.002 BNB on BSC Mainnet is needed for test funding» (gate de saldo mainnet) y el click no emitía red.
   - U faucet https://united-coin-u.github.io/u-faucet: exige **wallet inyectada en el navegador** («Connect Wallet») — sin extensión de wallet en el harness.
   - Telegram `@bnbchain_official_bot` / Discord: interacción manual del operador (no automatizable).
   - `bag wallet fund` (da tBNB + U): exige `bag platform login` = **GitHub device flow** (código de un solo uso + login GitHub en navegador); el vault no tiene credenciales de GitHub y no se piden contraseñas. → SALTO.
2. **Tx hash del registro ERC-8004 no expuesto** por el relay MegaFuel (AUDIT `tx_hash: null`). El registro es verificable on-chain (`show`/`resolve`) pero no hay hash citable para los forms. Mitigación posible: lectura de logs del Identity Registry por la dirección (no hecha, fuera de timebox).
3. **Contradicción doc/CLI "gas-free"**: los docs dicen «Registration is gas-free on BSC Testnet via MegaFuel paymaster sponsorship», pero `bag erc8004 register` exige ~0.002 tBNB de saldo salvo que `studio.toml [wallet] gasless = true` (no lo pone el scaffold ni la doc del quickstart). Resuelto con la clave de config (leída del código del CLI).
4. **Bun**: el instalador oficial requiere `unzip` (ausente en el host) — workaround con zipfile de Python.
5. **`bag init` rechaza nombres con separadores** — el nombre = runtime name; dir renombrado después (documentado arriba).
6. **Rail x402 pagado "dormant" sin credenciales de comerciante B402** («partial B402 configuration; paid x402 rail will remain dormant until all merchant credentials are configured» — se emiten «per B402 environment» en `.studio/.env.local`; no disponibles en el spike). El modo FREE (`price_usd = "0"`, «free-route») sí funciona end-to-end (§4). Para cobros reales vía x402 hay que obtener esas credenciales — decisión para Bloque 3 (el rail ERC-8183 funciona sin ellas).
7. **Quirk negotiate**: `terms.currency` acepta la **dirección** del token (`0xc70B…5565`); con alias `"U"`/`"TEST_U"` el seller responde `0x06 Requested payment token is unavailable`. Y el verificador del comprador (`bag erc8183 buy --quote-json`) exige `request.terms.currency` presente («quote request currency is missing» si falta). Coste ≈15 min de DX.
8. **ps/grep de procesos poco fiables en este host** (mató al wrapper y no al node) — usar `ss -ltnp` para el pid real.

---

## 9. RESUMEN EJECUTIVO

- Toolchain: Node v22.22.3 · pnpm 12.9.1 (global) / 10.24.0 (pin del scaffold) · Bun 1.4.2 · bag 0.0.14 (procedencia verificada `bnb-chain/bnbagent-studio`).
- Scaffold `stockgapseller` en repo nuevo `/home/lab-master/stockgap-seller` (commit local `9a0c9f3`, sin remoto).
- **agent_id ERC-8004 en BSC testnet: 2572** (wallet `0x60EAB5FbE65f88abbc5EF49BEac52b4d7Cb8e079`; tx hash no expuesto por el relay).
- E2E real `get_spread` a través del runtime del vendedor (§4, request/response verbatim).
- **N15: GO** — runtime = proceso node plano `node dist/mcpMain.js`, long-lived ≥5 min, keystore desde `WALLET_KEYSTORE_JSON`/`WALLET_PASSWORD`, sin `bag dev` (§5).
- N19: (a) ERC-8183/x402 **SOPORTADO en chain 56** con contratos desplegados referenciados por el SDK (§6a); (b) requisitos del comprador documentados (§6b).
- Economía testnet: **factura firmada ✅**, **dust swap ❌ (faucet bloqueado)**, verify ✅.
