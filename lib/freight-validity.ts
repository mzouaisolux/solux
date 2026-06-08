/**
 * Freight validity math (m098) — pure, deterministic, import-free so it loads
 * under the node test runner. Freight pricing is volatile and expires; this
 * derives the display status from a `valid_until` date.
 *
 * NOTE: keep this dependency-free (no `@/…`, no extensionless relative imports).
 * Uses `new Date(<string>)` (argful — allowed) for date math; never `Date.now()`
 * or argless `new Date()` (those are blocked in the test runner).
 */

export type FreightValidityStatus = "valid" | "expiring_soon" | "expired" | "none";

export type FreightValidity = {
  status: FreightValidityStatus;
  /** Whole days until expiry (>= 0). 0 = expires today. null when status=none. */
  daysRemaining: number | null;
  /** Whole days since expiry (> 0) when expired; null otherwise. */
  daysExpired: number | null;
  /** Short human label, e.g. "Freight expires in 4 days" / "Expired 53 days ago". */
  label: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** Freight is flagged "expiring soon" when fewer than this many days remain. */
export const FREIGHT_EXPIRING_SOON_DAYS = 7;

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
 * Compute freight validity status. `todayISO` is the reference date (pass the
 * server "now" as YYYY-MM-DD) so the function stays pure/testable.
 */
export function computeFreightStatus(
  validUntil: string | null | undefined,
  todayISO: string
): FreightValidity {
  const end = dayIndex(validUntil);
  const today = dayIndex(todayISO);
  if (end === null || today === null) {
    return { status: "none", daysRemaining: null, daysExpired: null, label: "No freight validity set" };
  }
  const diff = end - today; // >0 future, 0 today, <0 past
  if (diff < 0) {
    const daysExpired = -diff;
    return {
      status: "expired",
      daysRemaining: null,
      daysExpired,
      label: `Freight expired ${daysExpired} day${daysExpired === 1 ? "" : "s"} ago`,
    };
  }
  if (diff < FREIGHT_EXPIRING_SOON_DAYS) {
    return {
      status: "expiring_soon",
      daysRemaining: diff,
      daysExpired: null,
      label:
        diff === 0
          ? "Freight expires today"
          : `Freight expires in ${diff} day${diff === 1 ? "" : "s"}`,
    };
  }
  return {
    status: "valid",
    daysRemaining: diff,
    daysExpired: null,
    label: `Freight valid (${diff} days left)`,
  };
}

/**
 * Given a reference date (YYYY-MM-DD) and a validity period in days, return the
 * expiry date (YYYY-MM-DD). Used by the freight entry form's period picker.
 */
export function validityFromPeriod(todayISO: string, days: number): string {
  const base = dayIndex(todayISO);
  if (base === null || !Number.isFinite(days)) return "";
  const end = new Date((base + Math.max(0, Math.round(days))) * DAY_MS);
  return end.toISOString().slice(0, 10);
}
