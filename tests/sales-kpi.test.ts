/**
 * Sales & Analytics — the §3 KPI rule (the one that must never be wrong).
 *
 * Encodes both traps directly:
 *   - historical period → monthly_sales_history wins; order lines are NOT summed
 *     (this is the Hamza-2026 under-count), and
 *   - native period → order aggregation, where a NULL sales_amount is EXCLUDED,
 *     never counted as 0.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  indexMonthlyBySalerYear,
  revenueByYearFromMonthly,
  salerPerformance,
  revenueForYear,
  isExcludedFromKpi,
  financialTotalsByCurrency,
} from "../lib/sales/kpi.ts";

const monthly = [
  { year: 2026, month: 3, saler: "HAMZA", sales: 1000 },
  { year: 2026, month: 4, saler: "HAMZA", sales: 500 },
];

test("HISTORICAL: monthly wins; in-progress order lines are NOT summed", () => {
  const idx = indexMonthlyBySalerYear(monthly);
  // Orders would under-count (200 present + 1 empty) — must be ignored.
  const orders = [
    { year: 2026, saler: "HAMZA", sales_amount: 200 },
    { year: 2026, saler: "HAMZA", sales_amount: null },
  ];
  const perf = salerPerformance("HAMZA", 2026, idx, orders);
  assert.equal(perf.source, "monthly");
  assert.equal(perf.sales, 1500); // NOT 200
});

test("NATIVE: no monthly → aggregate orders; NULL amount excluded, never 0", () => {
  const idx = indexMonthlyBySalerYear(monthly); // has HAMZA 2026 only
  const orders = [
    { year: 2030, saler: "GAVIN", sales_amount: 300 },
    { year: 2030, saler: "GAVIN", sales_amount: null }, // in-progress, excluded
    { year: 2030, saler: "GAVIN", sales_amount: 700 },
  ];
  const perf = salerPerformance("GAVIN", 2030, idx, orders);
  assert.equal(perf.source, "orders");
  assert.equal(perf.sales, 1000);
  assert.equal(perf.orderCount, 3);
  assert.equal(perf.excludedCount, 1);
});

test("saler match is case-insensitive", () => {
  const idx = indexMonthlyBySalerYear(monthly);
  assert.equal(salerPerformance("hamza", 2026, idx, []).sales, 1500);
});

test("isExcludedFromKpi: null is excluded, 0 is a real amount", () => {
  assert.equal(isExcludedFromKpi({ year: 2026, saler: "X", sales_amount: null }), true);
  assert.equal(isExcludedFromKpi({ year: 2026, saler: "X", sales_amount: 0 }), false);
});

test("company revenue routes per year (monthly for historical, orders otherwise)", () => {
  const byYear = revenueByYearFromMonthly(monthly);
  assert.equal(revenueForYear(2026, byYear, []).source, "monthly");
  assert.equal(revenueForYear(2026, byYear, []).sales, 1500);
  const orders = [{ year: 2030, saler: "G", sales_amount: 900 }];
  assert.equal(revenueForYear(2030, byYear, orders).source, "orders");
  assert.equal(revenueForYear(2030, byYear, orders).sales, 900);
});

test("financials are bucketed per currency; nulls ignored (never summed across)", () => {
  const totals = financialTotalsByCurrency([
    { year: 2026, saler: "A", sales_amount: 90, pi_amount: 100, received_amount: 60, balance: 40, currency: "USD" },
    { year: 2026, saler: "A", sales_amount: 180, pi_amount: 200, received_amount: null, balance: 200, currency: "EUR" },
  ]);
  assert.equal(totals.size, 2);
  assert.equal(totals.get("USD")?.received, 60);
  assert.equal(totals.get("EUR")?.received, 0); // null ignored, not a phantom value
  assert.equal(totals.get("EUR")?.piAmount, 200);
});
