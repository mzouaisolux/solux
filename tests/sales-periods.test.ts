/**
 * Sales & Analytics — period comparison engine (dashboards §6). Register is the
 * source of truth; NULL sales_amount is excluded (never 0).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  periodOf, periodsFor, periodLabel, salesByYearPeriod, latestMonth,
  ytdSum, growthPct, cumulativeByMonth, salerNames, type PeriodOrder,
} from "../lib/sales/periods.ts";

const O: PeriodOrder[] = [
  { year: 2025, month: 2, saler: "HAMZA", sales_amount: 100 },
  { year: 2025, month: 5, saler: "HAMZA", sales_amount: 200 },
  { year: 2025, month: 8, saler: "MEHDI", sales_amount: 300 },
  { year: 2026, month: 1, saler: "HAMZA", sales_amount: 150 },
  { year: 2026, month: 2, saler: "HAMZA", sales_amount: null }, // à compléter — excluded
  { year: 2026, month: 3, saler: "mehdi", sales_amount: 50 },   // lowercase saler
];

test("periodOf: quarter / semester / year, null-safe", () => {
  assert.equal(periodOf(1, "quarter"), 1);
  assert.equal(periodOf(3, "quarter"), 1);
  assert.equal(periodOf(4, "quarter"), 2);
  assert.equal(periodOf(12, "quarter"), 4);
  assert.equal(periodOf(6, "semester"), 1);
  assert.equal(periodOf(7, "semester"), 2);
  assert.equal(periodOf(5, "year"), 1);
  assert.equal(periodOf(null, "quarter"), null);
  assert.equal(periodOf(13, "quarter"), null);
  assert.deepEqual(periodsFor("quarter"), [1, 2, 3, 4]);
  assert.equal(periodLabel("quarter", 3), "T3");
  assert.equal(periodLabel("semester", 2), "S2");
});

test("salesByYearPeriod sums per period, excludes nulls", () => {
  const q = salesByYearPeriod(O, "quarter");
  assert.equal(q.get(2025)?.get(1), 100);
  assert.equal(q.get(2025)?.get(2), 200);
  assert.equal(q.get(2025)?.get(3), 300);
  assert.equal(q.get(2026)?.get(1), 200); // 150 + 50 (Feb null excluded)
  const s = salesByYearPeriod(O, "semester");
  assert.equal(s.get(2025)?.get(1), 300); // 100 + 200
  assert.equal(s.get(2025)?.get(2), 300); // 300
});

test("latestMonth + ytdSum align periods for a fair YoY", () => {
  assert.equal(latestMonth(O, 2026), 3);
  assert.equal(ytdSum(O, 2026, 3), 200);
  assert.equal(ytdSum(O, 2025, 3), 100); // only Feb ≤ month 3
  assert.equal(ytdSum(O, 2026, 3, "HAMZA"), 150);
  assert.equal(ytdSum(O, 2025, 3, "hamza"), 100); // case-insensitive
});

test("growthPct: positive, negative, null base", () => {
  assert.equal(growthPct(200, 100), 100);
  assert.equal(growthPct(80, 100), -20);
  assert.equal(growthPct(100, 0), null);
});

test("cumulativeByMonth is a running total, nulls excluded", () => {
  const c = cumulativeByMonth(O, 2026);
  assert.equal(c[1], 150);
  assert.equal(c[2], 150); // Feb null adds nothing
  assert.equal(c[3], 200);
  assert.equal(c[12], 200);
});

test("salerNames distinct, uppercased", () => {
  assert.deepEqual(salerNames(O).sort(), ["HAMZA", "MEHDI"]);
});
