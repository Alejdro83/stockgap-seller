/**
 * Read-only publication of ERC-8183 deliverables. The SDK, when storage is
 * file://, publishes `{ERC8183_AGENT_URL}/job/{id}/response`; this serves the
 * manifest JSON it wrote to STORAGE_LOCAL_PATH so buyers/verifiers can fetch
 * and re-hash it. Only `erc8183-job-<digits>.json` inside the storage dir is
 * ever reachable (strict numeric id, no path input reaches the filesystem).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const MAX_BYTES = 2 * 1024 * 1024;
const JOB_ID = /^[0-9]{1,12}$/;

export function deliverablePath(dir: string, rawId: string): string | null {
  return JOB_ID.test(rawId) ? join(dir, `erc8183-job-${rawId}.json`) : null;
}

export async function readDeliverable(
  dir: string,
  rawId: string,
): Promise<{ status: 200; body: string } | { status: 400 | 404 | 413 }> {
  const path = deliverablePath(dir, rawId);
  if (path === null) {
    return { status: 400 };
  }
  try {
    const buf = await readFile(path);
    if (buf.byteLength > MAX_BYTES) {
      return { status: 413 };
    }
    return { status: 200, body: buf.toString("utf8") };
  } catch {
    return { status: 404 };
  }
}
