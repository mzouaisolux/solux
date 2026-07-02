/**
 * Sales & Analytics — saler & revenue KPIs (module spec §3, the critical rule).
 *
 * WHY THIS EXISTS — two traps already produced wrong numbers in the old sheet:
 *   1. An in-progress order had an EMPTY sales_amount but WAS already credited
 *      to the saler in the manual monthly subtotal. Summing order lines
 *      under-counts the saler (this is what mis-stated Hamza 2026).
 *   2. A per-tab "TOTAL" row double-counted the year (already stripped upstream).
 *
 * THE RULE — never mix the two sources on the same period:
 *   - HISTORICAL (a period that HAS monthly_sales_history rows) → the KPI is the
 *     sum of monthly_sales_history.sales. This is the hand-verified truth.
 *   - NATIVE (a period with NO monthly rows — future/ERP-entered) → the KPI is
 *     the aggregation of sales_orders. A row with NULL sales_amount is EXCLUDED
 *     and flagged, never counted as 0.
 *
 * Money is bucketed PER CURRENCY (the register is multi-currency); we never sum
 * across currencies — same discipline as the client workspace rollups.
 *
 * Pure + structurally typed so it runs over BOTH parsed-CSV rows and DB rows.
 */

export type MonthlyLike = { year: number; month: number; saler: string; sales: number };
export type OrderLike = {
  year: number | null;
  saler: string | null;
  sales_amount: number | null;
  pi_amount?: number | null;
  transportation?: number | null;
  received_amount?: number | null;
  balance?: number | null;
  currency?: string | null;
};

const up = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();

// ── monthly (historical) indexes ────────────────────────────────────────────

/** `${SALER}|${year}` → summed sales. The historical source of truth. */
export function indexMonthlyBySalerYear(rows: readonly MonthlyLike[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = `${up(r.saler)}|${r.year}`;
    m.set(k, (m.get(k) ?? 0) + (Number(r.sales) || 0));
  }
  return m;
}

/** year → summed sales across all salers (historical CA). */
export function revenueByYearFromMonthly(rows: readonly MonthlyLike[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const r of rows) m.set(r.year, (m.get(r.year) ?? 0) + (Number(r.sales) || 0));
  return m;
}

// ── the §3 router ───────────────────────────────────────────────────────────

export type SalerSource = "monthly" | "orders";
export type SalerPerformance = {
  saler: string;
  year: number;
  source: SalerSource;
  sales: number;
  /** orders considered (only meaningful when source === "orders"). */
  orderCount: number;
  /** orders skipped because sales_amount was null (never counted as 0). */
  excludedCount: number;
};

/**
 * A single saler's performance for one year, routing to the correct source.
 * If monthly_sales_history has ANY row for (saler, year) it wins outright — the
 * orders are NOT added (that is precisely how double/under-counting is avoided).
 */
export function salerPerformance(
  saler: string,
  year: number,
  monthlyIndex: Map<string, number>,
  orders: readonly OrderLike[],
): SalerPerformance {
  const key = `${up(saler)}|${year}`;
  if (monthlyIndex.has(key)) {
    return { saler: up(saler), year, source: "monthly", sales: monthlyIndex.get(key) ?? 0, orderCount: 0, excludedCount: 0 };
  }
  let sales = 0, orderCount = 0, excludedCount = 0;
  for (const o of orders) {
    if (o.year !== year || up(o.saler) !== up(saler)) continue;
    orderCount++;
    if (o.sales_amount == null) { excludedCount++; continue; }
    sales += Number(o.sales_amount) || 0;
  }
  return { saler: up(saler), year, source: "orders", sales, orderCount, excludedCount };
}

/** Company CA for one year: monthly when the year is historical, else orders. */
export function revenueForYear(
  year: number,
  monthlyByYear: Map<number, number>,
  orders: readonly OrderLike[],
): { year: number; source: SalerSource; sales: number } {
  if (monthlyByYear.has(year)) {
    return { year, source: "monthly", sales: monthlyByYear.get(year) ?? 0 };
  }
  let sales = 0;
  for (const o of orders) {
    if (o.year !== year || o.sales_amount == null) continue;
    sales += Number(o.sales_amount) || 0;
  }
  return { year, source: "orders", sales };
}

/** True when an order must be excluded from a KPI (no amount → never a 0). */
export function isExcludedFromKpi(o: OrderLike): boolean {
  return o.sales_amount == null;
}

// ── order-level financials (per currency) ──────────────────────────────────

export type CurrencyTotals = {
  currency: string;
  count: number;
  piAmount: number;
  salesAmount: number;
  received: number;
  balance: number;
};

/** Encaissé vs facturé, solde restant (§6) — bucketed per currency, never summed
 *  across currencies. Nulls are ignored, not treated as 0. */
export function financialTotalsByCurrency(
  orders: readonly OrderLike[],
  defaultCurrency = "USD",
): Map<string, CurrencyTotals> {
  const m = new Map<string, CurrencyTotals>();
  for (const o of orders) {
    const cur = (o.currency ?? "").trim() || defaultCurrency;
    const t = m.get(cur) ?? { currency: cur, count: 0, piAmount: 0, salesAmount: 0, received: 0, balance: 0 };
    t.count += 1;
    if (o.pi_amount != null) t.piAmount += Number(o.pi_amount) || 0;
    if (o.sales_amount != null) t.salesAmount += Number(o.sales_amount) || 0;
    if (o.received_amount != null) t.received += Number(o.received_amount) || 0;
    if (o.balance != null) t.balance += Number(o.balance) || 0;
    m.set(cur, t);
  }
  return m;
}
