NEEDS_FIXES

STEP 1 — round-4 findings
1. MED, JSON-shaped prompts: **RESOLVED**. The quote-tolerant `TOOL_RE` is at `app/agent/src/sellerCore.ts:281` and the filter regex at `app/agent/src/sellerCore.ts:324-327`. Probes confirm `{"tool":"get_cross_issuer","underlying":"NVDA"}` and `{"prompt":"gap","token_symbol":"NVDA"}` now parse with their filters, and the tests at `app/agent/tests/sellerCore.test.mjs:379-389` pass.
2. LOW, `resolveSellPrompt` diverged from the SDK: **RESOLVED**. `app/agent/src/sellerCore.ts:365-384` now matches `promptFrom` in `@bnbagent/studio-runtime/dist/b402/index.cjs:2548` line for line, including the empty-body case. The empty-prompt passthrough at `app/agent/src/sellerCore.ts:350` runs after the rate limiter in `app/agent/src/mcpMain.ts:715`, so every request is still counted. The SDK then sends an empty prompt to the 402 challenge, or returns missing-prompt when a credential is present. Requests with repeated or bracketed `?prompt=` give the same result in both paths, because `flatQuery` drops non-string values and the validator does too.
3. LOW, prose punctuation: **RESOLVED**. The tokens `(token_symbol: NVDA)` and `'NVDA'` parse, and `NVDA.` is still rejected.

`pnpm test`: 20 pass, 0 fail.

STEP 2 — fresh findings
1. [LOW] `app/agent/src/sellerCore.ts:324-327`. The new excluded characters (`"'()[]{}<>&`) end the value **silently**. This breaks the gate-3 #2 rule that the raw token is "captured whole and validated in full". Verified with probes:
   - `token_symbol: NV"DA` returns `{token_symbol:"NV"}`
   - `token_symbol: NV'DA` returns `NV`
   - `token_symbol: NV&DA` returns `NV`
   - `token_symbol: TSLA(ON)` returns `TSLA`

   Each one is a wrong filtered report that gets signed as completed work.
   **Fix:** after `exec`, read `prompt[hit.index + hit[0].length]`. If it is one of the excluded punctuation characters and the next character matches `[A-Za-z0-9._-]`, throw `InvalidRequestError("invalid_request: bad ${key}")`. Equivalently, append the lookahead `(?![\"'()\[\]{}<>&][A-Za-z0-9._-])` to the regex and throw when it fails. Add tests for the four inputs above.
2. [LOW] `app/agent/src/sellerCore.ts:281` and `:325`. Backslash-escaped JSON still falls back silently to the default unfiltered report. This is the same class as round-4 #1, which this round only fixed for unescaped quotes. A raw body `{\"tool\":\"get_cross_issuer\",\"underlying\":\"NVDA\"}` is invalid JSON, so the SDK uses it as the raw-body prompt. Probe result: `{"tool":"get_spread","args":{}}`. An ERC-8183 job description carrying double-encoded JSON hits the same path.
   **Fix:** allow an optional backslash before each quote in both regexes: `tool\\\\?["']?\s*[:=]\s*\\\\?["']?` and `${key}\\\\?["']?\\s*[:=]\\s*\\\\?["']?`. Also add `\\` to the value's excluded characters so finding 1's check covers it. Add a test for the escaped prompt above.
3. [LOW] `app/agent/src/sellerCore.ts:281`. `\btool` matches the end of any key that ends in a hyphen followed by `tool`. Probe: `{"x-tool":"get_oracle_latest"}` returns `tool: get_oracle_latest`, so an unrelated key or prose such as `multi-tool: get_oracle_latest` switches the paid tool.
   **Fix:** anchor the key to a real start, `(?:^|[^A-Za-z0-9_-])["']?tool["']?\s*[:=]…`, and anchor the filter key at `:325` the same way (`(?:^|[^A-Za-z0-9_-])${key}`). Add a test that `{"x-tool":"get_oracle_latest"}` returns `get_spread`.
