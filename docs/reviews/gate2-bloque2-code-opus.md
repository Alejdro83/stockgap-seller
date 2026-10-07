NEEDS_FIXES

**STEP 1 — Round-1 findings**

1. RESOLVED: `app/agent/src/sellerCore.ts:326-337` throws `GapReportError` on every non-ok status. In `mcpMain.ts:418-505`, the throw from `runWork` reaches the catch before `signing.submitResult` runs. That catch calls `protocolFailure`, so an error payload is never submitted. Tests cover 402 (`tests/sellerCore.test.mjs:72`), transport error (`:92`) and isError (`:112`).
2. RESOLVED: `sellerCore.ts:256`, test at `tests/sellerCore.test.mjs:112`.
3. RESOLVED: `sellerCore.ts:194` rethrows `signal.reason`, and `sellerCore.ts:197-198` maps a timeout to `"timeout"`. Tests at `:134` and `:156`.
4. RESOLVED: `sellerCore.ts:87` and `:324` use a constant `source` label, and the URL only goes into the evidence sink (`:205`). Test at `:63-65`.
5. PARTIAL: `Dockerfile:10-31` is multi-stage and runs as non-root `USER node`. But `chown -R node:node /repo` (`:30`) makes the runtime user the owner of its own code, and it ships a duplicate `dist/dist`. See fresh findings 2 and 3.
6. RESOLVED: `sellerCore.ts:280-294`, tests at `:185` and `:225`.
7. RESOLVED (untested): `sellerCore.ts:126-149` and `:184-188`. No test covers it; see fresh finding 4.
8. RESOLVED (untested): `sellerCore.ts:52` and `:231-235`. No test covers it; see fresh finding 4.
9. RESOLVED: `.dockerignore:9` and `Dockerfile:10,23`.

**STEP 2 — Fresh findings**

1. [MED] `app/agent/src/mcpMain.ts:505` (together with `sellerCore.ts:285` and `:337`): every `runWork` failure, including permanent ones, ends up in `protocolFailure`. That returns the generic "seller operation failed; retry later". So a funded job whose spec has `tool: <unknown>` or an invalid request is told to retry forever until the escrow expires.
   - **Fix:** in the `notify_funded` catch, add a branch before `protocolFailure`. Return `toolResult({status:"rejected", job_id, reason:"invalid_request"})` for an `invalid_request` error; give it a typed `InvalidRequestError` class in `sellerCore`. Return `toolResult({status:"retry", job_id, reason: e.report.status})` for a `GapReportError`. Add a test that drives `buildMcpServer({runWork})` with a throwing stub.

2. [MED] `Dockerfile:30`: `chown -R node:node /repo` gives the unprivileged runtime user write access to `dist/`, `node_modules/` and `studio.toml`. That undercuts the point of dropping root. In the built image `stockgap-seller:bloque2`, `stat` shows `node` owns `dist/mcpMain.js`. The command also adds a 193 MB layer that duplicates `node_modules`, according to `docker history`.
   - **Fix:** keep the copied files owned by root and read-only: `COPY --from=build /out ./`. Then `RUN mkdir -p /repo/.studio && chown node:node /repo/.studio`, so `node` owns only the directory where the keystore is materialized.

3. [LOW] `Dockerfile:18` with `app/agent/package.json:7-10`: `pnpm deploy` already copies `dist/` because of the `"files"` field. `cp -r app/agent/dist /out/dist` then copies into the existing directory, producing `/out/dist/dist`. This is confirmed in the image. The `test -f /out/dist/mcpMain.js` guard passes on the deploy copy, so it hides the mistake.
   - **Fix:** remove the `cp -r app/agent/dist` line, or use `cp -r app/agent/dist/. /out/dist/`. Add `&& test ! -e /out/dist/dist` to the guards.

4. [LOW] `app/agent/tests/sellerCore.test.mjs`: there are no tests for the body size cap (#7) or the evidence sink (#8).
   - **Fix:** add a test that returns a `Response` over 1 MiB, both with and without a `content-length` header, and asserts `GapReportError` with `response_too_large`. Add a test that sets `SELLER_EVIDENCE_DIR` to a temp dir, pre-fills the file past 5 MiB, and asserts no further rows are appended.

5. [LOW] `app/agent/src/sellerCore.ts:290-294`: when the filter key is present but its value doesn't match the regex, the filter is silently dropped. That happens for a symbol starting with a digit (e.g. `token_symbol: 1INCH`). Values longer than 12 characters are also truncated at a `.` or `-` boundary: `ABCDEFGHIJKL-X` becomes `ABCDEFGHIJKL`. The paid buyer then gets an unfiltered or wrong report as "ok".
   - **Fix:** if `new RegExp(\`\\b${key}\\s*[:=]\`, "i")` matches but the value regex doesn't, or if the captured value is followed by `[A-Za-z0-9._-]`, throw `invalid_request: bad ${key}`.

6. [LOW] `app/agent/src/sellerCore.ts:254-257`: an HTTP 200 response with `"result": null` is classified as `ok`, so a null result becomes a deliverable.
   - **Fix:** use `if (!parsed || typeof parsed.result !== "object" || parsed.result === null) return "upstream_error";`.

7. [LOW] `app/agent/src/mcpMain.ts:674` (free x402 face): `invalid_request` from `parseRequest` goes to the SDK's generic `500 {"error":"work failed"}`. A client's bad input looks the same as a server or upstream fault, and the SDK's `withTimeout` there doesn't cancel the upstream fetch, because no `abortSignal` is passed.
   - **Fix:** move unknown-tool validation into a cheap pre-check in the `sellPath` handler (`mcpMain.ts:688`) that returns 400 before `seller.handle`. In the paid mode planned for Bloque 3, this also stops the buyer from being charged for a request that can never succeed.
