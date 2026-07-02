/**
 * Sales & Analytics — fuzzy client matching (§4 / §8).
 *
 * The spec's two litmus pairs:
 *   - "International light factory" ↔ "International Lighting Factory"  → SAME
 *   - "ANL LIGHTING" vs "ANDI LIGHTING, LLC"                           → NOT same
 * and the invariant: the matcher never auto-merges — it only routes to a band.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareClientNames, bestClientMatch } from "../lib/sales/client-match.ts";

test('merges "International light factory" ↔ "International Lighting Factory"', () => {
  const c = compareClientNames("International light factory", "International Lighting Factory");
  assert.equal(c.band, "same", `expected "same", got "${c.band}" (score ${c.score})`);
});

test('proposes WITHOUT merging "ANL LIGHTING" vs "ANDI LIGHTING, LLC"', () => {
  const c = compareClientNames("ANL LIGHTING", "ANDI LIGHTING, LLC");
  assert.notEqual(c.band, "same", "different companies must never be flagged the same");
  assert.equal(c.band, "distinct");
});

test('a single-letter typo lands in the "similar" (propose) band', () => {
  const c = compareClientNames("Sinoqualis", "Sinoqalis");
  assert.equal(c.band, "similar");
  assert.ok(c.score >= 0.86);
});

test("bestClientMatch returns the same-company candidate, and null for distinct ones", () => {
  const candidates = [
    { id: "1", code: "C0086", name: "International Lighting Factory" },
    { id: "2", code: "C0106", name: "ANDI LIGHTING, LLC" },
  ];
  const m = bestClientMatch("International light factory", candidates);
  assert.ok(m);
  assert.equal(m?.candidate.code, "C0086");
  assert.equal(m?.comparison.band, "same");

  // ANL has no acceptable candidate here → null (kept separate, not fused).
  assert.equal(bestClientMatch("ANL LIGHTING", [candidates[1]]), null);
});
