# bloqueadores — estado 2026-10-07 (UTC)

Captura de los bloqueadores vivos del proyecto StockGap (hackatón BNB Hack: Tokenized Stocks Edition, lock 2026-10-11 12:00 UTC). Fuentes citadas verbatim: `stockgap-agent/docs/SUBMISSION_CHECKLIST.md` §3 (filas ASK-OPERATOR), `stockgap-seller/SPIKE-LOG.md` §5, y la hoja de ruta interna del proyecto (wiki, 2026-10-07).

## Vivos (bloquean submission o alcance)

| # | Bloqueador | Owner | Fallback / nota |
|---|-----------|-------|-----------------|
| A1 | Equipo: nombre real, rol y contacto por persona (campos de equipo en ambos forms) | operador | ❓ BLOCKING según checklist — sin esto no se rellenan los forms |
| A2 | Wallet BNB en HEX (`0x…`) para el campo wallet / posible payout de premio | operador | ❓ BLOCKING según checklist |
| A6 | Wording del paper ITSC (qué se puede claim sobre https://thoracic.clinic/articles/itsc-qs4nqr) | operador | solo aparece en la hoja de ruta interna; sin confirmación no se cita |
| A7 | Host del video (¿YouTube?) para sustituir `VIDEO_URL` | operador | ❓ BLOCKING según checklist |
| A9 | Abrir el form real de submission y anotar las opciones REALES de track | operador | gate de D1/A4: la web muestra track único, el form puede diferir |
| A10 | Faucets testnet solo pasan a mano (0.1 U + ~0.002 tBNB para la wallet compradora) | solo Alex | los bots no pasan Turnstile — verbatim SPIKE-LOG §5 abajo |
| A11 | Credenciales de comerciante B402 («issued per B402 environment») para el rail x402 pagado | operador | sin ellas el cobro va por ERC-8183/x402 del SDK (el b402 de Binance sigue sin comercio provisionado: code `100001008`) |
| G3-N15 | Checkpoint **10-08 EOD**: el 2º servicio NF debe estar sirviendo `get_spread` | Alex (operador) / verificación LISA | si no: rama NO-GO — vendedor local para la grabación, evidencia = vídeo + repo con instrucciones, **sin URL viva del vendedor** (aceptado explícitamente) |

## Cerrados / moot

- **A8 — oracle on-chain writer: ✅ RESOLVED (2026-10-03)** — verbatim checklist: «real BSC **mainnet** publish — `PriceRegistry` `0x8d2cf4a56f754d5770985d95aa179ef4d5b9b971`, deploy tx `0x2235be2b…afa1` (block 125562365), publish tx `0x8055d62e…7cec` (block 125562760, event `OraclePublish`)». Prueba on-chain en `chain56_contracts.{json,txt}` (mismo directorio).
- **A3 / A4 / A5** = decisiones (D2 tagline, D1 track, D4 public-flip), no bloqueos técnicos.

## Citas verbatim

SPIKE-LOG.md §5 — faucets inaccesibles a automatización (A10):

> 1. **Faucets tBNB/U inaccesibles en automatización** (≈30 min, luego timebox cortado):
>    - Faucet oficial https://www.bnbchain.org/en/testnet-faucet: dos widgets de captcha (Turnstile) y botón «Send» **deshabilitado hasta resolverlos** — no se salta protección anti-bot. Además anuncia «0.002 BNB on BSC Mainnet is needed for test funding» (gate de saldo mainnet) y el click no emitía red.
>    - U faucet https://united-coin-u.github.io/u-faucet: exige **wallet inyectada en el navegador** («Connect Wallet») — sin extensión de wallet en el harness.

SUBMISSION_CHECKLIST.md:67 — rail b402 sin comercio (A11):

> the Binance /api/v2/b402/{supported,verify,settle} adapter ships mock-tested (the live API account has no b402 merchant provisioned: code 100001008)

SUBMISSION_CHECKLIST.md:94-99 — filas ASK-OPERATOR BLOCKING:

> | A1 | Team members | Real name, role, contact (email/handle) per team member — for the team fields in both forms | ❓ BLOCKING |
> | A2 | BNB wallet (HEX) | Wallet address in HEX (0x…) for the wallet field / potential prize payout | ❓ BLOCKING |
> | A7 | Video host | Where to upload the recording (YouTube?) so `VIDEO_URL` can be filled | ❓ BLOCKING |
