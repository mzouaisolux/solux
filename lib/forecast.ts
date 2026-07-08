/**
 * Sales forecasting — pure types + helpers.
 *
 * Design philosophy
 * -----------------
 * The forecast is a thin projection layer on top of the quotation
 * (the `documents` row). No separate opportunity object. This module
 * holds only pure logic — types, the allowed probability values,
 * staleness detection, weighting + time-bucketing. No DB access, so
 * it's safe to import from both client (chips) and server (the
 * /forecast page aggregations).
 *
 * ONE dial only: PROBABILITY. It is a CONTROLLED value — a dropdown of
 * exact percentages, never free text, never ranges, never qualitative
 * buckets (the old Pipeline / Best case / Commit categories are gone).
 * The weighted forecast is simply value × probability.
 */

/* ============================================================
   Probability — controlled exact values, not free numeric
   ============================================================ */

export type ForecastProbability =
  | 10 | 20 | 30 | 40 | 50 | 60 | 70 | 80 | 90 | 95 | 100;

/** The ONLY selectable probability values, in display order.
 *  100% = won / confirmed order; 95% = almost certain, not yet
 *  confirmed. Anything else (33%, 45%, 67%…) is rejected. */
export const ALLOWED_PROBABILITIES: readonly ForecastProbability[] = [
  10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100,
];

export function isAllowedProbability(n: number): n is ForecastProbability {
  return (ALLOWED_PROBABILITIES as readonly number[]).includes(n);
}

export type ProbabilityOption = {
  value: ForecastProbability;
  /** Display label — always the exact percentage. */
  label: string;
  /** Operational meaning, surfaced as tooltip + methodology text. */
  meaning: string;
};

/**
 * The shared probability glossary. The whole company reads these the
 * same way — a "50%" from one rep must mean the same as a "50%" from
 * another. Labels are the exact percentages (the spec: no stages, no
 * ranges, no categories — only controlled values).
 */
export const PROBABILITY_OPTIONS: ProbabilityOption[] = [
  { value: 10, label: "10%", meaning: "Early interest — no real engagement yet." },
  { value: 20, label: "20%", meaning: "First exchanges — the client is responding." },
  { value: 30, label: "30%", meaning: "Active discussion — questions, back-and-forth." },
  { value: 40, label: "40%", meaning: "Genuine interest — specs being discussed." },
  { value: 50, label: "50%", meaning: "Serious — technical validation underway." },
  { value: 60, label: "60%", meaning: "Budget being confirmed — shortlist stage." },
  { value: 70, label: "70%", meaning: "Budget confirmed — terms under negotiation." },
  { value: 80, label: "80%", meaning: "Client intends to buy — final details open." },
  { value: 90, label: "90%", meaning: "Verbal commitment — closing imminent." },
  { value: 95, label: "95%", meaning: "Almost certain — not fully confirmed yet." },
  { value: 100, label: "100%", meaning: "Won / confirmed order." },
];

export function probabilityLabel(p: number | null | undefined): string {
  if (p == null) return "—";
  return `${p}%`;
}

export function probabilityMeaning(p: number | null | undefined): string | null {
  if (p == null) return null;
  return PROBABILITY_OPTIONS.find((o) => o.value === p)?.meaning ?? null;
}

/* ============================================================
   Staleness
   ============================================================ */

export const FORECAST_STALE_DAYS = 30;

/**
 * A forecast is stale when it carries a probability but hasn't been
 * touched in FORECAST_STALE_DAYS. Inactive forecasts drift out of
 * reality fast, so we nudge sales with an orange warning.
 *
 * No probability set → not stale (there's nothing to keep fresh yet).
 */
export function isForecastStale(
  updatedAt: string | null | undefined,
  hasProbability: boolean
): boolean {
  if (!hasProbability) return false;
  if (!updatedAt) return true; // has a forecast but no timestamp = treat stale
  const ageMs = Date.now() - new Date(updatedAt).getTime();
  return ageMs > FORECAST_STALE_DAYS * 86_400_000;
}

/** Whole days since the forecast was last updated (null when never). */
export function forecastAgeDays(
  updatedAt: string | null | undefined
): number | null {
  if (!updatedAt) return null;
  const ageMs = Date.now() - new Date(updatedAt).getTime();
  return Math.floor(ageMs / 86_400_000);
}

/* ============================================================
   Weighting + value
   ============================================================ */

/** total × probability/100. Returns 0 when either input is missing. */
export function weightedValue(
  total: number | null | undefined,
  probability: number | null | undefined
): number {
  if (!total || !probability) return 0;
  return total * (probability / 100);
}

/* ============================================================
   Time bucketing
   ============================================================ */

/** "2026-Q2" — sortable quarter key from an ISO date. */
export function quarterKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `${d.getUTCFullYear()}-Q${q}`;
}

/** "Q2 2026" — display label from a quarter key. */
export function quarterLabel(key: string): string {
  const m = key.match(/^(\d{4})-Q(\d)$/);
  if (!m) return key;
  return `Q${m[2]} ${m[1]}`;
}

/** "2026-05" — sortable month key. */
export function monthKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Quarter key for "now" — used by the "closing this quarter" KPI. */
export function currentQuarterKey(now: Date = new Date()): string {
  const q = Math.floor(now.getUTCMonth() / 3) + 1;
  return `${now.getUTCFullYear()}-Q${q}`;
}

/** True when the deal's expected close date lands in the current
 *  quarter. Deals with no close date are excluded (we can't place
 *  them on the calendar). */
export function closesThisQuarter(
  expectedCloseDate: string | null | undefined,
  now: Date = new Date()
): boolean {
  const k = quarterKey(expectedCloseDate);
  return k != null && k === currentQuarterKey(now);
}

