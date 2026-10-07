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

## 5. Notas de ejecución (se completa al cerrar el bloque)

- (se rellena con wallet compradora, deploy NF, registro mainnet, e2e y
  bloqueos vivos)
