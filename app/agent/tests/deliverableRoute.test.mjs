/** Deterministic tests for the read-only ERC-8183 deliverable route helper. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deliverablePath, readDeliverable } from "../dist/deliverableRoute.js";

const dir = mkdtempSync(join(tmpdir(), "deliv-"));
writeFileSync(join(dir, "erc8183-job-56933.json"), '{"ok":true}');
writeFileSync(join(dir, "secret.json"), "nope");

test("numeric id maps to the fixed filename", () => {
  assert.equal(deliverablePath(dir, "56933"), join(dir, "erc8183-job-56933.json"));
});

test("non-numeric / traversal ids are rejected before touching the fs", async () => {
  for (const bad of ["", "../secret", "56933.json", "5 6", "1e3", "-1", "0x10", "9999999999999"]) {
    assert.equal(deliverablePath(dir, bad), null, bad);
    assert.deepEqual(await readDeliverable(dir, bad), { status: 400 });
  }
});

test("existing deliverable is served verbatim", async () => {
  assert.deepEqual(await readDeliverable(dir, "56933"), { status: 200, body: '{"ok":true}' });
});

test("missing deliverable is 404 and other files stay unreachable", async () => {
  assert.deepEqual(await readDeliverable(dir, "1"), { status: 404 });
  mkdirSync(join(dir, "erc8183-job-7.json")); // a directory, not a file
  assert.deepEqual(await readDeliverable(dir, "7"), { status: 404 });
});
