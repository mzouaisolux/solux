/**
 * Costing validity math (m140) — pure, deterministic, import-free so it loads
 * under the node test runner. An approved Service-Request costing goes stale
 * as transport, exchange rates and manufacturing costs drift; this derives the
 * display status from the age of the latest APPROVED costing against
 * company-configurable thresholds (pricing_settings — never hardcoded).
 *
 *   valid    age < agingAfterDays
 *   aging    agingAfterDays <= age < expiredAfterDays   (warn)
 *   expired  age >= expiredAfterDays                    (strong warn; sending
 *            may be blocked when the company policy requires a revision)
 *   none     no approved costing found — feature stays silent, never blocks
 *
 * Mirrors lib/freight-validity.ts (m098). NOTE: keep this dependency-free
 * (no `@/…`, no extensionless relative imports). Uses `new Date(<string>)`
 * (argful — allowed); never `Date.now()` or argless `new Date()` (blocked in
 * the test runner).
 */

export type CostingValidityStatus = "valid" | "aging" | "expired" | "none";

export type CostingValidity = {
  status: CostingValidityStatus;
  /** Whole days since the costing was approved. null when status=none. */
  ageDays: number | null;
  /** Short human label, e.g. "Costing approved 47 days ago". */
  label: string;
};

export type CostingValiditySettings = {
  /** Age (days) after which an approved costing stops being "Valid". */
  agingAfterDays: number;
  /** Age (days) after which it is "Expired". */
  expiredAfterDays: number;
  /** Company policy: block sending a quotation whose costing is Expired. */
  requireRevisionWhenExpired: boolean;
};

/** Defaults per the owner's spec (30 / 90 / warning-only). */
export const COSTING_DEFAULTS: CostingValiditySettings = {
  agingAfterDays: 30,
  expiredAfterDays: 90,
  requireRevisionWhenExpired: false,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Parse a YYYY-MM-DD (or ISO) string to a UTC-midnight day index, or null. */
function dayIndex(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const s = String(dateStr).slice(0, 10); // YYYY-MM-DD
  const d = new Date(`${s}T00:00:00Z`);
  const t = d.getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor(t / DAY_MS);
}

/**
 * Compute costing validity. `approvedAt` is the latest APPROVED costing's
 * timestamp (version.approved_at / project_products.priced_at — caller picks
 * the freshest); `todayISO` is the reference date (pass the server "now" as
 * YYYY-MM-DD) so the function stays pure/testable.
 *
 * Degenerate thresholds are normalized defensively: aging < 0 clamps to 0 and
 * expired < aging clamps to aging (a misconfigured admin form must never make
 * a fresh costing "expired" while an older one shows "aging").
 */
export function computeCostingStatus(
  approvedAt: string | null | undefined,
  todayISO: string,
  settings: Pick<CostingValiditySettings, "agingAfterDays" | "expiredAfterDays">
): CostingValidity {
  const approved = dayIndex(approvedAt);
  const today = dayIndex(todayISO);
  if (approved === null || today === null) {
    return { status: "none", ageDays: null, label: "No approved costing" };
  }
  // A future-dated approval (clock skew) counts as age 0, never negative.
  const age = Math.max(0, today - approved);
  const aging = Math.max(0, Math.round(settings.agingAfterDays));
  const expired = Math.max(aging, Math.round(settings.expiredAfterDays));
  const label = `Costing approved ${age} day${age === 1 ? "" : "s"} ago`;
  if (age >= expired) return { status: "expired", ageDays: age, label };
  if (age >= aging) return { status: "aging", ageDays: age, label };
  return { status: "valid", ageDays: age, label };
}
