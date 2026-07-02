/**
 * Customer-name verification — the spec's own examples are the fixtures.
 * "ARLUX" must match Arlux / ARLUX SAS / Arlux Lighting, and reject a
 * completely different company.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { matchCustomerName } from "../lib/import/name-match.ts";

test("ARLUX matches its spelling / legal-suffix / industry-word variants", () => {
  for (const variant of ["Arlux", "ARLUX", "ARLUX SAS", "Arlux Lighting", "ARLUX  sarl"]) {
    const m = matchCustomerName(variant, "ARLUX");
    assert.equal(m.matches, true, `expected "${variant}" to match ARLUX`);
    assert.ok(m.score >= 0.9, `score for "${variant}" should be high, got ${m.score}`);
  }
});

test("a completely different company is a mismatch", () => {
  const m = matchCustomerName("Zenith Electronics Group", "ARLUX");
  assert.equal(m.matches, false);
  assert.equal(m.reason, "mismatch");
});

test("subset name (extra qualifier) still matches", () => {
  const m = matchCustomerName("Arlux Benin", "Arlux");
  assert.equal(m.matches, true);
  assert.equal(m.reason, "core_subset");
});

test("a single-character typo still matches via fuzzy", () => {
  const m = matchCustomerName("Arlurx", "Arlux");
  assert.equal(m.matches, true);
});

test("empty detected name cannot be verified (needs attention, not a hard match)", () => {
  const m = matchCustomerName("", "Arlux");
  assert.equal(m.matches, false);
  assert.equal(m.reason, "empty");
});
