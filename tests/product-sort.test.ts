/**
 * Tests for natural product ordering (lib/product-sort).
 *
 * Run with:  npm test   (Node ≥ 22.6, built-in runner + native TS stripping)
 *
 * Locks in the exact AOSPRO+ business order from the Excel cost file: model
 * number ascending, standard version before its IoT variant.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  naturalProductSort,
  sortProductsByName,
  compareNatural,
} from "../lib/product-sort.ts";

// The exact order finance uses in the Excel cost file.
const AOSPRO_EXPECTED = [
  "AOSPRO+20",
  "AOSPRO+20 IoT version",
  "AOSPRO+30",
  "AOSPRO+30 IoT version",
  "AOSPRO+40",
  "AOSPRO+40 IoT version",
  "AOSPRO+50",
  "AOSPRO+50 IoT version",
  "AOSPRO+60",
  "AOSPRO+60 IoT version",
  "AOSPRO+80",
  "AOSPRO+80 IoT version",
  "AOSPRO+100",
  "AOSPRO+100 IoT version",
  "AOSPRO+120",
  "AOSPRO+120 IoT version",
];

test("AOSPRO+ — sorts into the exact Excel business order", () => {
  // Start from a deliberately scrambled order (incl. the ASCII trap where
  // "AOSPRO+100" would wrongly precede "AOSPRO+20").
  const scrambled = [
    "AOSPRO+100",
    "AOSPRO+20 IoT version",
    "AOSPRO+120 IoT version",
    "AOSPRO+30",
    "AOSPRO+20",
    "AOSPRO+100 IoT version",
    "AOSPRO+80",
    "AOSPRO+40 IoT version",
    "AOSPRO+50",
    "AOSPRO+60 IoT version",
    "AOSPRO+30 IoT version",
    "AOSPRO+120",
    "AOSPRO+40",
    "AOSPRO+60",
    "AOSPRO+80 IoT version",
    "AOSPRO+50 IoT version",
  ].map((name, i) => ({ id: `id-${i}`, name, sku: null }));

  const sorted = sortProductsByName(scrambled).map((p) => p.name);
  assert.deepEqual(sorted, AOSPRO_EXPECTED);
});

test("ASCII trap — 100 sorts after 20, not before", () => {
  assert.ok(compareNatural("AOSPRO+20", "AOSPRO+100") < 0);
  assert.ok(compareNatural("AOSPRO+100", "AOSPRO+120") < 0);
});

test("standard model sorts before its IoT variant", () => {
  assert.ok(compareNatural("AOSPRO+20", "AOSPRO+20 IoT version") < 0);
  // …and the IoT-20 still sorts before the standard-30.
  assert.ok(compareNatural("AOSPRO+20 IoT version", "AOSPRO+30") < 0);
});

test("different families sort by family name first", () => {
  const input = [
    { id: "1", name: "COLARSUN+30", sku: null },
    { id: "2", name: "AOSPRO+100", sku: null },
    { id: "3", name: "AOSPRO+20", sku: null },
    { id: "4", name: "COLARSUN+5", sku: null },
  ];
  assert.deepEqual(sortProductsByName(input).map((p) => p.name), [
    "AOSPRO+20",
    "AOSPRO+100",
    "COLARSUN+5",
    "COLARSUN+30",
  ]);
});

test("comparator is reflexive / antisymmetric on equal names", () => {
  const a = { id: "a", name: "AOSPRO+40", sku: "SKU-A" };
  const b = { id: "b", name: "AOSPRO+40", sku: "SKU-A" };
  assert.equal(naturalProductSort(a, a), 0);
  // equal name + sku → deterministic, opposite-signed by id tie-break
  assert.ok(naturalProductSort(a, b) < 0);
  assert.ok(naturalProductSort(b, a) > 0);
});

test("tolerates null/empty/missing names without throwing", () => {
  const input = [
    { id: "1", name: "AOSPRO+30", sku: null },
    { id: "2", name: null, sku: null },
    { id: "3", name: "", sku: null },
    { id: "4", name: "AOSPRO+20", sku: null },
  ];
  const sorted = sortProductsByName(input).map((p) => p.name);
  // Empty/null names sort first (shortest), real names keep natural order.
  assert.deepEqual(sorted.slice(2), ["AOSPRO+20", "AOSPRO+30"]);
});
