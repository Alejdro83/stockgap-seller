NEEDS_FIXES

STEP 1 — round-8 findings (`pnpm test`: 35/35 pass; I also ran each probe against the built `dist/sellerCore.js`)
1. RESOLVED (`src/sellerCore.ts:339`): `NV"""DA`, `NV"'"DA` and `NV",,DA` all now return `invalid_request: bad token_symbol`. `NV",'DA` still returns `NV`, which is the accepted residual you listed. I am not re-reporting it.
2. RESOLVED (`src/sellerCore.ts:282`, `:356`): `cafe\u0301tool: get_oracle_latest` is no longer read as a key. It falls back to `get_spread` with no args.
3. RESOLVED (`src/sellerCore.ts:333`): `tool: get_oracle_latest\nunderlying: NVDA` returns `get_oracle_latest {underlying:"NVDA"}`, and `token_symbol: NVDA\r\n` returns `NVDA`.
4. RESOLVED (`src/sellerCore.ts:282`, `:356`): `token_symbol:\nNVDA` returns `NVDA`, and `tool:\nget_oracle_latest` returns `get_oracle_latest`.

STEP 2 — new findings
1. [MED] `src/sellerCore.ts:282` and `src/sellerCore.ts:356`: both regexes use the `i` flag, so the new value-side gap `\\+[nrt]` also matches uppercase `\N`, `\R` and `\T`. A lone backslash before a ticker that starts with N, R or T is therefore read as an escape sequence, and the ticker loses its first letter without any error:
   - `token_symbol: \NVDA` returns `VDA`
   - `token_symbol:\TSLA` returns `SLA`
   - `token_symbol: \RIVN` returns `IVN`

   `validateSellRequest` returns `null` (valid) for `{"prompt":"token_symbol: \\TSLA"}`, so the request is paid for and returns the wrong report. Tickers starting with any other letter work: `\AAPL` returns `AAPL`.

   **Fix:** make the escape letters lowercase-only in both regexes while keeping key matching case-insensitive. Use `(?:\s|\\+(?-i:[nrt]))*` (Node ≥ 23 supports regex modifiers), or spell it out as `\\+[\n\r\t]`-style literal lowercase alternatives and drop the `i` flag from just those parts. Apply the same to the key-anchor alternative `\\[nrt]`. Add tests that `token_symbol: \NVDA` and `token_symbol:\TSLA` are rejected or return the full ticker.
2. [LOW] `src/sellerCore.ts:333`: the escape-separator early return lets a literal escape inside a value cut it short without any error:
   - `token_symbol: NV\nDA`, `NV\tDA` and `NV\r\nDA` all return `NV`
   - `NV"\nDA` and `NV\\nDA` (double backslash) also return `NV`

   Treating `\n` as a separator is the intended design. But a bare symbol fragment directly before it (no space) together with letters directly after it is the same truncation pattern the earlier rounds reject.

   **Fix:** before the early return, reject when `rest` matches `/^\\*["']?\\+[nrt][A-Za-z0-9._-]/` and the captured token is shorter than 3 characters. Or simpler, document it as a residual next to the accepted `NV",'DA` edge and add a test that pins the behaviour.
