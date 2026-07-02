/**
 * Product matching — remembered mapping > exact SKU > exact name > fuzzy >
 * unmatched. The remembered mapping is what makes future imports one-click.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchProductLine,
  type ProductCandidate,
  type MappingEntry,
} from "../lib/import/product-match.ts";
import { productNameKey } from "../lib/import/normalize.ts";

const CATALOG: ProductCandidate[] = [
  { id: "p1", name: "Solar Street Light 60W", sku: "SSL-60", categoryId: "c1", categoryName: "Lighting" },
  { id: "p2", name: "Steel Pole 8m", sku: "POLE-8", categoryId: "c2", categoryName: "Poles" },
  { id: "pL", name: "Legacy Widget", sku: null, categoryId: null, categoryName: null, isLegacy: true },
];

const noMappings = new Map<string, MappingEntry>();

test("exact SKU printed as the line code links immediately", () => {
  const m = matchProductLine("SSL-60", null, CATALOG, noMappings);
  assert.equal(m.productId, "p1");
  assert.equal(m.method, "exact_sku");
  assert.equal(m.needsReview, false);
});

test("exact product name links immediately", () => {
  const m = matchProductLine("Solar Street Light 60W", null, CATALOG, noMappings);
  assert.equal(m.productId, "p1");
  assert.equal(m.method, "exact_name");
});

test("a near-identical description auto-links via fuzzy", () => {
  const m = matchProductLine("Solar Street Light 60 W", null, CATALOG, noMappings);
  assert.equal(m.productId, "p1");
  assert.ok(m.method === "fuzzy" || m.method === "exact_name");
  assert.equal(m.needsReview, false);
});

test("an unknown product needs review and never touches legacy rows", () => {
  const m = matchProductLine("Mystery Gadget ZZZ", null, CATALOG, noMappings);
  assert.equal(m.productId, null);
  assert.equal(m.method, "unmatched");
  assert.equal(m.needsReview, true);
  // legacy product must not be auto-suggested/linked
  assert.notEqual(m.suggestion?.id, "pL");
});

test("a remembered 'map' mapping wins over everything and needs no review", () => {
  const mappings = new Map<string, MappingEntry>([
    [productNameKey("Random Old Name"), { action: "map", productId: "p2" }],
  ]);
  const m = matchProductLine("Random Old Name", null, CATALOG, mappings);
  assert.equal(m.productId, "p2");
  assert.equal(m.method, "manual");
  assert.equal(m.needsReview, false);
});

test("a remembered 'ignore' mapping drops the line silently on future imports", () => {
  const mappings = new Map<string, MappingEntry>([
    [productNameKey("Freight Charge"), { action: "ignore", productId: null }],
  ]);
  const m = matchProductLine("Freight Charge", null, CATALOG, mappings);
  assert.equal(m.method, "ignored");
  assert.equal(m.needsReview, false);
  assert.equal(m.productId, null);
});
