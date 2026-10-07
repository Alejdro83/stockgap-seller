NEEDS_FIXES

**STEP 1: round-3 findings**

1. RESOLVED. `Dockerfile:34-37` sets `ENV STORAGE_LOCAL_PATH=/repo/.studio/agent-data`, runs `mkdir -p` on it and `chown -R node:node /repo/.studio`, and checks both directories with `su node … test -w`. The runtime reads exactly this variable (`studio-runtime/dist/chunk-QBWUZ63F.js:626`, `process.env.STORAGE_LOCAL_PATH || ".agent-data"`). The SDK then sets that directory to 0700 (`sdk/dist/chunk-QTRTDIUU.js:61`), which works because `node` owns it. `studio.toml` contains no storage key that would override it.
2. RESOLVED. `app/agent/src/sellerCore.ts:323-329` matches only the first key occurrence and validates the whole token. I ran it against the built `dist`: `NVDA.` is rejected, `1INCH token_symbol: NVDA` is rejected, and `BRK.B` and `NVDA.US` are accepted.
3. RESOLVED, with one leftover covered in finding 2 below. `app/agent/src/mcpMain.ts:722-731` runs the full `parseRequest` before `seller.handle`. `flatQuery` (`mcpMain.ts:215-221`) drops non-string query values, and the `typeof req.query.prompt === "string"` check drops the same ones. So an array prompt like `?prompt=a&prompt=b` is treated as missing by both sides and can't slip past the check.

**STEP 2: new findings**

1. [MED] `app/agent/src/sellerCore.ts:281` and `sellerCore.ts:323`: if the prompt is written as JSON, the request silently falls back to the default report. Both `TOOL_RE` and the filter regex need `:`/`=` straight after the key, so a closing quote after the key stops the match. I checked against `dist`:
   - `{"tool":"get_cross_issuer","underlying":"NVDA"}` parses to `{"tool":"get_spread","args":{}}`.
   - `"token_symbol": "NVDA"` also parses to an unfiltered `get_spread`.

   Agents are likely to send JSON-shaped prompts. The buyer pays and gets the wrong, unfiltered report. Round 2 (#5) already decided that a bad request must not silently produce a different report, and this breaks that rule.
   - **Fix:** in both regexes, allow an optional quote after the key and around the value: `\b${key}["']?\s*[:=]\s*["']?([^\s,;"'}]*)` and `/\btool["']?\s*[:=]\s*["']?([a-z_][a-z0-9_]*)\b/i`. Add tests for the two JSON-shaped prompts above.

2. [LOW] `app/agent/src/sellerCore.ts:356-366`: `resolveSellPrompt` doesn't fully match the SDK's `promptFrom` (`studio-runtime/dist/b402/index.js:625-637`):
   - The SDK uses `query.prompt` whenever it is defined, even if it's `""`. The pre-check skips an empty query prompt and validates the body instead.
   - When the body parses as JSON but has no string `prompt`, the SDK uses `""`. The pre-check validates the raw body instead.

   This doesn't let invalid requests through, but it gives false 400s. For example, `{"prompt":null,"note":"tool: x"}` gets `invalid_request: unknown tool x`, even though the SDK would never read that text. The code comment says it "mirrors the SDK", which isn't quite true.
   - **Fix:** copy `promptFrom` exactly: return `queryPrompt` when it is `!== undefined`; for JSON bodies, return `parsed.prompt` only if it's a non-array object with a string `prompt`, otherwise `""`; use the raw body only if `JSON.parse` throws. Then return `null` (no 400) when the trimmed prompt is empty and let the SDK handle it.

3. [LOW] `app/agent/src/sellerCore.ts:323`: the value is cut only at whitespace, `,`, `;` and `"`, so punctuation stuck to a valid symbol makes the whole request fail. `spread for (token_symbol: NVDA)` throws `bad token_symbol` (checked against `dist`), and so do `'NVDA'`, `NVDA)` and `NVDA}`. That's a 400 for a valid request in normal prose.
   - **Fix:** add `'()[]{}<>&` to the excluded set (`[^\s,;"'()\[\]{}<>&]*`). Keep rejecting a trailing `.`/`-`, and add a test for the parenthesised case.

`pnpm test` in `app/agent`: 17 passed, 0 failed.
