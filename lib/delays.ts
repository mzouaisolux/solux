/**
 * Delay categorization (m072) — separates *who is responsible* for a
 * deadline slip so factory KPIs don't get poisoned by external blockers.
 *
 * Every row in `production_deadline_changes` carries a `delay_type`. The
 * app splits the total slip into two axes:
 *
 *     factory_delay_days   = Σ Δ days where delay_type = 'production'
 *     external_delay_days  = Σ Δ days where delay_type ≠ 'production'
 *
 * Only the factory axis triggers the red "Delayed" pill / production_late
 * action-center sensor. The external axis surfaces in amber, so the cause
 * is unambiguous to anyone reading the page.
 *
 * Legacy rows (created before m072) have NULL delay_type — we treat them
 * as 'production' so existing KPIs stay stable. Operators can re-tag.
 *
 * Pure module (client + server safe). No DB, no React.
 */

export type DelayType =
  | "production"
  | "payment"
  | "shipping"
  | "client_change"
  | "client_waiting"
  | "supplier"
  | "customs"
  | "other";

export const DELAY_TYPES: DelayType[] = [
  "production",
  "payment",
  "shipping",
  "client_change",
  "client_waiting",
  "supplier",
  "customs",
  "other",
];

/** Short label for selects and chips. */
export const DELAY_TYPE_LABEL: Record<DelayType, string> = {
  production: "Production delay",
  payment: "Payment delay",
  shipping: "Shipping / logistics",
  client_change: "Client change request",
  client_waiting: "Client waiting / approval",
  supplier: "Supplier issue",
  customs: "Customs / external",
  other: "Other",
};

/** One-line context shown next to a delay chip in the order summary. */
export const DELAY_TYPE_CONTEXT: Record<DelayType, string> = {
  production: "Factory responsibility — counts toward factory KPI.",
  payment: "Project held by an unreceived payment.",
  shipping: "Held by carrier, vessel, or forwarder.",
  client_change: "Customer added / changed scope mid-project.",
  client_waiting: "Awaiting client confirmation or approval.",
  supplier: "Upstream component / supplier delay.",
  customs: "Customs, certification, or external authority.",
  other: "External / operational delay (non-factory).",
};

/** Tailwind classes for the delay-type chip. */
export const DELAY_TYPE_BADGE: Record<DelayType, string> = {
  production: "bg-rose-100 text-rose-900 border border-rose-200",
  payment: "bg-amber-100 text-amber-900 border border-amber-200",
  shipping: "bg-sky-100 text-sky-900 border border-sky-200",
  client_change: "bg-violet-100 text-violet-900 border border-violet-200",
  client_waiting: "bg-violet-50 text-violet-800 border border-violet-200",
  supplier: "bg-orange-100 text-orange-900 border border-orange-200",
  customs: "bg-yellow-100 text-yellow-900 border border-yellow-200",
  other: "bg-neutral-100 text-neutral-700 border border-neutral-200",
};

/** Factory KPI rule: only `production` counts as factory's fault. */
export function isFactoryDelay(t: DelayType | null | undefined): boolean {
  // Legacy NULL = 'production' (m072 backfill semantics).
  return t == null || t === "production";
}

export function isExternalDelay(t: DelayType | null | undefined): boolean {
  return !isFactoryDelay(t);
}

/** A single row from `production_deadline_changes`, in the shape this module
 *  needs. The page's loader picks just these columns.
 *
 *  `days_added` (m073) is the authoritative signed delta carried by the
 *  event. Backfilled rows have it from `(new_date - previous_date)`; new
 *  events carry it directly. When NULL (pre-m073 deployments not yet
 *  migrated), we fall back to the prev → new date diff. */
export type DeadlineChangeRow = {
  previous_date: string | null;
  new_date: string;
  delay_type: DelayType | null;
  days_added: number | null;
  reason: string | null;
  created_at: string;
};

export type DelayBreakdown = {
  /** Sum of day-deltas attributed to the factory. */
  factoryDays: number;
  /** Sum of day-deltas attributed to external causes. */
  externalDays: number;
  /** Most recent delay-type (any axis) — drives the operational label. */
  latestType: DelayType | null;
  /** Number of rows that contributed to the totals. */
  changeCount: number;
};

const dayMs = 86_400_000;
function diffDays(a: string | null, b: string): number {
  if (!a) return 0;
  const at = Date.parse(a + "T00:00:00Z");
  const bt = Date.parse(b + "T00:00:00Z");
  if (!Number.isFinite(at) || !Number.isFinite(bt)) return 0;
  return Math.round((bt - at) / dayMs);
}

/**
 * Compute the factory / external split from a delay-event stream.
 * Each event contributes its `days_added` (signed) to either the factory
 * or external bucket. Recovery events (negative days_added) reduce the
 * bucket they were attributed to. Initial baseline rows contribute 0.
 *
 * Falls back to (new_date − previous_date) when `days_added` is NULL
 * (pre-m073 deployments).
 */
export function computeDelayBreakdown(
  changes: DeadlineChangeRow[]
): DelayBreakdown {
  let factory = 0;
  let external = 0;
  let latest: DelayType | null = null;
  let latestAt = 0;
  for (const c of changes) {
    const delta =
      c.days_added != null ? c.days_added : diffDays(c.previous_date, c.new_date);
    if (delta === 0) continue;
    if (isFactoryDelay(c.delay_type)) factory += delta;
    else external += delta;
    const at = Date.parse(c.created_at);
    if (Number.isFinite(at) && at >= latestAt) {
      latestAt = at;
      latest = (c.delay_type ?? "production") as DelayType;
    }
  }
  return {
    factoryDays: factory,
    externalDays: external,
    latestType: latest,
    changeCount: changes.length,
  };
}

/** Add a signed `days` offset to an ISO date (YYYY-MM-DD) and return the
 *  resulting ISO date. Used by the server action to compute the new ETA
 *  from `current + days_added`. */
export function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
