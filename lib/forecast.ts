/**
 * Sales forecasting — pure types + helpers.
 *
 * Design philosophy
 * -----------------
 * The forecast is a thin projection layer on top of the quotation
 * (the `documents` row). No separate opportunity object. This module
 * holds only pure logic — types, the probability ladder, category
 * definitions, staleness detection, weighting + time-bucketing. No DB
 * access, so it's safe to import from both client (chips) and server
 * (the /forecast page aggregations).
 *
 * Two operational dials, deliberately kept separate:
 *   - PROBABILITY  → quantitative likelihood (drives weighted revenue)
 *   - CATEGORY     → qualitative commit bucket (drives commit revenue)
 *
 * Probability alone isn't enough for management ("a 50% deal I'd bet
 * my quarter on" vs "a 50% deal that could evaporate") — the category
 * captures that judgment.
 */

/* ============================================================
   Probability stages — fixed ladder, not free numeric
   ============================================================ */

export type ForecastProbability = 10 | 25 | 50 | 75 | 90;

export type ProbabilityStage = {
  value: ForecastProbability;
  label: string;
  /** Short label for tight chip rows. */
  short: string;
  tone: ForecastTone;
  /** Expected confidence level, in plain words. */
  confidence: string;
  /** Operational definition — what this stage actually means. */
  meaning: string;
  /** The typical sales situation that maps to this stage. */
  situation: string;
};

/**
 * The shared forecast ladder. The whole company reads these the same
 * way — that's the entire point. The `meaning` / `situation` text is
 * the operational glossary surfaced as tooltips + the methodology
 * panel so a "50%" from one rep means the same as a "50%" from another.
 */
export const PROBABILITY_STAGES: ProbabilityStage[] = [
  {
    value: 10,
    label: "Cold",
    short: "Cold",
    tone: "neutral",
    confidence: "Low",
    meaning: "Early interest, no real engagement yet.",
    situation:
      "Quote sent, the client hasn't seriously engaged. Could easily go quiet.",
  },
  {
    value: 25,
    label: "Active discussion",
    short: "Active",
    tone: "info",
    confidence: "Low to medium",
    meaning: "The client is engaging — questions, back-and-forth.",
    situation:
      "Live conversation underway, but no technical or budget commitment yet.",
  },
  {
    value: 50,
    label: "Serious",
    short: "Serious",
    tone: "violet",
    confidence: "Medium",
    meaning: "Technically interested, configuration discussions active.",
    situation:
      "Specs being validated, budget not fully secured yet. The technical-validation moment.",
  },
  {
    value: 75,
    label: "Very likely",
    short: "Likely",
    tone: "amber",
    confidence: "Medium to high",
    meaning: "Budget confirmed, terms being finalized.",
    situation:
      "Client intends to buy, negotiating the final details (price, delivery, payment).",
  },
  {
    value: 90,
    label: "Expected win",
    short: "Win",
    tone: "success",
    confidence: "High",
    meaning: "Verbal or written commitment, closing imminent.",
    situation:
      "Only the paperwork or PO is left. You're counting on this one to land.",
  },
];

/** Look up the full stage record by value. */
export function probabilityStage(
  p: number | null | undefined
): ProbabilityStage | null {
  if (p == null) return null;
  return PROBABILITY_STAGES.find((s) => s.value === p) ?? null;
}

export function probabilityLabel(p: number | null | undefined): string {
  if (p == null) return "—";
  return PROBABILITY_STAGES.find((s) => s.value === p)?.label ?? `${p}%`;
}

/* ============================================================
   Forecast categories — operational commit buckets
   ============================================================ */

export type ForecastCategory =
  | "pipeline"
  | "best_case"
  | "commit"
  | "upside"
  | "at_risk";

