/**
 * StockGap seller work hook — PRODUCTION (Bloque 2, 2026-10-07).
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
 * of the x402/b402 pay-per-call gate: any upstream 402 becomes a structured
 * `payment_required` deliverable — never an exception, never a silent drop.
 *
 * Configuration:
 *   STOCKGAP_MCP_URL          upstream MCP endpoint (default http://localhost:8098/mcp)
 *   STOCKGAP_MCP_TIMEOUT_MS   upstream fetch timeout, default 20000
 *   SELLER_EVIDENCE_DIR       optional dir; every upstream call is appended
 *                             verbatim (raw JSON-RPC request + raw HTTP
 *                             response body) to get_spread_calls.jsonl for
 *                             audit/evidence. SPIKE_EVIDENCE_DIR keeps
 *                             working as a legacy alias.
 */

export type RunContext = { sessionId: string; abortSignal?: AbortSignal };
export type RunWork = (prompt: string, context: RunContext) => Promise<string>;

const STOCKGAP_MCP_URL =
  process.env.STOCKGAP_MCP_URL ?? "http://localhost:8098/mcp";
const UPSTREAM_TIMEOUT_MS = Number(process.env.STOCKGAP_MCP_TIMEOUT_MS ?? "20000");

/** The ONLY upstream tools this seller may call (interface allowlist). */
export const STOCKGAP_TOOLS = [
  "get_spread",
  "get_cross_issuer",
  "get_oracle_latest",
] as const;
export type StockgapTool = (typeof STOCKGAP_TOOLS)[number];

export interface UpstreamCall {
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
  upstream: { url: string; httpStatus: number; result: unknown };
  note?: string;
}

function isStockgapTool(name: string): name is StockgapTool {
  return (STOCKGAP_TOOLS as readonly string[]).includes(name);
}

/** Arguments for one tool call — per-tool keys, nothing else. */
function toolArgs(
  tool: StockgapTool,
  filter: string | undefined,
): Record<string, unknown> {
  if (!filter) return {};
  return tool === "get_spread" ? { token_symbol: filter } : { underlying: filter };
}

/**
 * One real end-to-end call to our StockGap MCP. Upstream status codes are
 * DATA, not exceptions: a 402 or 500 is captured verbatim and classified
 * later. Only a caller-supplied abort propagates.
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
  let response: string;
  let httpStatus: number;
  try {
    const timeout = AbortSignal.timeout(
      Number.isFinite(UPSTREAM_TIMEOUT_MS) && UPSTREAM_TIMEOUT_MS > 0
        ? UPSTREAM_TIMEOUT_MS
        : 20000,
    );
    const res = await fetch(STOCKGAP_MCP_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: request,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    httpStatus = res.status;
    response = await res.text();
  } catch (error) {
    httpStatus = 0;
    response = JSON.stringify({
      transport_error: error instanceof Error ? error.message : String(error),
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
    const { appendFile, mkdir } = await import("node:fs/promises");
    await mkdir(dir, { recursive: true });
    await appendFile(
      `${dir}/get_spread_calls.jsonl`,
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
      const parsed = JSON.parse(call.response) as { result?: unknown };
      return parsed && parsed.result !== undefined ? "ok" : "upstream_error";
    } catch {
      return "upstream_error";
    }
  }
  return "upstream_error";
}

/**
 * Work prompt → tool request. Deterministic parsing only:
 *   "tool: get_oracle_latest"  — allowlisted tool (default `get_spread`)
 *   "token_symbol: NVDA"       — get_spread filter
 *   "underlying: NVDA"         — get_cross_issuer / get_oracle_latest filter
 * Unknown tool names fall back to `get_spread` (never an arbitrary call).
 */
export function parseRequest(prompt: string): {
  tool: StockgapTool;
  args: Record<string, unknown>;
} {
  const toolMatch = /\btool\s*[:=]\s*([a-z_][a-z0-9_]*)\b/i.exec(prompt);
  const tool: StockgapTool =
    toolMatch && isStockgapTool(toolMatch[1].toLowerCase())
      ? (toolMatch[1].toLowerCase() as StockgapTool)
      : "get_spread";
  const symbolMatch =
    /\b(?:token_symbol|underlying)\s*[:=]\s*([A-Za-z][A-Za-z0-9._-]{0,11})\b/i.exec(
      prompt,
    );
  return { tool, args: toolArgs(tool, symbolMatch?.[1]) };
}

const PAYMENT_NOTE =
  "upstream answered HTTP 402 (x402/b402 pay-per-call gate): settle payment " +
  "or obtain access, then re-call; no work was performed and nothing was paid";

/**
 * The MCP/B402 delivery hook used by `mcpMain.main()` and `notify_funded`:
 * produce the StockGap gap report deliverable. NEVER throws — a paid job must
 * always get a deliverable envelope describing exactly what happened.
 */
export const runWork: RunWork = async (prompt, context) => {
  const { tool, args } = parseRequest(prompt);
  let call: UpstreamCall;
  try {
    call = await callStockgapTool(tool, args, context.abortSignal);
  } catch (error) {
    // Only caller abort (or a programming error) lands here; keep the
    // delivery contract and describe it instead of dropping the job.
    call = {
      url: STOCKGAP_MCP_URL,
      tool,
      request: "",
      response: JSON.stringify({
        transport_error: error instanceof Error ? error.message : String(error),
      }),
      httpStatus: 0,
    };
  }
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
    upstream: { url: call.url, httpStatus: call.httpStatus, result },
  };
  if (status === "payment_required") report.note = PAYMENT_NOTE;
  return JSON.stringify(report);
};
