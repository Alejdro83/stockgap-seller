/**
 * StockGap seller work hook (spike wiring — Bloque 2 interface).
 *
 * The deliverable is a REAL gap report fetched from OUR StockGap MCP service
 * (`POST /mcp`, JSON-RPC `tools/call`, tool `get_spread`). Deterministic:
 * no LLM, no pricing, no signing here — pricing/signing stay in signing.ts.
 *
 * Configuration:
 *   STOCKGAP_MCP_URL   — our MCP endpoint (default http://localhost:8098/mcp)
 *   SPIKE_EVIDENCE_DIR — optional dir; every call is appended verbatim
 *                        (raw JSON-RPC request + raw HTTP response) to
 *                        get_spread_calls.jsonl there for audit/evidence.
 */

export type RunContext = { sessionId: string; abortSignal?: AbortSignal };
export type RunWork = (prompt: string, context: RunContext) => Promise<string>;

const STOCKGAP_MCP_URL =
  process.env.STOCKGAP_MCP_URL ?? "http://localhost:8098/mcp";

export interface GetSpreadCall {
  url: string;
  request: string;
  response: string;
  httpStatus: number;
}

/** One real end-to-end call to our StockGap MCP `get_spread` tool. */
export async function callGetSpread(
  tokenSymbol?: string,
  signal?: AbortSignal,
): Promise<GetSpreadCall> {
  const args: Record<string, unknown> = {};
  if (tokenSymbol) args.token_symbol = tokenSymbol;
  const request = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "get_spread", arguments: args },
  });
  const res = await fetch(STOCKGAP_MCP_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: request,
    signal,
  });
  const response = await res.text();
  const call: GetSpreadCall = {
    url: STOCKGAP_MCP_URL,
    request,
    response,
    httpStatus: res.status,
  };
  await recordEvidence(call);
  return call;
}

async function recordEvidence(call: GetSpreadCall): Promise<void> {
  const dir = process.env.SPIKE_EVIDENCE_DIR;
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

/** Optional `token_symbol` filter parsed from the work prompt ("NVDA", etc.). */
function parseSymbol(prompt: string): string | undefined {
  const m = /\btoken_symbol\s*[:=]\s*([A-Za-z][A-Za-z0-9._-]{0,11})\b/i.exec(
    prompt,
  );
  return m ? m[1] : undefined;
}

/**
 * The MCP/B402 delivery hook used by `mcpMain.main()` and `notify_funded`:
 * produce the StockGap gap report deliverable.
 */
export const runWork: RunWork = async (prompt, context) => {
  const call = await callGetSpread(parseSymbol(prompt), context.abortSignal);
  let upstream: unknown;
  try {
    upstream = JSON.parse(call.response);
  } catch {
    upstream = { raw: call.response };
  }
  return JSON.stringify({
    service: "stockgap-gap-report",
    prompt,
    upstream: { url: call.url, httpStatus: call.httpStatus, result: upstream },
  });
};
