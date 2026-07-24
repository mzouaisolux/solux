/**
 * Endpoint B (POST /api/datasheets) security guards — Workstream 7 fixes.
 * Pure logic only (no DB, no @/ alias) so it runs under the node
 * type-stripping test runner.
 *
 *   • isSafeVersion — HIGH path-traversal on the storage key.
 *   • escapeLike    — MEDIUM ilike-wildcard on range/code.
 *   • isPdfBytes    — MEDIUM missing PDF content check.
 *   • rateOk        — MED–LOW no rate limiting.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isSafeVersion,
  escapeLike,
  isPdfBytes,
  rateOk,
  __resetRateGuard,
} from "../features/product-knowledge-hub/lib/datasheetGuards.ts";

/* ---- isSafeVersion (HIGH: path traversal) ---- */

test("isSafeVersion accepts dotted-numeric versions", () => {
  for (const v of ["v1.0", "v1", "1", "2.3", "10.4.1", "v2.3.4"]) {
    assert.equal(isSafeVersion(v), true, v);
  }
});

test("isSafeVersion rejects traversal and injection shapes", () => {
  for (const v of [
    "../../etc",
    "..",
    "v1.0/../../secret",
    "1.0/r99",
    "v1.0 ",
    "",
    "latest",
    "v1.0\n",
    "1..0",
    "%2e%2e",
  ]) {
    assert.equal(isSafeVersion(v), false, v);
  }
});

/* ---- escapeLike (MEDIUM: ilike wildcard) ---- */

test("escapeLike neutralises LIKE metacharacters", () => {
  assert.equal(escapeLike("%"), "\\%");
  assert.equal(escapeLike("_"), "\\_");
  assert.equal(escapeLike("a%b_c"), "a\\%b\\_c");
  assert.equal(escapeLike("100\\"), "100\\\\");
});

test("escapeLike leaves ordinary values untouched", () => {
  assert.equal(escapeLike("COLARSUN"), "COLARSUN");
  assert.equal(escapeLike("SP-30"), "SP-30");
});

/* ---- isPdfBytes (MEDIUM: content check) ---- */

test("isPdfBytes accepts a real %PDF- header", () => {
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // "%PDF-1.7"
  assert.equal(isPdfBytes(pdf), true);
});

test("isPdfBytes rejects non-PDF and too-short input", () => {
  assert.equal(isPdfBytes(new Uint8Array([0x50, 0x4b, 0x03, 0x04])), false); // ZIP
  assert.equal(isPdfBytes(new TextEncoder().encode("<html>")), false);
  assert.equal(isPdfBytes(new Uint8Array([0x25, 0x50, 0x44])), false); // truncated
  assert.equal(isPdfBytes(new Uint8Array([])), false);
});

/* ---- rateOk (MED–LOW: rate limiting) ---- */

test("rateOk allows up to the limit, then blocks within the window", () => {
  __resetRateGuard();
  const t = 1_000_000;
  for (let i = 0; i < 30; i++) {
    assert.equal(rateOk("keyA", t + i, 30, 60_000), true, `hit ${i}`);
  }
  assert.equal(rateOk("keyA", t + 30, 30, 60_000), false); // 31st in window
});

test("rateOk resets after the window elapses and isolates keys", () => {
  __resetRateGuard();
  assert.equal(rateOk("keyB", 0, 1, 1_000), true);
  assert.equal(rateOk("keyB", 500, 1, 1_000), false); // still in window
  assert.equal(rateOk("keyB", 1_500, 1, 1_000), true); // window passed
  assert.equal(rateOk("keyC", 500, 1, 1_000), true); // different key unaffected
});
