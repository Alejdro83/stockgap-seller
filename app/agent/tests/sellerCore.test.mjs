/**
 * Deterministic tests for the StockGap seller work hook (Bloque 2; gate-1 +
 * gate-2 fixes). No LLM, no chain, no network: fetch is simulated. Run:
 * `pnpm test` (builds tsc output first; assertions run against dist/).
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
  classifyDeliveryError,
  validateSellRequest,
  STOCKGAP_TOOLS,
  GapReportError,
  InvalidRequestError,
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

test("gate-2 #6: HTTP 200 with result:null is upstream_error", () => {
  assert.equal(
    classifyUpstream({
      url: "u",
      tool: "get_spread",
      request: "{}",
      response: JSON.stringify({ jsonrpc: "2.0", id: 1, result: null }),
      httpStatus: 200,
    }),
    "upstream_error",
  );
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

test("gate-2 #4: oversized upstream body is response_too_large (with and without content-length)", async () => {
  const big = new Uint8Array(2 * 1024 * 1024);
  // without content-length: streamed body over the 1 MiB cap
  let restore = mockFetch(async () => new Response(big, { status: 200 }));
  try {
    await assert.rejects(
      () => runWork("gap report", { sessionId: "t-cap1" }),
      (err) => {
        assert.ok(err instanceof GapReportError);
        assert.match(JSON.stringify(err.report.upstream.result), /response_too_large/);
        return true;
      },
    );
  } finally {
    restore();
  }
  // with a declared content-length over the cap
  restore = mockFetch(
    async () =>
      new Response(big, {
        status: 200,
        headers: { "content-length": String(big.byteLength) },
      }),
  );
  try {
    await assert.rejects(
      () => runWork("gap report", { sessionId: "t-cap2" }),
      (err) => {
        assert.ok(err instanceof GapReportError);
        assert.match(JSON.stringify(err.report.upstream.result), /response_too_large/);
        return true;
      },
    );
  } finally {
    restore();
  }
});

test("gate-2 #4: evidence sink appends rows and stops past the 5 MiB cap", async () => {
  const { mkdtempSync, writeFileSync, readFileSync } = await import("node:fs");
  const dir = mkdtempSync("/tmp/sg-evidence-");
  const prev = process.env.SELLER_EVIDENCE_DIR;
  process.env.SELLER_EVIDENCE_DIR = dir;
  const restore = mockFetch(async () =>
    jsonResponse(200, {
      jsonrpc: "2.0",
      id: 1,
      result: { content: [], isError: false },
    }),
  );
  try {
    await runWork("gap report", { sessionId: "t-ev1" });
    const file = `${dir}/upstream_calls.jsonl`;
    const first = readFileSync(file, "utf8");
    assert.equal(first.trim().split("\n").length, 1);
    // the upstream URL lives in the evidence row (and only there)
    assert.ok(JSON.parse(first.split("\n")[0]).url);
    // exceed the cap -> no further rows appended (byte-identical file)
    const filler = "x".repeat(5 * 1024 * 1024 + 1);
    writeFileSync(file, first + filler);
    await runWork("gap report", { sessionId: "t-ev2" });
    const after = readFileSync(file, "utf8");
    assert.equal(after, first + filler);
  } finally {
    restore();
    if (prev === undefined) delete process.env.SELLER_EVIDENCE_DIR;
    else process.env.SELLER_EVIDENCE_DIR = prev;
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

test("gate-2 #5 / gate-3 #2: malformed or truncated filter values are invalid_request", () => {
  // digit-leading symbol cannot match the value grammar -> explicit error
  assert.throws(() => parseRequest("token_symbol: 1INCH"), (err) => {
    assert.ok(err instanceof InvalidRequestError);
    assert.match(err.message, /bad token_symbol/);
    return true;
  });
  // over-long value must NOT be silently truncated at the '-' boundary
  assert.throws(
    () => parseRequest("token_symbol: ABCDEFGHIJKL-X"),
    /bad token_symbol/,
  );
  // gate-3 #2: a sentence-ending period is not part of the symbol
  assert.throws(() => parseRequest("token_symbol: NVDA."), /bad token_symbol/);
  // gate-3 #2: a repeated key never lets a bad first value fall through
  assert.throws(
    () => parseRequest("token_symbol: 1INCH token_symbol: NVDA"),
    /bad token_symbol/,
  );
  // dotted symbols stay accepted
  assert.deepEqual(parseRequest("token_symbol: NVDA.US"), {
    tool: "get_spread",
    args: { token_symbol: "NVDA.US" },
  });
});

test("gate-1 #6: unknown tool is an invalid_request throw, never a fallback", async () => {
  assert.throws(() => parseRequest("tool: drain_wallet"), (err) => {
    assert.ok(err instanceof InvalidRequestError);
    return true;
  });
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

test("gate-2 #1: delivery error mapping — rejected vs retry vs generic", async () => {
  assert.deepEqual(
    classifyDeliveryError(new InvalidRequestError("invalid_request: unknown tool x")),
    { status: "rejected", reason: "invalid_request" },
  );
  let gapErr;
  const restore = mockFetch(async () =>
    jsonResponse(402, { x402Version: 1, error: "payment required" }),
  );
  try {
    await runWork("gap report", { sessionId: "t-map" });
  } catch (e) {
    gapErr = e;
  } finally {
    restore();
  }
  assert.ok(gapErr instanceof GapReportError);
  assert.deepEqual(classifyDeliveryError(gapErr), {
    status: "retry",
    reason: "payment_required",
  });
  assert.equal(classifyDeliveryError(new Error("something else")), null);
});

test("gate-5 #1: a filter value cut short at punctuation is invalid_request", () => {
  for (const p of [
    'token_symbol: NV"DA',
    "token_symbol: NV'DA",
    "token_symbol: NV&DA",
    "token_symbol: TSLA(ON)",
  ]) {
    assert.throws(() => parseRequest(p), /bad token_symbol/, p);
  }
});

test("gate-5 #2: backslash-escaped JSON prompts parse their tool and filters", () => {
  const escaped = '{\\"tool\\":\\"get_cross_issuer\\",\\"underlying\\":\\"NVDA\\"}';
  assert.deepEqual(parseRequest(escaped), {
    tool: "get_cross_issuer",
    args: { underlying: "NVDA" },
  });
});

test("gate-5 #3: only a real key start selects the tool or filter", () => {
  assert.deepEqual(parseRequest('{"x-tool":"get_oracle_latest"}'), {
    tool: "get_spread",
    args: {},
  });
  assert.deepEqual(parseRequest("multi-tool: get_oracle_latest"), {
    tool: "get_spread",
    args: {},
  });
});

test("gate-4 #1: JSON-shaped prompts parse their tool and filters", () => {
  // quoted key-colon-value (a JSON object used as the prompt)
  assert.deepEqual(parseRequest('{"tool":"get_cross_issuer","underlying":"NVDA"}'), {
    tool: "get_cross_issuer",
    args: { underlying: "NVDA" },
  });
  // quoted filter key must NOT silently drop the filter
  assert.deepEqual(parseRequest('{"prompt":"gap","token_symbol":"NVDA"}'), {
    tool: "get_spread",
    args: { token_symbol: "NVDA" },
  });
});

test("gate-4 #2: validateSellRequest matches the SDK promptFrom exactly", () => {
  // empty query prompt IS defined -> the SDK uses "" -> no 400 from us
  assert.equal(validateSellRequest("", '{"prompt":"tool: drain_wallet"}'), null);
  // JSON body without a string prompt -> the SDK uses "" -> no 400
  assert.equal(validateSellRequest(undefined, '{"prompt":null,"note":"tool: x"}'), null);
  // non-object JSON body -> the SDK uses "" -> no 400
  assert.equal(validateSellRequest(undefined, '["tool: x"]'), null);
  // raw body is used only when JSON.parse throws -> still validated
  assert.match(validateSellRequest(undefined, "tool: drain_wallet"), /unknown tool drain_wallet/);
});

test("gate-4 #3: prose punctuation never breaks a valid filter", () => {
  assert.deepEqual(parseRequest("spread for (token_symbol: NVDA)"), {
    tool: "get_spread",
    args: { token_symbol: "NVDA" },
  });
  assert.deepEqual(parseRequest("token_symbol: 'NVDA'"), {
    tool: "get_spread",
    args: { token_symbol: "NVDA" },
  });
  // trailing '.'/'-' is still rejected
  assert.throws(() => parseRequest("token_symbol: NVDA."), /bad token_symbol/);
});

test("gate-2 #7 / gate-3 #3: validateSellRequest mirrors the SDK prompt precedence", () => {
  // query-string prompt is checked (the SDK reads it FIRST)
  assert.match(validateSellRequest("tool: drain_wallet", ""), /unknown tool drain_wallet/);
  // JSON-escaped prompt is checked after decoding
  assert.match(
    validateSellRequest(undefined, JSON.stringify({ prompt: "tool:\ndrain_wallet" })),
    /unknown tool drain_wallet/,
  );
  // only body.prompt counts — other fields cannot shadow it
  assert.match(
    validateSellRequest(undefined, JSON.stringify({ meta: "tool: get_spread", prompt: "tool: drain_wallet" })),
    /unknown tool drain_wallet/,
  );
  // malformed filters are pre-checked too
  assert.match(validateSellRequest("token_symbol: 1INCH", ""), /bad token_symbol/);
  // valid requests pass
  assert.equal(validateSellRequest(undefined, '{"prompt":"StockGap gap report"}'), null);
  assert.equal(validateSellRequest("tool: get_spread token_symbol: NVDA", ""), null);
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
