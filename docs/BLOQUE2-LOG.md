# BLOQUE2-LOG — agente vendedor a producción (2026-10-07, UTC)

Ejecución de Bloque 2 (hoja de ruta v2.3, D9 → 10-08 EOD) sobre el scaffold
`stockgapseller` (repo propio `/home/lab-master/stockgap-seller`, HEAD `b3e84a7`).
Zona prohibida intacta: cero toques a `stockgap/**`, `scripts/ship_rows.py`,
crontab ni `config/ingest.env`; cero redeploys de `stockgap-app`.

## 0. Anotación PRE-CODIGO: `MCP_PAY_MODE` de la instancia NF

Regla dura de la interfaz Bloque 2: anotar qué modo corre antes de codificar,
porque el vendedor debe manejar el 402.

- **`MCP_PAY_MODE=free`** — fuente: `stockgap-agent/config/mcp.env:5` (config
  del SHA desplegado `1182690d192bb2994ef907c60d461f401f36f954`).
- **Confirmado en vivo 2026-10-07T03:09Z**: `POST /mcp` `tools/call get_spread`
  contra `https://http--stockgap-app--6h2d2gps9lkr.code.run/mcp` → **HTTP 200**
  (9.154 B, datos vivos del espejo) sin cabecera `x-payment`, sin 402.
- Consecuencia para el código: el seller llama a la upstream **free**, pero el
  camino `HTTP 402` (gate x402/b402 pay-per-call) está **manejado**: cualquier
  402 se convierte en deliverable estructurado `status: "payment_required"`
  (nunca excepción, nunca drop silencioso). Un futuro `MCP_PAY_MODE=b402` no
  rompe el vendedor.

## 1. Interfaz consumida (congelada)

- URL: `STOCKGAP_MCP_URL` → `https://http--stockgap-app--6h2d2gps9lkr.code.run/mcp`.
- Tools (allowlist exacta, `stockgap/mcp_server.py:136-150`):
  `get_spread {token_symbol?}`, `get_cross_issuer {underlying?}`,
  `get_oracle_latest {underlying?}` (`additionalProperties: false` → los args
  se construyen por tool, nunca se reenvía el prompt crudo).

## 2. Cambios de producción (solo repo del vendedor)

- `app/agent/src/sellerCore.ts` — runWork determinista endurecido: timeout
  upstream (`STOCKGAP_MCP_TIMEOUT_MS`, 20 s), manejo 402 → `payment_required`,
  errores de transporte → envoltorio `upstream_error` (el deliverable NUNCA
  lanza), allowlist de tools, sink de evidencia verbatim
  (`SELLER_EVIDENCE_DIR`, alias legado `SPIKE_EVIDENCE_DIR`).
- `app/agent/src/mcpMain.ts` — `GET /health` (readiness probe del contenedor;
  respuesta constante, sin secretos). Sin cambios en la superficie de signing.
- `Dockerfile` + `.dockerignore` — imagen node:22, `node dist/mcpMain.js`
  plano (N15 GO, sin `bag dev`); `.studio/` jamás entra (gitignore +
  dockerignore); keystore vía `WALLET_KEYSTORE_JSON`/`WALLET_PASSWORD`
  (inyección de secretos al arrancar, mismo mecanismo que AWS).
- `app/agent/tests/sellerCore.test.mjs` — tests deterministas del hook
  (happy path, 402, allowlist, transporte) con `node --test` y fetch simulado.

## 3. Wallets D8 (keystores 0600 locales; SOLO direcciones 0x a la wiki)

- **Vendedor** `0x60EAB5FbE65f88abbc5EF49BEac52b4d7Cb8e079` (creada en el
  spike Bloque 0 por `bag wallet new --generate-password`; identidad
  ERC-8004 testnet = **2572 (BSC testnet, chain 97)**). Keystore
  `.studio/wallets/` 0600 (dir 700), gitignored. Su clave va AL ÚNICO secret
  group NF del servicio vendedor (jamás vinculado a `stockgap-app`).
- **Comprador** = wallet fresca generada en este bloque (ver §5) — solo local
  para firmar la demo de pago; jamás executor key ni `MCP_MERCHANT`.
- Toda mención de agent_id ERC-8004 lleva la red `[G3-N24]`.

## 4. Gate de código

Un gate real con el CLI de Claude (`~/.local/bin/claude`, modelo opus), review
verbatim en `docs/reviews/` (no es auto-review). Veredicto en el resumen final.

## 5. Notas de ejecución (cierre de Bloque 2, 2026-10-07)

- **Compradora (D8)**: wallet fresca `0xb9645813b218C573499C5e341BA1DeC6005800ED`
  (keystore 0600 en `/home/lab-master/stockgap-buyer/.studio/wallets/`, password
  0600 en su `.env.local`; **sin fondos todavía**). Vendedora intacta
  `0x60EAB5FbE65f88abbc5EF49BEac52b4d7Cb8e079`.
