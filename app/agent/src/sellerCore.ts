/**
 * StockGap seller work hook — PRODUCTION (Bloque 2, 2026-10-07; gate-1 fixes).
 *
 * The deliverable is a REAL gap report fetched from OUR StockGap MCP service
 * (`POST /mcp`, JSON-RPC 2.0 `tools/call`). Deterministic by design: no LLM
 * in the quote/pricing/signing path — the price is `studio.toml
 * [payments.seller].price_usd` and all signing is fixed code in `signing.ts`;
 * this hook only READS upstream market data and never signs or pays.
 *
 * Upstream interface (frozen by the Bloque 2 interface decision):
 *   endpoint: STOCKGAP_MCP_URL (the deployed Northflank URL in production)
 *   tools:    get_spread | get_cross_issuer | get_oracle_latest  (allowlist;
 *             schemas are `additionalProperties:false`, so arguments are
 *             built per tool here — `token_symbol` vs `underlying`).
 *
 * MCP_PAY_MODE of the deployed StockGap instance, annotated BEFORE coding
 * (hard interface rule): **free** — `MCP_PAY_MODE=free`
 * (stockgap-agent config/mcp.env:5 at deployed SHA 1182690d192bb2994ef907c60d461f401f36f954),
 * and the live endpoint served `tools/call get_spread` with HTTP 200 and no
 * payment on 2026-10-07T03:09Z. The seller nevertheless HANDLES the HTTP 402
 * of the x402/b402 pay-per-call gate: a 402 (or any other non-OK outcome)
 * becomes a structured `GapReportError` carrying a `payment_required` /
 * `upstream_error` envelope for logs and evidence. GATE-1 HIGH FIX: runWork
 * THROWS on every non-OK outcome instead of returning an error envelope as
 * the deliverable — `notify_funded` can therefore never reach
 * `signing.submitResult` with an error payload, and a paid job stays open
 * for retry/refund instead of being signed off as done. Only `status:"ok"`
 * produces a deliverable string.
 *
 * Configuration:
 *   STOCKGAP_MCP_URL          upstream MCP endpoint (default http://localhost:8098/mcp)
 *   STOCKGAP_MCP_TIMEOUT_MS   upstream fetch timeout, default 20000
 *   SELLER_EVIDENCE_DIR       optional dir; every completed upstream call is
 *                             appended verbatim (raw JSON-RPC request + raw
 *                             HTTP response body, including the upstream URL)
 *                             to upstream_calls.jsonl for audit/evidence.
 *                             Growth is capped at 5 MiB. SPIKE_EVIDENCE_DIR
 *                             keeps working as a legacy alias.
 */

export type RunContext = { sessionId: string; abortSignal?: AbortSignal };
export type RunWork = (prompt: string, context: RunContext) => Promise<string>;

const STOCKGAP_MCP_URL =
  process.env.STOCKGAP_MCP_URL ?? "http://localhost:8098/mcp";
const UPSTREAM_TIMEOUT_MS = Number(process.env.STOCKGAP_MCP_TIMEOUT_MS ?? "20000");

/** Upstream response bodies larger than this are refused (memory/evidence cap). */
const MAX_UPSTREAM_BYTES = 1024 * 1024;
/** Evidence sink stops accepting rows past this size. */
const EVIDENCE_MAX_BYTES = 5 * 1024 * 1024;
const EVIDENCE_FILE = "upstream_calls.jsonl";

/** The ONLY upstream tools this seller may call (interface allowlist). */
export const STOCKGAP_TOOLS = [
  "get_spread",
  "get_cross_issuer",
  "get_oracle_latest",
] as const;
export type StockgapTool = (typeof STOCKGAP_TOOLS)[number];

/** Filter key per tool namespace (schemas are additionalProperties:false). */
const FILTER_KEY: Record<StockgapTool, "token_symbol" | "underlying"> = {
  get_spread: "token_symbol",
  get_cross_issuer: "underlying",
  get_oracle_latest: "underlying",
};

export interface UpstreamCall {
  /** Kept for the evidence sink ONLY — never copied into a deliverable. */
  url: string;
  tool: StockgapTool;
  request: string;
  response: string;
  httpStatus: number;
}

export type UpstreamStatus = "ok" | "payment_required" | "upstream_error";

