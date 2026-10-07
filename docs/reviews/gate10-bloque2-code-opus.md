NEEDS_FIXES

**Step 1: round-9 findings**

1. MED, uppercase `\N`/`\R`/`\T` eating ticker letters: **RESOLVED.** `app/agent/src/sellerCore.ts:284-290` (TOOL_RE) and `:363-366` (parseFilter) now use only the `u` flag with `ci()` keys, so `\\[nrt]` / `\\+[nrt]` only match lowercase. I ran these against the build:
   - `token_symbol: \NVDA` → `NVDA`
   - `toKen_Symbol=\tRIVN` → `RIVN`
   - `x\Ntool: get_cross_issuer` → get_spread, no tool selected
   - `token_symbol: NVDA\NFOO` → `bad token_symbol` (rejected loudly)
   - `TOKEN_SYMBOL: NVDA` and `Tool: get_oracle_latest` still match case-insensitively
   - `tool: GET_CROSS_ISSUER` is still accepted, because the value is lowercased at `:314`
2. LOW, an escape inside a value cuts it short: **PARTIAL.** The pinned test exists at `app/agent/tests/sellerCore.test.mjs:453-461`. But neither residual is written up in `docs/BLOQUE2-LOG.md`. The file is 67 lines, has no "residual", `NV\nDA` or `NV",'DA` entry, and was last changed in `cf6b383`; there's no uncommitted change to it either. Option B was "document + pin", and so far only the pin exists. The test comment at `:455-456` also points readers to that missing doc entry.

**Step 2: final check**

- `ci()`: the keys `tool`, `token_symbol` and `underlying` have no regex metacharacters, and `_` expands to `[__]`, which is valid under the `u` flag. The value and allowlist regexes don't depend on the `i` flag, and the escape separator at `:340` was already lowercase-only.
- Side effect of dropping `i`/`u` folding: Unicode lookalikes such as `tokenſymbol` (long s) no longer match a key. That's stricter, so it's fine.
- `pnpm test`: 37 pass, 0 fail.

**Findings**

1. [LOW] `docs/BLOQUE2-LOG.md` (missing section; referenced from `app/agent/tests/sellerCore.test.mjs:455`): the two accepted residuals are claimed as documented but aren't. Fix: add a short "Accepted parser residuals (gate-8/gate-9)" section to `docs/BLOQUE2-LOG.md` covering:
   - `token_symbol: NV\nDA` → `NV`: escapes are separators by design, pinned by the test at `:453`.
   - The mixed-punctuation run `NV",'DA`: accepted, with a pointer to its test.
   - The rationale: ticker symbols never contain backslashes or quotes.

   Commit it with the test-comment reference left as is.
