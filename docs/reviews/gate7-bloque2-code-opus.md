NEEDS_FIXES

**Step 1: round-6 findings**

1. ',' and ';' missing from the tail check: **PARTIAL.** `src/sellerCore.ts:315` now includes `,;`, and `NV,DA`, `NV;DA` and `NVDA,TSLA` are rejected. But `assertFullToken` (`src/sellerCore.ts:334`) still looks only one character past the punctuation, so a doubled separator gets through. See new finding 1.
2. Tool name cut at `\b` and resolved to an allowlisted tool: **RESOLVED** (`src/sellerCore.ts:281-282, 305-309`). `get_spread-v2` and `get_oracle_latest.v2` are now rejected as unknown tools. The same one-character gap does let `tool: get_oracle_latest,,v2` through as `get_oracle_latest` (new finding 1).
3. Only one level of escaping: **RESOLVED** (`src/sellerCore.ts:282, 351`). `\\*` is on both the key side and the value side.
4. Anchor accepted '.' and '"' as key starts: **RESOLVED** for ASCII (`src/sellerCore.ts:282, 351`). Non-ASCII letters still count as key starts (new finding 2).
5. '&' tail broke query-string prompts: **RESOLVED** (`src/sellerCore.ts:333`). `token_symbol=NVDA&tool=get_oracle_latest` is accepted and `NV&DA` is rejected.

**Step 2: new findings**

1. [LOW] `src/sellerCore.ts:334`: the check only tests the single character after the tail. A run of two or more punctuation characters still truncates silently. Probes I ran against the current `dist`:
   - `token_symbol: NV,,DA`, `NV;;DA`, `NV()DA`, `NV""DA` and `NV\\DA` (two backslashes) all return `{token_symbol:"NV"}`.
   - `tool: get_oracle_latest;;v2` returns `get_oracle_latest`.

   Fix:
   - First strip a closing quote from the tail, the same way the key side does: `const rest = prompt.slice(tailAt).replace(/^\\*["']?/, "")`.
   - Then reject when `/^(?:[,;()\[\]{}<>&\\]*|["'])[A-Za-z0-9._-]/.test(rest)`. That means a run of punctuation with no quotes in it, or one bare quote, directly followed by a symbol character.
   - Keep the `&key=` exemption ahead of this check.
   - Valid JSON still passes, at single and double escaping: `"NVDA","x"` and `\\\"NVDA\\\",\\\"x`.
   - Add the probes above as tests.

2. [LOW] `src/sellerCore.ts:282` and `src/sellerCore.ts:351`: the negated class `[^A-Za-z0-9_.\\"'-]` lets non-ASCII letters count as a key start. `étool: get_oracle_latest` is accepted as a tool, and so are `ñunderlying: NVDA` and `мtoken_symbol: NVDA` as filters. This is the same class as round-6 #4. Fix: replace the anchor with a Unicode-aware lookbehind, `(?<![\p{L}\p{N}_.\\"'-])`, and add the `u` flag to both regexes (`iu`).

3. [LOW] `src/sellerCore.ts:282` and `src/sellerCore.ts:351`: the anchor excludes `\`, so a key right after a literal escape sequence is never found. Both `hi\ntool: get_oracle_latest` and the escaped-JSON form `{\"prompt\":\"x\\ntool: get_oracle_latest\"}` return the default `get_spread` with no filter. The buyer silently gets the wrong product, which is the gate-1 #6 class. Round-6 #3 explicitly supports multi-level escaped prompts, which carry literal `\n` and `\t` just as they carry `\"`. Fix: accept an escaped whitespace sequence as a key start, `(?:^|<anchor>|\\[nrt])`, in both regexes, and add a test for each form.

The regexes are not vulnerable to catastrophic backtracking. A 400k-character prompt that is a run of backslashes followed by `tool` and 200k spaces parses in 1 ms. 560k characters of repeated escaped `"tool"` keys parse in 3 ms. 200k characters of a key followed by long whitespace runs parse in 1 ms or less. Empty and end-of-string tokens (`tool:`, `tool: `, `token_symbol: `, `NVDA&`, a trailing `\`) fail closed or are handled correctly. `pnpm test`: 28 pass, 0 fail.
