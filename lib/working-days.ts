/**
 * Working-day arithmetic.
 *
 * Mirrors the `add_working_days(start_date, n_days)` SQL function in
 * migration 021. Used by the app when we need to compute a projected
 * production completion date *before* persisting it (e.g. previewing
 * the deadline as the TLM types in production_working_days).
 *
 * Rules:
 *  - Weekends (Saturday, Sunday) are skipped.
 *  - No holiday calendar — intentionally. Public holidays vary by factory
 *    country and aren't worth modeling until the business asks for it.
 *  - n_days = 0 returns the start date.
 *  - n_days negative subtracts working days (rarely useful but symmetric).
 *
 * All inputs/outputs are stable UTC ISO-date strings ("YYYY-MM-DD") so we
 * never trip over local-timezone DST shifts.
 */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse a "YYYY-MM-DD" string into a UTC-anchored Date, or null. */
function parseISODate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const trimmed = String(s).slice(0, 10);
  if (!ISO_DATE_RE.test(trimmed)) return null;
  const [y, m, d] = trimmed.split("-").map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

/** Format a Date back to "YYYY-MM-DD" using UTC fields. */
function formatISODate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Add `nDays` working days to `start`. Skips Saturdays and Sundays.
 * Returns null if inputs are invalid.
 *
 * Examples:
 *   addWorkingDays("2024-05-01", 25) → "2024-06-05"  (Wed → Wed, skipping 8 weekend days)
 *   addWorkingDays("2024-05-03", 1)  → "2024-05-06"  (Fri → Mon)
 *   addWorkingDays("2024-05-01", 0)  → "2024-05-01"  (same day)
 */
export function addWorkingDays(
  start: string | null | undefined,
  nDays: number | null | undefined
): string | null {
  const date = parseISODate(start);
  if (!date) return null;
  if (nDays == null || !Number.isFinite(nDays)) return null;

  const step = nDays >= 0 ? 1 : -1;
  let remaining = Math.abs(Math.trunc(nDays));

  // Walk one calendar day at a time, only decrementing on weekdays.
  // For typical production windows (10–100 days) this is fine; if we
  // ever need to project years ahead we can switch to the closed-form
  // formula (full weeks * 7 + remainder math).
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + step);
    const dow = date.getUTCDay(); // 0 = Sun, 6 = Sat
    if (dow !== 0 && dow !== 6) {
      remaining -= 1;
    }
  }

  return formatISODate(date);
}

/**
 * Count working days between two ISO dates (inclusive of neither — pure
 * delta). Useful for "days remaining until completion" alert math.
 *
 * Returns null on invalid input. Positive when `to` is after `from`,
 * negative when before.
 */
export function workingDaysBetween(
  from: string | null | undefined,
  to: string | null | undefined
): number | null {
  const a = parseISODate(from);
  const b = parseISODate(to);
  if (!a || !b) return null;
  if (a.getTime() === b.getTime()) return 0;

  const sign = b.getTime() > a.getTime() ? 1 : -1;
  let count = 0;
  const cursor = new Date(a.getTime());
  while (cursor.getTime() !== b.getTime()) {
    cursor.setUTCDate(cursor.getUTCDate() + sign);
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) count += 1;
  }
  return sign * count;
}

/**
 * Calendar-day delta. Cheaper than `workingDaysBetween` when you don't
 * actually need to skip weekends (e.g. alert windows expressed in
 * "10 days before completion" — sales teams think in calendar days for
 * client-facing timing).
 */
export function calendarDaysBetween(
  from: string | null | undefined,
  to: string | null | undefined
): number | null {
  const a = parseISODate(from);
  const b = parseISODate(to);
  if (!a || !b) return null;
  const ms = b.getTime() - a.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

/** "YYYY-MM-DD" for today, in UTC. Stable across timezones. */
export function todayISO(): string {
  return formatISODate(new Date());
}
