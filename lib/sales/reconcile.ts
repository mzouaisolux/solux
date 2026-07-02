/**
 * Sales & Analytics — reconciliation guard-rails (module spec §7).
 *
 * These are the owner's REAL control figures. The migration import calls this
 * at the end and fails loudly if any one is off; the same function runs as a
 * unit test over the source CSVs (see tests/sales-reconciliation.test.ts) so the
 * numbers are proven before a single row reaches the database.
 *
 * Pure: it takes already-parsed rows (no file I/O), so it is reusable from both
 * the Node import script and the test harness.
 */

import type { OrderRow, ClientRow, MonthlyRow } from "./csv.ts";
import { indexMonthlyBySalerYear, revenueByYearFromMonthly } from "./kpi.ts";

/** Rounding tolerance for money controls (expected values are rounded). */
const MONEY_TOLERANCE = 2;

export const EXPECTED = {
  ordersTotal: 1314,
  ordersByYear: {
    2019: 189, 2020: 187, 2021: 165, 2022: 148,
    2023: 176, 2024: 183, 2025: 170, 2026: 96,
  } as Record<number, number>,
  clientsTotal: 203,
  caByYear: {
    2019: 2112683, 2020: 3641650, 2021: 3126892, 2022: 3359310,
    2023: 3821627, 2024: 4174395, 2025: 3371396, 2026: 4015720,
  } as Record<number, number>,
  caTotal: 27623672,
  salerControls: [
    { saler: "HAMZA", year: 2026, expected: 2214455 },
    { saler: "MEHDI", year: 2019, expected: 1312408 },
    { saler: "ANTOINE", year: 2024, expected: 75600 },
    { saler: "FADEL", year: 2026, expected: 430033 },
    { saler: "SALES TEAM", year: 2025, expected: 308726 },
  ],
} as const;

export type ReconcileInput = {
  orders: OrderRow[];
  clients: ClientRow[];
  monthly: MonthlyRow[];
};

export type ReconcileResult = {
  ok: boolean;
  failures: string[];
  checks: { label: string; ok: boolean; expected: number; actual: number }[];
};

export function reconcile(input: ReconcileInput): ReconcileResult {
  const checks: ReconcileResult["checks"] = [];
  const add = (label: string, expected: number, actual: number, tol = 0) => {
    checks.push({ label, expected, actual, ok: Math.abs(expected - actual) <= tol });
  };

  // 1. orders total + per year
  add("orders total", EXPECTED.ordersTotal, input.orders.length);
  const ordersByYear = new Map<number, number>();
  for (const o of input.orders) if (o.year != null) ordersByYear.set(o.year, (ordersByYear.get(o.year) ?? 0) + 1);
  for (const [y, exp] of Object.entries(EXPECTED.ordersByYear)) {
    add(`orders ${y}`, exp, ordersByYear.get(Number(y)) ?? 0);
  }

  // 2. canonical clients
  add("clients total", EXPECTED.clientsTotal, input.clients.length);

  // 3. CA per year (from monthly_sales_history) + grand total
  const caYear = revenueByYearFromMonthly(input.monthly);
  let caTotal = 0;
  for (const [y, exp] of Object.entries(EXPECTED.caByYear)) {
    const actual = caYear.get(Number(y)) ?? 0;
    caTotal += actual;
    add(`CA ${y}`, exp, actual, MONEY_TOLERANCE);
  }
  add("CA total", EXPECTED.caTotal, caTotal, MONEY_TOLERANCE);

  // 4. saler key controls (from monthly_sales_history)
  const salerIdx = indexMonthlyBySalerYear(input.monthly);
  for (const c of EXPECTED.salerControls) {
    add(`${c.saler} ${c.year}`, c.expected, salerIdx.get(`${c.saler}|${c.year}`) ?? 0, MONEY_TOLERANCE);
  }

  const failures = checks
    .filter((c) => !c.ok)
    .map((c) => `${c.label}: expected ${c.expected}, got ${c.actual}`);
  return { ok: failures.length === 0, failures, checks };
}