export const FORECAST_CATEGORIES: Array<{
  value: ForecastCategory;
  label: string;
  tone: ForecastTone;
  description: string;
}> = [
  {
    value: "pipeline",
    label: "Pipeline",
    tone: "neutral",
    description: "In the funnel, no strong read yet",
  },
  {
    value: "best_case",
    label: "Best case",
    tone: "info",
    description: "Could land if things break our way",
  },
  {
    value: "commit",
    label: "Commit",
    tone: "success",
    description: "Confident — counting on this to close",
  },
  {
    value: "upside",
    label: "Upside",
    tone: "violet",
    description: "Not in the number, would be a bonus",
  },
  {
    value: "at_risk",
    label: "At risk",
    tone: "danger",
    description: "Slipping — needs intervention now",
  },
];

export function categoryLabel(c: string | null | undefined): string {
  if (!c) return "—";
  return (
    FORECAST_CATEGORIES.find((x) => x.value === c)?.label ?? c
  );
}

/* ============================================================
   Tone palette — shared chip chrome
   ============================================================ */

export type ForecastTone =
  | "neutral"
  | "info"
  | "violet"
  | "amber"
  | "success"
  | "danger";

/** Idle (unselected) chip chrome. */
export const FORECAST_TONE_IDLE: Record<ForecastTone, string> = {
  neutral: "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50",
  info: "border-sky-200 bg-white text-sky-700 hover:bg-sky-50",
  violet: "border-violet-200 bg-white text-violet-700 hover:bg-violet-50",
  amber: "border-amber-200 bg-white text-amber-700 hover:bg-amber-50",
  success: "border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50",
  danger: "border-rose-200 bg-white text-rose-700 hover:bg-rose-50",
};

/** Active (selected) chip chrome — filled. */
export const FORECAST_TONE_ACTIVE: Record<ForecastTone, string> = {
  neutral: "border-neutral-900 bg-neutral-900 text-white",
  info: "border-sky-600 bg-sky-600 text-white",
  violet: "border-violet-600 bg-violet-600 text-white",
  amber: "border-amber-600 bg-amber-600 text-white",
  success: "border-emerald-600 bg-emerald-600 text-white",
  danger: "border-rose-600 bg-rose-600 text-white",
};

/** Soft pill chrome for read-only surfaces (tables, KPI breakdowns). */
export const FORECAST_TONE_PILL: Record<ForecastTone, string> = {
  neutral: "border-neutral-200 bg-neutral-50 text-neutral-700",
  info: "border-sky-200 bg-sky-50 text-sky-800",
  violet: "border-violet-200 bg-violet-50 text-violet-800",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  danger: "border-rose-200 bg-rose-50 text-rose-800",
};

export function categoryTone(c: string | null | undefined): ForecastTone {
  return (
    FORECAST_CATEGORIES.find((x) => x.value === c)?.tone ?? "neutral"
  );
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
 *  Note: `probability` / `category` may be null — the workspace loads
 *  ALL active quotations (so sales can set a forecast inline), not just
 *  the ones already forecasted. The KPI aggregations simply contribute
 *  0 weighted for null-probability rows. */
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
  category: ForecastCategory | null;
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
  /** Sum of total for deals in the 'commit' category. */
  commit: number;
  /** Sum of total for 'best_case' deals. */
  bestCase: number;
  /** Sum of total for 'at_risk' deals. */
  atRisk: number;
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
  let commit = 0;
  let bestCase = 0;
  let atRisk = 0;
  let staleCount = 0;
  for (const d of deals) {
    weighted += weightedValue(d.total, d.probability);
    if (d.category === "commit") commit += d.total;
    if (d.category === "best_case") bestCase += d.total;
    if (d.category === "at_risk") atRisk += d.total;
    if (isForecastStale(d.updatedAt, d.probability != null)) staleCount++;
  }
  return {
    weighted,
    commit,
    bestCase,
    atRisk,
    count: deals.length,
    staleCount,
  };
}

export type ForecastBucket = {
  key: string;
  label: string;
  /** Weighted revenue in this bucket. */
  weighted: number;
  /** Raw (unweighted) revenue. */
  raw: number;
  /** Commit revenue in this bucket. */
  commit: number;
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
      { key: k.key, label: k.label, weighted: 0, raw: 0, commit: 0, count: 0 };
    existing.weighted += weightedValue(d.total, d.probability);
    existing.raw += d.total;
    if (d.category === "commit") existing.commit += d.total;
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
