/**
 * Deterministic tests for the StockGap seller work hook (Bloque 2).
 * No LLM, no chain, no network: fetch is simulated. Run: `pnpm test`
 * (builds tsc output first; assertions run against dist/).
 */
import test from "node:test";
import assert from "node:assert/strict";

const { runWork, callStockgapTool, parseRequest, classifyUpstream, STOCKGAP_TOOLS } =
  await import("../dist/sellerCore.js");

function mockFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => {
    globalThis.fetch = original;
  };
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("allowlist is exactly the three StockGap tools", () => {
  assert.deepEqual([...STOCKGAP_TOOLS], [
    "get_spread",
    "get_cross_issuer",
    "get_oracle_latest",
  ]);
});

test("happy path: get_spread returns an ok gap-report envelope", async () => {
  const restore = mockFetch(async (_url, init) => {
    const req = JSON.parse(init.body);
    assert.equal(req.method, "tools/call");
    assert.equal(req.params.name, "get_spread");
    assert.deepEqual(req.params.arguments, {});
    return jsonResponse(200, {
      jsonrpc: "2.0",
      id: 1,
      result: { content: [], structuredContent: { rows: [1] }, isError: false },
    });
  });
  try {
    const out = JSON.parse(await runWork("StockGap gap report", { sessionId: "t1" }));
    assert.equal(out.service, "stockgap-gap-report");
    assert.equal(out.status, "ok");
    assert.equal(out.request.tool, "get_spread");
    assert.equal(out.upstream.httpStatus, 200);
    assert.ok(out.generated_at);
  } finally {
    restore();
  }
});

test("upstream HTTP 402 is surfaced as payment_required, never an exception", async () => {
  const restore = mockFetch(async () =>
    jsonResponse(402, { x402Version: 1, error: "payment required" }),
  );
  try {
    const out = JSON.parse(await runWork("gap report", { sessionId: "t2" }));
    assert.equal(out.status, "payment_required");
    assert.equal(out.upstream.httpStatus, 402);
    assert.match(out.note, /402/);
  } finally {
    restore();
  }
});

test("prompt parses allowlisted tool + per-tool filter key", async () => {
  assert.deepEqual(parseRequest("tool: get_oracle_latest underlying: NVDA"), {
    tool: "get_oracle_latest",
    args: { underlying: "NVDA" },
  });
  assert.deepEqual(parseRequest("token_symbol: SILon"), {
    tool: "get_spread",
    args: { token_symbol: "SILon" },
  });
  // unknown tool names fall back to get_spread (never an arbitrary call)
  assert.equal(parseRequest("tool: drain_wallet").tool, "get_spread");

  const restore = mockFetch(async (_url, init) => {
    const req = JSON.parse(init.body);
    assert.equal(req.params.name, "get_cross_issuer");
    assert.deepEqual(req.params.arguments, { underlying: "NVDA" });
    return jsonResponse(200, {
      jsonrpc: "2.0",
      id: 1,
      result: { content: [], isError: false },
    });
  });
  try {
    const out = JSON.parse(
      await runWork("tool: get_cross_issuer underlying: NVDA", { sessionId: "t3" }),
    );
    assert.equal(out.status, "ok");
    assert.equal(out.request.tool, "get_cross_issuer");
  } finally {
    restore();
  }
});

test("callStockgapTool rejects tools outside the allowlist", async () => {
  await assert.rejects(
    () => callStockgapTool("eth_sendRawTransaction", {}),
    /allowlist/,
  );
});

test("transport failure yields an upstream_error envelope, no throw", async () => {
  const restore = mockFetch(async () => {
    throw new Error("connect ECONNREFUSED");
  });
  try {
    const out = JSON.parse(await runWork("gap report", { sessionId: "t4" }));
    assert.equal(out.status, "upstream_error");
    assert.equal(out.upstream.httpStatus, 0);
    assert.match(JSON.stringify(out.upstream.result), /ECONNREFUSED/);
  } finally {
    restore();
  }
});

test("classifyUpstream: JSON-RPC error body is upstream_error", () => {
  const call = {
    url: "u",
    tool: "get_spread",
    request: "{}",
    response: JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "bad" } }),
    httpStatus: 200,
  };
  assert.equal(classifyUpstream(call), "upstream_error");
});
