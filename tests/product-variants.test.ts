/**
 * Tests for UX variant collapsing (lib/product-variants).
 *
 * Run with:  npm test   (Node ≥ 22.6, built-in runner + native TS stripping)
 *
 * Locks in the owner rules (2026-07-12): IoT twins are hidden from catalogue
 * pickers ONLY for the approved families (AOSPRO+, SSLX Performance,
 * SSLX Pro), the Connectivity group maps each choice to the real product id,
 * and an IoT product with no standard twin stays visible.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildVariantIndex,
  collapseVariantProducts,
  isVariantEligibleFamily,
  familyKey,
} from "../lib/product-variants.ts";

const CAT_AOSPRO = "cat-aospro";
const CAT_SSLXPRO = "cat-sslxpro";
const CAT_PERF = "cat-perf";
const CAT_OTHER = "cat-poles";

// Mirrors the real catalogue rows (category labels as stored in DB).
const PRODUCTS = [
  { id: "ap40", name: "AOSPRO+40", category: "AOSPRO +", category_id: CAT_AOSPRO },
  { id: "ap40i", name: "AOSPRO+40 IoT version", category: "AOSPRO +", category_id: CAT_AOSPRO },
  { id: "ap60", name: "AOSPRO+60", category: "AOSPRO +", category_id: CAT_AOSPRO },
  { id: "ap60i", name: "AOSPRO+60 IoT version", category: "AOSPRO +", category_id: CAT_AOSPRO },
  // AOSPRO+20 exists ONLY as IoT in the live catalogue — must stay visible.
  { id: "ap20i", name: "AOSPRO+20 IoT version", category: "AOSPRO +", category_id: CAT_AOSPRO },
  { id: "sp80", name: "SSLXPRO 80", category: "SSLXPRO", category_id: CAT_SSLXPRO },
  { id: "sp80i", name: "SSLXPRO 80 IoT version", category: "SSLXPRO", category_id: CAT_SSLXPRO },
  { id: "perf50", name: "SSLX PERF DUAL 50", category: "SSLX Performance", category_id: CAT_PERF },
  { id: "perf50i", name: "SSLX PERF DUAL 50 IoT version", category: "SSLX Performance", category_id: CAT_PERF },
  // Out-of-scope family: even a perfect twin pair must NOT collapse.
  { id: "pole", name: "Pole 9m", category: "Poles", category_id: CAT_OTHER },
  { id: "polei", name: "Pole 9m IoT version", category: "Poles", category_id: CAT_OTHER },
];

test("family eligibility is limited to the three approved families", () => {
  assert.equal(isVariantEligibleFamily("AOSPRO +"), true);
  assert.equal(isVariantEligibleFamily("AOSPRO+"), true);
  assert.equal(isVariantEligibleFamily("SSLXPRO"), true);
  assert.equal(isVariantEligibleFamily("SSLX Pro"), true);
  assert.equal(isVariantEligibleFamily("SSLX Performance"), true);
  assert.equal(isVariantEligibleFamily("Poles"), false);
  assert.equal(isVariantEligibleFamily("SSLX"), false);
  assert.equal(isVariantEligibleFamily(null), false);
  assert.equal(familyKey("AOSPRO +"), "aospro+");
});

test("IoT twins of eligible families are hidden; everything else stays", () => {
  const index = buildVariantIndex(PRODUCTS);
  assert.deepEqual(
    [...index.hiddenIds].sort(),
    ["ap40i", "ap60i", "perf50i", "sp80i"].sort()
  );
  const shown = collapseVariantProducts(PRODUCTS, index).map((p) => p.id);
  // Standard models stay…
  for (const id of ["ap40", "ap60", "sp80", "perf50"]) assert.ok(shown.includes(id));
  // …the orphan IoT stays (no standard twin)…
  assert.ok(shown.includes("ap20i"));
  // …out-of-scope family untouched…
  assert.ok(shown.includes("pole"));
  assert.ok(shown.includes("polei"));
  // …paired twins hidden.
  for (const id of ["ap40i", "ap60i", "sp80i", "perf50i"]) assert.ok(!shown.includes(id));
});

test("the Connectivity group maps both choices to the real product ids", () => {
  const index = buildVariantIndex(PRODUCTS);
  const group = index.groupsByProductId.get("ap40");
  assert.ok(group);
  assert.equal(group.key, "connectivity");
  assert.equal(group.label, "Connectivity");
  assert.equal(group.baseProductId, "ap40");
  assert.deepEqual(
    group.choices.map((c) => [c.key, c.productId]),
    [
      ["standard", "ap40"],
      ["iot", "ap40i"],
    ]
  );
  // The group is resolvable from the IoT member too (existing lines/imports).
  assert.equal(index.groupsByProductId.get("ap40i"), group);
  // The orphan IoT and out-of-scope products have no group.
  assert.equal(index.groupsByProductId.get("ap20i"), undefined);
  assert.equal(index.groupsByProductId.get("pole"), undefined);
  assert.equal(index.groupsByProductId.get("polei"), undefined);
});

test("pairing is category-scoped: same name in another category never pairs", () => {
  const index = buildVariantIndex([
    { id: "a", name: "SSLXPRO 80", category: "SSLXPRO", category_id: CAT_SSLXPRO },
    { id: "b", name: "SSLXPRO 80 IoT version", category: "SSLX Performance", category_id: CAT_PERF },
  ]);
  assert.equal(index.hiddenIds.size, 0);
  assert.equal(index.groupsByProductId.size, 0);
});

test("name matching tolerates case and spacing drift", () => {
  const index = buildVariantIndex([
    { id: "a", name: "SSLXPRO 80", category: "SSLXPRO", category_id: CAT_SSLXPRO },
    { id: "b", name: "sslxpro  80  IOT VERSION ", category: "SSLXPRO", category_id: CAT_SSLXPRO },
  ]);
  assert.ok(index.hiddenIds.has("b"));
  assert.equal(index.groupsByProductId.get("a")?.choices[1]?.productId, "b");
});