export interface GapReport {
  service: "stockgap-gap-report";
  generated_at: string;
  request: { tool: StockgapTool; args: Record<string, unknown> };
  status: UpstreamStatus;
  /** Constant source label instead of the upstream URL: a paid buyer must
   *  not learn the free upstream endpoint (gate-1 finding 4). */
  upstream: { source: "stockgap-mcp"; httpStatus: number; result: unknown };
  note?: string;
}

/**
 * Thrown for every non-OK outcome. Carries the full envelope so callers can
 * log/record exactly what happened without ever submitting it as work.
 */
export class GapReportError extends Error {
  readonly report: GapReport;
  constructor(report: GapReport) {
    super(
      `stockgap ${report.status} (upstream httpStatus ${report.upstream.httpStatus})`,
    );
    this.name = "GapReportError";
    this.report = report;
  }
}

function isStockgapTool(name: string): name is StockgapTool {
  return (STOCKGAP_TOOLS as readonly string[]).includes(name);
}

/** Arguments for one tool call — only the key of THIS tool's namespace. */
function toolArgs(
  tool: StockgapTool,
  filter: string | undefined,
): Record<string, unknown> {
  if (!filter) return {};
  return { [FILTER_KEY[tool]]: filter };
}

function timeoutMs(): number {
  return Number.isFinite(UPSTREAM_TIMEOUT_MS) && UPSTREAM_TIMEOUT_MS > 0
    ? UPSTREAM_TIMEOUT_MS
    : 20000;
}

/** Read the body with a hard size cap (gate-1 finding 7). null = too large. */
async function readCappedBody(res: Response): Promise<string | null> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_UPSTREAM_BYTES) return null;
  const body = res.body;
  if (!body) {
    const text = await res.text();
    return text.length > MAX_UPSTREAM_BYTES ? null : text;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_UPSTREAM_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}

/**
 * One real end-to-end call to our StockGap MCP. Upstream status codes are
 * DATA, not exceptions: a 402 or 500 is captured verbatim and classified
 * later. GATE-1 finding 3: only a caller-supplied abort propagates (an
 * aborted job must never turn into a deliverable); timeouts and network
 * errors are captured as `transport_error` with `httpStatus: 0`.
 */
export async function callStockgapTool(
  tool: StockgapTool,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<UpstreamCall> {
  if (!isStockgapTool(tool)) {
    throw new Error(`tool not in the StockGap allowlist: ${String(tool)}`);
  }
  const request = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: tool, arguments: args },
  });
  const timeout = AbortSignal.timeout(timeoutMs());
  let response: string;
  let httpStatus: number;
  try {
    const res = await fetch(STOCKGAP_MCP_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: request,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    httpStatus = res.status;
    const capped = await readCappedBody(res);
    if (capped === null) {
      httpStatus = 0;
      response = JSON.stringify({
        transport_error: `response_too_large (> ${MAX_UPSTREAM_BYTES} bytes)`,
      });
    } else {
      response = capped;
    }
  } catch (error) {
    // Caller abort wins: rethrow so the job is never recorded as completed.
    if (signal?.aborted) throw signal.reason ?? error;
    httpStatus = 0;
    response = JSON.stringify({
      transport_error: timeout.aborted
        ? "timeout"
        : error instanceof Error
          ? error.message
          : String(error),
    });
  }
  const call: UpstreamCall = {
    url: STOCKGAP_MCP_URL,
    tool,
    request,
    response,
    httpStatus,
  };
  await recordEvidence(call);
  return call;
}

/** Back-compat wrapper for the spike-era helper name. */
export function callGetSpread(
  tokenSymbol?: string,
  signal?: AbortSignal,
): Promise<UpstreamCall> {
  return callStockgapTool("get_spread", toolArgs("get_spread", tokenSymbol), signal);
}

async function recordEvidence(call: UpstreamCall): Promise<void> {
  const dir = process.env.SELLER_EVIDENCE_DIR ?? process.env.SPIKE_EVIDENCE_DIR;
  if (!dir) return;
  try {
    const { appendFile, mkdir, stat } = await import("node:fs/promises");
    await mkdir(dir, { recursive: true });
    const file = `${dir}/${EVIDENCE_FILE}`;
    // Gate-1 finding 8: neutral file name + bounded growth.
    const size = await stat(file).then(
      (s) => s.size,
      () => 0,
    );
    if (size > EVIDENCE_MAX_BYTES) return;
    await appendFile(
      file,
      JSON.stringify({ at: new Date().toISOString(), ...call }) + "\n",
      "utf8",
    );
  } catch {
    /* evidence is best-effort; never fail the deliverable for it */
  }
}

