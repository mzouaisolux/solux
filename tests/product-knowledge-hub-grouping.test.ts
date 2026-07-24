/**
 * Knowledge Hub — Line → Range → Product grouping (m162).
 * Locks in: catalog ordering by line/range/family position, an "Unclassified"
 * bucket that always sorts last, and the flat-list fallback signal when nothing
 * is classified (single Unclassified line).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { groupFamiliesByLineRange, UNCLASSIFIED } from "../features/product-knowledge-hub/lib/group.ts";
import type { FamilySummary } from "../features/product-knowledge-hub/lib/types.ts";

function fam(p: Partial<FamilySummary> & { id: string; name: string }): FamilySummary {
  return {
    position: null,
    modelCount: 0,
    models: [],
    currentVersion: null,
    lastUpdated: null,
    pending: false,
    line: null,
    range: null,
    linePosition: null,
    rangePosition: null,
    ...p,
  };
}

test("groups by line then range in catalog order", () => {
  const families = [
    fam({ id: "vandal", name: "Vandal", line: "Urban Lighting Line", range: "Vandal-Resistant Bollards", linePosition: 1, rangePosition: 6 }),
    fam({ id: "aos", name: "AOS Performance", line: "Street & Area Lighting Line", range: "Integrated Solar Street Lights", linePosition: 0, rangePosition: 0 }),
    fam({ id: "ada", name: "Ada", line: "Urban Lighting Line", range: "Solar Bollards", linePosition: 1, rangePosition: 5 }),
  ];
  const g = groupFamiliesByLineRange(families);
  assert.deepEqual(g.map((l) => l.line), ["Street & Area Lighting Line", "Urban Lighting Line"]);
  // Urban line: Solar Bollards (pos 5) before Vandal-Resistant Bollards (pos 6)
  const urban = g[1];
  assert.deepEqual(urban.ranges.map((r) => r.range), ["Solar Bollards", "Vandal-Resistant Bollards"]);
  assert.equal(urban.ranges[0].families[0].name, "Ada");
});

test("unclassified families fall into an Unclassified bucket that sorts last", () => {
  const families = [
    fam({ id: "konos", name: "Konos" }), // no line/range
    fam({ id: "aos", name: "AOS Performance", line: "Street & Area Lighting Line", range: "Integrated Solar Street Lights", linePosition: 0, rangePosition: 0 }),
  ];
  const g = groupFamiliesByLineRange(families);
  assert.equal(g[g.length - 1].line, UNCLASSIFIED);
  assert.equal(g[g.length - 1].ranges[0].range, UNCLASSIFIED);
  assert.equal(g[g.length - 1].ranges[0].families[0].name, "Konos");
});

test("all-unclassified yields a single Unclassified line (flat fallback signal)", () => {
  const g = groupFamiliesByLineRange([fam({ id: "a", name: "A" }), fam({ id: "b", name: "B" })]);
  assert.equal(g.length, 1);
  assert.equal(g[0].line, UNCLASSIFIED);
  assert.equal(g[0].ranges[0].families.length, 2);
});

test("a family with a line but no range buckets under Unclassified within that line", () => {
  const g = groupFamiliesByLineRange([
    fam({ id: "x", name: "X", line: "Street & Area Lighting Line", linePosition: 0 }),
  ]);
  assert.equal(g[0].line, "Street & Area Lighting Line");
  assert.equal(g[0].ranges[0].range, UNCLASSIFIED);
});