/* ============================================================
   Aggregation
   ============================================================ */

/** A normalized forecast row the aggregations operate on. Built by the
 *  /forecast page from the raw documents query.
 *
 *  Note: `probability` may be null — the workspace loads ALL active
 *  quotations (so sales can set a forecast inline), not just the ones
 *  already forecasted. The KPI aggregations simply contribute 0
 *  weighted for null-probability rows. */
export type ForecastDeal = {
  id: string;
  number: string | null;
  /** Client company name — shown in the workspace table. */
  clientName: string | null;
  /** Quotation status (sent / negotiating). */
  status: string;
  total: number;
  currency: string;
  probability: ForecastProbability | null;
  expectedCloseDate: string | null;
  updatedAt: string | null;
  ownerId: string | null;
  country: string | null;
  /** Dominant product family on the deal (most-valued line's category). */
  productFamily: string | null;
  /** Versioning (m059) — used to keep only the latest version of an
   *  affair in the pipeline so V1+V2 don't double-count. */
  version: number;
  rootId: string | null;
};

export type ForecastTotals = {
  /** Sum of total × probability across all forecasted deals. */
  weighted: number;
  /** Raw count of forecasted deals. */
  count: number;
  /** Count of stale forecasts. */
  staleCount: number;
};

/**
 * Headline totals. Currency-naive on purpose — the page passes a
 * single-currency subset (or accepts that mixed books are summed at
 * face value, which the UI annotates). Keeping this pure + simple
 * beats baking FX into the aggregation.
 */
export function computeForecastTotals(deals: ForecastDeal[]): ForecastTotals {
  let weighted = 0;
  let staleCount = 0;
  for (const d of deals) {
    weighted += weightedValue(d.total, d.probability);
    if (isForecastStale(d.updatedAt, d.probability != null)) staleCount++;
  }
  return { weighted, count: deals.length, staleCount };
}

export type ForecastBucket = {
  key: string;
  label: string;
  /** Weighted revenue in this bucket. */
  weighted: number;
  /** Raw (unweighted) revenue. */
  raw: number;
  count: number;
};

/**
 * Generic grouping. `keyFn` returns the bucket key + label per deal
 * (null → deal is skipped, e.g. no expected close date). Buckets come
 * back sorted by the provided comparator (default: key ascending).
 */
export function groupForecast(
  deals: ForecastDeal[],
  keyFn: (d: ForecastDeal) => { key: string; label: string } | null,
  sort?: (a: ForecastBucket, b: ForecastBucket) => number
): ForecastBucket[] {
  const map = new Map<string, ForecastBucket>();
  for (const d of deals) {
    const k = keyFn(d);
    if (!k) continue;
    const existing =
      map.get(k.key) ??
      { key: k.key, label: k.label, weighted: 0, raw: 0, count: 0 };
    existing.weighted += weightedValue(d.total, d.probability);
    existing.raw += d.total;
    existing.count += 1;
    map.set(k.key, existing);
  }
  const out = Array.from(map.values());
  out.sort(sort ?? ((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)));
  return out;
}

/** Quarter breakdown — sorted chronologically. */
export function forecastByQuarter(deals: ForecastDeal[]): ForecastBucket[] {
  return groupForecast(deals, (d) => {
    const k = quarterKey(d.expectedCloseDate);
    if (!k) return null;
    return { key: k, label: quarterLabel(k) };
  });
}

/**
 * Exact-probability breakdown — one bucket per allowed value that has
 * at least one deal, sorted ascending (10% … 100%). This is the
 * "forecast grouped by exact probability" dashboard view: value at
 * 10%, at 20%, … at 95%, at 100%. No ranges, no categories.
 */
export function forecastByProbability(deals: ForecastDeal[]): ForecastBucket[] {
  return groupForecast(
    deals,
    (d) => {
      if (d.probability == null) return null;
      // Zero-pad so string sort = numeric sort (010 < 095 < 100).
      return {
        key: String(d.probability).padStart(3, "0"),
        label: `${d.probability}%`,
      };
    }
  );
}

/** Owner breakdown — sorted by weighted revenue descending. Labels are
 *  resolved by the caller (we only have ids here). */
export function forecastByOwner(
  deals: ForecastDeal[],
  labelById: Map<string, string>
): ForecastBucket[] {
  return groupForecast(
    deals,
    (d) => {
      const id = d.ownerId ?? "unassigned";
      return {
        key: id,
        label: labelById.get(id) ?? (d.ownerId ? id.slice(0, 8) + "…" : "Unassigned"),
      };
    },
    (a, b) => b.weighted - a.weighted
  );
}

/** Country breakdown — sorted by weighted revenue descending. */
export function forecastByCountry(deals: ForecastDeal[]): ForecastBucket[] {
  return groupForecast(
    deals,
    (d) => {
      const c = (d.country ?? "").trim();
      return { key: c || "—", label: c || "Unknown country" };
    },
    (a, b) => b.weighted - a.weighted
  );
}

/** Product-family breakdown — sorted by weighted revenue descending. */
export function forecastByFamily(deals: ForecastDeal[]): ForecastBucket[] {
  return groupForecast(
    deals,
    (d) => {
      const f = (d.productFamily ?? "").trim();
      return { key: f || "—", label: f || "Uncategorized" };
    },
    (a, b) => b.weighted - a.weighted
  );
}

/** Format a currency amount compactly for KPI cards (no decimals). */
export function fmtMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    // Unknown currency code — fall back to plain number + suffix.
    return `${Math.round(amount).toLocaleString()} ${currency}`;
  }
}