/** Classify one upstream call: 402 = x402/b402 paywall, else result/error. */
export function classifyUpstream(call: UpstreamCall): UpstreamStatus {
  if (call.httpStatus === 402) return "payment_required";
  if (call.httpStatus >= 200 && call.httpStatus < 300) {
    try {
      const parsed = JSON.parse(call.response) as {
        result?: { isError?: boolean } | null;
      };
      if (!parsed || parsed.result === undefined) return "upstream_error";
      // MCP reports tool failures as HTTP 200 + result.isError (gate-1 #2).
      if (parsed.result?.isError === true) return "upstream_error";
      return "ok";
    } catch {
      return "upstream_error";
    }
  }
  return "upstream_error";
}

/**
 * Work prompt → tool request. Deterministic parsing only:
 *   "tool: get_oracle_latest"  — allowlisted tool (default `get_spread`);
 *                                unknown tool names are an invalid_request,
 *                                never a silent fallback (gate-1 #6)
 *   "token_symbol: NVDA"       — get_spread filter (its namespace only)
 *   "underlying: NVDA"         — get_cross_issuer / get_oracle_latest filter
 * Filter keys are NEVER remapped across namespaces (gate-1 #6): a key of the
 * other namespace is ignored, so `underlying: NVDA` alone yields an
 * unfiltered `get_spread`, not `get_spread {token_symbol:"NVDA"}`.
 */
export function parseRequest(prompt: string): {
  tool: StockgapTool;
  args: Record<string, unknown>;
} {
  const toolMatch = /\btool\s*[:=]\s*([a-z_][a-z0-9_]*)\b/i.exec(prompt);
  let tool: StockgapTool = "get_spread";
  if (toolMatch) {
    const wanted = toolMatch[1].toLowerCase();
    if (!isStockgapTool(wanted)) {
      throw new Error(`invalid_request: unknown tool ${wanted}`);
    }
    tool = wanted;
  }
  const key = FILTER_KEY[tool];
  const filterMatch = new RegExp(
    `\\b${key}\\s*[:=]\\s*([A-Za-z][A-Za-z0-9._-]{0,11})\\b`,
    "i",
  ).exec(prompt);
  return { tool, args: toolArgs(tool, filterMatch?.[1]) };
}

const PAYMENT_NOTE =
  "upstream answered HTTP 402 (x402/b402 pay-per-call gate): settle payment " +
  "or obtain access, then re-call; no work was performed and nothing was paid";

/**
 * The delivery hook used by `mcpMain.main()` and `notify_funded`: produce the
 * StockGap gap report deliverable. GATE-1 HIGH: throws `GapReportError` on
 * every non-OK outcome (402 / transport error / MCP tool error / invalid
 * request) so an error payload can never be signed as completed work; the
 * envelope rides on `error.report` for logs and evidence. Caller aborts
 * propagate untouched.
 */
export const runWork: RunWork = async (prompt, context) => {
  const { tool, args } = parseRequest(prompt);
  const call = await callStockgapTool(tool, args, context.abortSignal);
  const status = classifyUpstream(call);
  let result: unknown;
  try {
    result = JSON.parse(call.response);
  } catch {
    result = { raw: call.response };
  }
  const report: GapReport = {
    service: "stockgap-gap-report",
    generated_at: new Date().toISOString(),
    request: { tool, args },
    status,
    upstream: { source: "stockgap-mcp", httpStatus: call.httpStatus, result },
  };
  if (status !== "ok") {
    if (status === "payment_required") report.note = PAYMENT_NOTE;
    // Structured one-liner for the server log (no URL, no body).
    console.error(
      JSON.stringify({
        event: "stockgap_work_failed",
        status,
        tool,
        httpStatus: call.httpStatus,
      }),
    );
    throw new GapReportError(report);
  }
  return JSON.stringify(report);
};
