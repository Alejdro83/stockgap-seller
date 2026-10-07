NEEDS_FIXES

**STEP 1 — Round-2 findings**

1. **RESOLVED.** `app/agent/src/sellerCore.ts:112` adds the typed `InvalidRequestError`, and `:350` adds `classifyDeliveryError`. In `app/agent/src/mcpMain.ts:513-520` the mapping sits after the `DeliveryTimeoutError` and `SubmitPermanentlyUnsupportedError` branches. That order is correct: `runWork` never wraps either of those types, and an abort still reaches the timeout branch first. Tests are at `tests/sellerCore.test.mjs:348`. No test drives `buildMcpServer` end to end; I accept that.
2. **RESOLVED as written, but it causes a regression.** `Dockerfile:27,31`: the shipped code is root-owned and only `/repo/.studio` is chowned. See fresh finding 1.
3. **RESOLVED.** `Dockerfile:18-22`: the `cp` lines are gone and `test ! -e /out/dist/dist` is added.
4. **RESOLVED.** `tests/sellerCore.test.mjs:201` covers the body cap. `new Response(Uint8Array)` has no `content-length` (I checked: `null`), so the streaming path really runs, and the header path is tested separately. `tests/sellerCore.test.mjs:239` covers the evidence cap. It is valid because `recordEvidence` is awaited (`sellerCore.ts:224`) and the cap check is `size > 5 MiB` on a pre-filled file of 5 MiB + 1 + row bytes.
5. **RESOLVED, with a regression.** `sellerCore.ts:319-326`: `1INCH` and `ABCDEFGHIJKL-X` now throw. See fresh finding 2.
6. **RESOLVED.** `sellerCore.ts:266`, test at `tests/sellerCore.test.mjs:137`.
7. **PARTIAL.** `mcpMain.ts:724` / `sellerCore.ts:336`: the pre-check scans the raw body, but the SDK reads the prompt from somewhere else. See fresh finding 3.

**STEP 2 — Fresh findings**

1. **[MED] `Dockerfile:26-31`: the runtime can no longer write ERC-8183 deliverables.**
   - `studio.toml` sets `[storage] kind = "local"` and no platform credentials are set, so `resolveStorageMode` returns `byos`.
   - `StudioLocalStorageProvider.fromEnv()` then writes to `process.env.STORAGE_LOCAL_PATH || ".agent-data"` (`@bnbagent/studio-runtime/dist/chunk-QBWUZ63F.js:626`). Relative to the cwd that is `/repo/app/agent/.agent-data`.
   - `WORKDIR` and `COPY` leave that directory root-owned, so `USER node` gets `EACCES` inside `signing.submitResult`. A funded job then does the work, fails at upload, and falls into the generic `protocolFailure` retry. That is the same retry-until-escrow-expiry behavior round 2 fixed, now reached by a different path.
   - Round 1 hid this because `chown -R /repo` made everything writable.
   - **Fix:** add `/repo/app/agent/.agent-data` to the `mkdir -p` / `chown` line, or set `ENV STORAGE_LOCAL_PATH=/repo/.studio/agent-data`. Add a build-stage or smoke guard that the `node` user can write there, e.g. `su node -s /bin/sh -c 'test -w …'`.

2. **[LOW] `sellerCore.ts:324`: a sentence-ending period is now accepted as part of the symbol.**
   - Because `.` is in the value class and the negative lookahead forbids stopping before it, `token_symbol: NVDA.` captures `NVDA.` (I checked). The old `\b` would have backtracked to `NVDA`. The upstream filter then gets `NVDA.`, which is wrong.
   - Separately, when the key appears twice, a bad first value is skipped silently: `token_symbol: 1INCH token_symbol: NVDA` gives `NVDA`, because `keyHit` and `exec` look at different occurrences.
   - **Fix:** require that the value does not end in `.` or `-`, e.g. `([A-Za-z](?:[A-Za-z0-9._-]{0,10}[A-Za-z0-9])?)(?![A-Za-z0-9._-])`. Anchor the value check to the first key occurrence: run one regex with `([^\s,;"]*)` after the key, then validate the captured token in full against `^[A-Za-z](?:[A-Za-z0-9._-]{0,10}[A-Za-z0-9])?$`. Add a test for the trailing period.

3. **[LOW] `mcpMain.ts:724` / `sellerCore.ts:336`: the pre-check does not see the prompt the SDK actually uses.**
   - The SDK's `promptFrom` (`studio-runtime/dist/chunk-NODAFSUU.js:1045`) reads `query.prompt` first, then the JSON-decoded `body.prompt`, then the raw body.
   - The pre-check runs `TOOL_RE` only on the raw body. These all bypass it:
     - `GET /x402?prompt=tool:%20drain_wallet` (the query is never checked);
     - `{"prompt":"tool:\ndrain_wallet"}` (a JSON escape the raw regex can't see; I checked: no match, but the decoded prompt throws);
     - `{"meta":"tool: get_spread","prompt":"tool: drain_wallet"}` (the first match is in the wrong field).
   - All three still end in a generic 500. In paid mode, payment settles before work (`studio.toml` b402 comment), so they would be charged.
   - Malformed filters (finding 5) are not pre-checked at all.
   - **Fix:** in the handler, mirror `promptFrom`: use `request.query.prompt`, else the parsed `body.prompt` if it is a string, else the raw body. Call `parseRequest(prompt)` on it inside `try`, and answer 400 `{error:"invalid_request"}` on `InvalidRequestError`. Drop the raw-body `TOOL_RE` scan. Add tests for the query, escaped-newline and multi-field cases.