- **Deploy NF**: servicio `stockgap-seller` (2º servicio del proyecto
  `stockgap`, plan `nf-compute-20` / build `nf-compute-400-16`, Dockerfile del
  repo, rama `main`, auto-CD) → **https://http--stockgap-seller--6h2d2gps9lkr.code.run**
  (MCP en `/mcp`). Secret group `stockgap-seller-secrets` con
  `restrictions.nfObjects=[{id: stockgap-seller, type: service}]` — **jamás
  inyecta en `stockgap-app`** — y `WALLET_KEYSTORE_JSON`/`WALLET_PASSWORD`/
  `STOCKGAP_MCP_URL`. Imagen: multi-stage, base `node:22-bookworm-slim` digest
  pineado, código root-owned read-only, `USER node`, solo `.studio/` escribible.
  **Checkpoint [G3-N15] ✅** — sirviendo `get_spread`.
- **ERC-8004 [G3-N24]**: **mainnet (chain 56) → agent_id `365285`** (wallet
  vendedora, gas sponsored MegaFuel; citar `bag erc8004 show --network
  bsc-mainnet`) · testnet `2572`: `update-endpoint` → URL NF + `/mcp`
  (tx `0x0a89ca5bab0b7ad0c191f24a32fdc076d6bfd01e56b972d529213e973b1a126c`, gas 0).
- **e2e**: tests deterministas **37/37** (`pnpm test`); imagen local: `/health
  {"ok":true}`, gap report real (con y sin filtro), `tool:` desconocida → 400,
  `uid=1000(node)`, código read-only, `STORAGE_LOCAL_PATH` escribible; servicio
  NF público (HTTPS real): mismas 4 verificaciones ✅. Hard rule [G2-N14] ✅ —
  `stockgap-app` `deployedSHA` `1182690d192bb2994ef907c60d461f401f36f954`
  intacto tras cada push (verificado 4 veces).
- **Gates de código** (claude CLI opus, externo, diff completo vs `b3e84a7`;
  verbatims en `docs/reviews/gate{1..10}-bloque2-code-opus.md`): r1
  NEEDS_FIXES(9 hallazgos) → r2(7) → r3(3) → r4(3) → r5(3) → r6(5) → r7(3) →
  r8(3 PARTIAL+4) → r9(round-8 ✅ 4/4; 2 nuevos) → **r10 = ronda final**
  (verdict en `docs/reviews/gate10-bloque2-code-opus.md`). Cada hallazgo se
  arregló en el commit siguiente; nunca hubo pre-aprobación.
- **Residuales ACEPTADOS** (opción del propio revisor, fijados por tests):
  (1) puntuación mixta `NV",'DA` → `NV` (arreglarla rompería el paso válido
  `"NVDA","x"`); (2) escape DENTRO del valor corta en el escape (`NV\nDA` →
  `NV`); escapes = separadores por diseño. Tests "accepted residual…".
- **Bloqueos vivos**: (a) fondos A10 → **ALEX** (faucet Telegram manual — los
  bots no pasan Turnstile; y reposición mainnet de la compradora para la demo
  de pago); (b) **A11** aceptada: cara B402/x402 de pago sin probar (rail de
  cobro = ERC-8183: negotiate → fund → notify_funded → submitResult);
  (c) capturas video/forms [G1-N11] (tx hash, agent ID, registry ID, flujo
  402→pago→informe, `eth_getCode`) y links D4 [G3-N25] = **Bloque 6**.

## 6. Accepted parser residuals (gate-8/gate-9)

Casos que el parser de prompts acepta POR DISEÑO como residuales; fijados por
tests en `app/agent/tests/sellerCore.test.mjs` para que no cambien en silencio:

- `token_symbol: NV\nDA` → `NV`: los escapes literales (`\n`, `\r`, `\t`) son
  SEPARADORES por diseño (permiten prompts multi-clave escapados); un fragmento
  pegado al escape corta el valor ahí. Fijado por el test
  *"accepted residual: an escape INSIDE a value cuts it at the escape (pinned)"*.
- Puntuación mixta `NV",'DA` → `NV`: aceptada; arreglarla rompería el paso
  válido `"NVDA","x"` (separadores JSON entre valores citados). Fijado por el
  test *"gate-8 #1: quote runs cut the value loudly"* y su caso espinoso.
- **Rationale**: los símbolos de ticker nunca contienen backslashes ni comillas
  — cualquier aparición de esos caracteres junto a un valor es puntuación de
  envoltorio (JSON/prosa) o entrada corrupta, nunca parte del símbolo.
