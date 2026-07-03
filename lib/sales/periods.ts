/**
 * Sales & Analytics — period comparison engine (dashboards §6, v2).
 *
 * SOURCE OF TRUTH = the sales_orders register (owner decision 2026-07-02): it is
 * updated continuously, so per-client and per-saler sales are summed from it.
 * A NULL sales_amount is EXCLUDED, never counted as 0 (§3) — such orders are
 * "à compléter" and surfaced separately, not silently zeroed.
 *
 * Pure + dependency-free (unit-tested). Quarter / semester / year-to-date
 * bucketing + year-over-year growth, company-wide and per saler.
 */

export type PeriodOrder = {
  year: number | null;
  month: number | null;
  saler: string | null;
  sales_amount: number | null;
};

export type Granularity = "quarter" | "semester" | "year";

const up = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();
const amt = (o: PeriodOrder) => (o.sales_amount == null ? null : Number(o.sales_amount) || 0);

/** Month (1..12) → period index for the granularity, or null if no month. */
export function periodOf(month: number | null | undefined, g: Granularity): number | null {
  if (month == null || month < 1 || month > 12) return null;
  if (g === "quarter") return Math.ceil(month / 3); // 1..4
  if (g === "semester") return month <= 6 ? 1 : 2; // 1..2
  return 1;
}

export function periodsFor(g: Granularity): number[] {
  return g === "quarter" ? [1, 2, 3, 4] : g === "semester" ? [1, 2] : [1];
}

export function periodLabel(g: Granularity, p: number): string {
  if (g === "quarter") return `T${p}`;
  if (g === "semester") return `S${p}`;
  return "Année";
}

/** year → period → summed sales (register truth, nulls excluded). */
export function salesByYearPeriod(orders: readonly PeriodOrder[], g: Granularity): Map<number, Map<number, number>> {
  const m = new Map<number, Map<number, number>>();
  for (const o of orders) {
    const a = amt(o);
    if (o.year == null || a == null) continue;
    const p = periodOf(o.month, g);
    if (p == null) continue;
    if (!m.has(o.year)) m.set(o.year, new Map());
    const ym = m.get(o.year)!;
    ym.set(p, (ym.get(p) ?? 0) + a);
  }
  return m;
}

/** The latest month with amount-bearing data for a year (defines the YTD cutoff). */
export function latestMonth(orders: readonly PeriodOrder[], year: number): number {
  let mx = 0;
  for (const o of orders) {
    if (o.year !== year || amt(o) == null || o.month == null) continue;
    if (o.month >= 1 && o.month <= 12) mx = Math.max(mx, o.month);
  }
  return mx;
}

/** Sum for a year over months [1..throughMonth], optionally one saler. */
export function ytdSum(orders: readonly PeriodOrder[], year: number, throughMonth: number, saler?: string): number {
  let s = 0;
  for (const o of orders) {
    const a = amt(o);
    if (o.year !== year || a == null || o.month == null || o.month < 1 || o.month > throughMonth) continue;
    if (saler && up(o.saler) !== up(saler)) continue;
    s += a;
  }
  return s;
}

/** Year-over-year % growth, or null when the base is 0/absent. */
export function growthPct(current: number, previous: number): number | null {
  if (!previous || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

/** Cumulative sales by month (index 1..12) for a year, optionally one saler. */
export function cumulativeByMonth(orders: readonly PeriodOrder[], year: number, saler?: string): number[] {
  const perMonth = new Array(13).fill(0);
  for (const o of orders) {
    const a = amt(o);
    if (o.year !== year || a == null || o.month == null || o.month < 1 || o.month > 12) continue;
    if (saler && up(o.saler) !== up(saler)) continue;
    perMonth[o.month] += a;
  }
  const cum = new Array(13).fill(0);
  for (let i = 1; i <= 12; i++) cum[i] = cum[i - 1] + perMonth[i];
  return cum;
}

/** Distinct saler names present (uppercased), excluding blank. */
export function salerNames(orders: readonly PeriodOrder[]): string[] {
  return [...new Set(orders.map((o) => up(o.saler)).filter((n) => n))];
}
