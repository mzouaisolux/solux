/**
 * Customer-history rollup — first/last order, lifetime revenue (per currency),
 * average & largest order, products purchased, year-by-year timeline.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCustomerHistory,
  type HistoryDoc,
  type HistoryLineRef,
} from "../lib/import/history-stats.ts";

const DOCS: HistoryDoc[] = [
  { id: "1", number: "INV-2018-001", doc_date: "2018-03-01", currency: "EUR", total_amount: 1000 },
  { id: "2", number: "INV-2019-050", doc_date: "2019-06-15", currency: "EUR", total_amount: 3000 },
  { id: "3", number: "INV-2020-017", doc_date: "2020-01-10", currency: "EUR", total_amount: 2000 },
];

const LINES = new Map<string, HistoryLineRef[]>([
  ["1", [{ product_id: "pA", matched_product_name: "Solar Light", quantity: 10 }]],
  ["2", [
    { product_id: "pA", matched_product_name: "Solar Light", quantity: 5 },
    { product_id: "pB", matched_product_name: "Pole", quantity: 2 },
  ]],
  ["3", [{ product_id: "pB", matched_product_name: "Pole", quantity: 3 }]],
]);

test("rolls up the full commercial history", () => {
  const h = buildCustomerHistory(DOCS, LINES);

  assert.equal(h.count, 3);
  assert.equal(h.firstOrder?.number, "INV-2018-001");
  assert.equal(h.lastOrder?.number, "INV-2020-017");

  assert.equal(h.lifetimeRevenueByCurrency["EUR"], 6000);
  assert.equal(h.averageOrderValueByCurrency["EUR"], 2000);

  assert.equal(h.largestOrder?.number, "INV-2019-050");
  assert.equal(h.largestOrder?.amount, 3000);
  assert.equal(h.largestOrder?.currency, "EUR");

  // pA appears in 2 orders (qty 15), pB in 2 orders (qty 5) -> pA first (more qty).
  assert.equal(h.productsPurchased[0].name, "Solar Light");
  assert.equal(h.productsPurchased[0].orders, 2);
  assert.equal(h.productsPurchased[0].quantity, 15);
  assert.equal(h.productsPurchased.length, 2);

  // Timeline newest-year-first.
  assert.deepEqual(h.timeline.map((t) => t.year), ["2020", "2019", "2018"]);
  assert.equal(h.timeline[0].docs[0].number, "INV-2020-017");
});

test("handles an empty history without throwing", () => {
  const h = buildCustomerHistory([], new Map());
  assert.equal(h.count, 0);
  assert.equal(h.firstOrder, null);
  assert.equal(h.lastOrder, null);
  assert.equal(h.largestOrder, null);
  assert.deepEqual(h.productsPurchased, []);
  assert.deepEqual(h.timeline, []);
});
