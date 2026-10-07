/**
 * Deterministic tests for the StockGap seller work hook (Bloque 2, gate-1
 * fixes). No LLM, no chain, no network: fetch is simulated. Run: `pnpm test`
 * (builds tsc output first; assertions run against dist/).
 *
 * Short upstream timeout so the timeout-classification test is fast.
 */
process.env.STOCKGAP_MCP_TIMEOUT_MS = "150";

import test from "node:test";
import assert from "node:assert/strict";

const {
  runWork,
  callStockgapTool,
  parseRequest,
  classifyUpstream,
  STOCKGAP_TOOLS,
  GapReportError,
} = await import("../dist/sellerCore.js");

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
    // gate-1 #4: no upstream URL in the deliverable, only a constant label
    assert.equal(out.upstream.source, "stockgap-mcp");
    assert.equal("url" in out.upstream, false);
    assert.ok(out.generated_at);
  } finally {
    restore();
  }
});

test("gate-1 #1: HTTP 402 THROWS GapReportError (never a signed deliverable)", async () => {
  const restore = mockFetch(async () =>
    jsonResponse(402, { x402Version: 1, error: "payment required" }),
  );
  try {
    await assert.rejects(
      () => runWork("gap report", { sessionId: "t2" }),
      (err) => {
        assert.ok(err instanceof GapReportError);
        assert.equal(err.report.status, "payment_required");
        assert.equal(err.report.upstream.httpStatus, 402);
        assert.match(err.report.note, /402/);
        return true;
      },
    );
  } finally {
    restore();
  }
});

test("gate-1 #1: transport failure THROWS with an upstream_error envelope", async () => {
  const restore = mockFetch(async () => {
    throw new Error("connect ECONNREFUSED");
  });
  try {
    await assert.rejects(
      () => runWork("gap report", { sessionId: "t4" }),
      (err) => {
        assert.ok(err instanceof GapReportError);
        assert.equal(err.report.status, "upstream_error");
        assert.equal(err.report.upstream.httpStatus, 0);
        assert.match(JSON.stringify(err.report.upstream.result), /ECONNREFUSED/);
        return true;
      },
    );
  } finally {
    restore();
  }
});

test("gate-1 #2: HTTP 200 with result.isError=true is upstream_error (throws)", async () => {
  const restore = mockFetch(async () =>
    jsonResponse(200, {
      jsonrpc: "2.0",
      id: 1,
      result: { content: [], isError: true },
    }),
  );
  try {
    await assert.rejects(
      () => runWork("gap report", { sessionId: "t5" }),
      (err) => {
        assert.ok(err instanceof GapReportError);
        assert.equal(err.report.status, "upstream_error");
        return true;
      },
    );
  } finally {
    restore();
  }
});

test("gate-1 #3: caller abort propagates, never becomes a deliverable", async () => {
  const controller = new AbortController();
  controller.abort(new Error("caller abort"));
  const restore = mockFetch(async () => {
    throw new Error("network down");
  });
  try {
    await assert.rejects(
      () =>
        runWork("gap report", { sessionId: "t6", abortSignal: controller.signal }),
      (err) => {
        // the caller's abort reason wins over the transport-error mapping
        assert.equal(err instanceof GapReportError, false);
        assert.match(String(err && err.message), /caller abort/);
        return true;
      },
    );
  } finally {
    restore();
  }
});

test("gate-1 #3: timeout is recorded as transport_error 'timeout'", async () => {
  // AbortSignal.timeout() is unref'd in Node: hold the event loop open so
  // node:test does not resolve early while the 150ms timeout is pending.
  const keepAlive = setInterval(() => {}, 25);
  // fetch mock honours the abort signal but never settles otherwise
  const restore = mockFetch(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () =>
          reject(new Error("this request was aborted")),
        );
      }),
  );
  try {
    await assert.rejects(
      () => runWork("gap report", { sessionId: "t7" }),
      (err) => {
        assert.ok(err instanceof GapReportError);
        assert.equal(err.report.status, "upstream_error");
        assert.match(JSON.stringify(err.report.upstream.result), /"timeout"/);
        return true;
      },
    );
  } finally {
    restore();
    clearInterval(keepAlive);
  }
});

test("gate-1 #6: prompt parses per-tool filter key, no cross-namespace remap", async () => {
  assert.deepEqual(parseRequest("tool: get_oracle_latest underlying: NVDA"), {
    tool: "get_oracle_latest",
    args: { underlying: "NVDA" },
  });
  assert.deepEqual(parseRequest("token_symbol: SILon"), {
    tool: "get_spread",
    args: { token_symbol: "SILon" },
  });
  // wrong-namespace key is IGNORED, never remapped into token_symbol
  assert.deepEqual(parseRequest("underlying: NVDA"), {
    tool: "get_spread",
    args: {},
  });
  assert.deepEqual(parseRequest("tool: get_cross_issuer token_symbol: NVDA"), {
    tool: "get_cross_issuer",
    args: {},
  });

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

test("gate-1 #6: unknown tool is an invalid_request throw, never a fallback", async () => {
  assert.throws(() => parseRequest("tool: drain_wallet"), /invalid_request/);
  const restore = mockFetch(async () => {
    throw new Error("fetch must not be reached");
  });
  try {
    await assert.rejects(
      () => runWork("tool: drain_wallet", { sessionId: "t8" }),
      /invalid_request/,
    );
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
