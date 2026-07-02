/**
 * Sales & Analytics — normalized client key (§4). The real spelling variants
 * from clients.csv are the fixtures.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizedClientKey, stripCountryPrefix } from "../lib/sales/client-key.ts";

test("strips the leading Chinese country prefix (with/without digits & dash)", () => {
  assert.equal(stripCountryPrefix("美国5-beyond solar"), "beyond solar");
  assert.equal(stripCountryPrefix("法国-solux europe sas"), "solux europe sas");
  assert.equal(stripCountryPrefix("阿曼2power beam"), "power beam");
  assert.equal(stripCountryPrefix("越南10- hoang le"), "hoang le");
  assert.equal(stripCountryPrefix("no prefix here"), "no prefix here");
});

test("drops legal-form words and spaces", () => {
  assert.equal(normalizedClientKey("Procure Direct Ltd"), "procuredirect");
  assert.equal(normalizedClientKey("法国-SOLUX EUROPE SAS"), "soluxeurope");
  assert.equal(normalizedClientKey("VIZONA PTY Ltd"), "vizona");
});

test('"&" becomes " and " (kept, not dropped)', () => {
  assert.equal(normalizedClientKey("Refresh Lighting&Energy Solutions"), "refreshlightingandenergysolutions");
});

test("full recipe on a real variant", () => {
  assert.equal(normalizedClientKey("美国5-Beyond solar"), "beyondsolar");
  assert.equal(normalizedClientKey("沙特11-International light factory"), "lightfactory");
});

test("near-duplicate canonical clients still get DISTINCT keys (both load)", () => {
  // C0085 vs C0086 — must not collide on UNIQUE(normalized_key).
  assert.notEqual(
    normalizedClientKey("International light factory"),
    normalizedClientKey("International Lighting Factory"),
  );
});

test("an all-Chinese sample label collapses to an empty key (callers skip it)", () => {
  assert.equal(normalizedClientKey("上海办公室"), "");
  assert.equal(normalizedClientKey(""), "");
  assert.equal(normalizedClientKey(null), "");
});
