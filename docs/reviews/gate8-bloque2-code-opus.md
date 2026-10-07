NEEDS_FIXES

**STEP 1: round-7 findings**

1. **PARTIAL.** `app/agent/src/sellerCore.ts:332-333`. The probes you listed are now rejected (NV,,DA, NV;;DA, NV()DA, NV""DA, NV\\DA, get_oracle_latest;;v2). But a run of two or more quotes, or quotes mixed with other punctuation, still cuts the value short without an error. The quote alternative only allows one quote, and the run class doesn't include quotes:
   - `token_symbol: NV"""DA` returns `{token_symbol:"NV"}`
   - `NV"'"DA` returns `NV`
   - `NV",'DA` returns `NV`
2. **PARTIAL.** `app/agent/src/sellerCore.ts:282, 350`. étool, ñunderlying and мtoken_symbol are rejected now. But a combining mark (`\p{M}`) still counts as a key start. In decomposed text (NFD), `cafe\u0301tool: get_oracle_latest` returns `{tool:"get_oracle_latest"}`.
3. **PARTIAL.** `app/agent/src/sellerCore.ts:333`. A key that comes after a literal `\n` is found now, but only when it's the last key. The value before the `\n` is rejected because `\` followed by `n` counts as truncation. So any prompt with two keys separated by a literal escape fails:
   - `tool: get_oracle_latest\nunderlying: NVDA` → `invalid_request: bad tool`
   - `underlying: NVDA\ntool: get_oracle_latest` → `bad underlying`
   - `token_symbol: NVDA\r\n` → `bad token_symbol`

   The tests at `tests/sellerCore.test.mjs:417,422` only check the case where the key comes last.

**STEP 2: findings**

1. [MED] `app/agent/src/sellerCore.ts:282` and `:350`: a literal escape sequence between the key and its value becomes part of the value. The `\s*\\*["']?` after `[:=]` strips the `\` and leaves the `n` in the capture.
   - `token_symbol:\nNVDA` returns `{token_symbol:"nNVDA"}`, a wrong report with no error.
   - Same through the SDK body: `{"prompt":"token_symbol:\\nNVDA"}` gives `nNVDA`.
   - For tool: `tool:\nget_oracle_latest` → `unknown tool nget_oracle_latest`.

   **Fix:** in both regexes, replace the value-side `\s*\\*["']?` with `(?:\s|\\+[nrt])*\\*["']?`. Add tests for `token_symbol:\nNVDA` and `tool:\nget_oracle_latest`.
2. [LOW] `app/agent/src/sellerCore.ts:333`: this is the multi-key failure from round-7 #3 (STEP 1, item 3).

   **Fix:** before the quote-strip on line 332, return early as a separator when `/^\\*["']?\\+[nrt]/.test(rest)`. Ticker symbols never contain a backslash, so this can't hide a truncated value. Add tests for `tool: get_oracle_latest\nunderlying: NVDA` and `token_symbol: NVDA\r\n`.
3. [LOW] `app/agent/src/sellerCore.ts:333`: quote runs cut the value short with no error (STEP 1, item 1).

   **Fix:** change the second alternative from `["']` to `["'\\]+`, i.e. `/^(?:[,;()\[\]{}<>&\\]*|["'\\]+)[A-Za-z0-9._-]/`. JSON separators (`","x"` and `\",\"x\"`) still pass because they start with `,`. Add tests for `NV"""DA` and `NV"'"DA`.
4. [LOW] `app/agent/src/sellerCore.ts:282` and `:350`: combining marks are treated as key starts (STEP 1, item 2).

   **Fix:** add `\p{M}` to both negated classes, i.e. `[^\p{L}\p{M}\p{N}_.\\"'-]` (written with doubled backslashes in the line-350 template string). Add a test for `cafe\u0301tool: get_oracle_latest` → `get_spread`.

`pnpm test`: 31/31 pass on HEAD `1ab9952`. All the cases above come from probe scripts I ran against `dist/sellerCore.js`; none of them are in the test suite yet.
