/**
 * Quotation reminders — types, pure helpers, and shared constants.
 *
 * Pure module — no Supabase, no `next/headers`. Safe to import from
 * client AND server components.
 *
 * Backed by table `quotation_reminders` (migration 043).
 */

export type ReminderStatus = "open" | "done" | "cancelled";

export type ReminderRow = {
  id: string;
  document_id: string;
  user_id: string;
  /** YYYY-MM-DD — date column, no time of day. */
  remind_at: string;
  note: string | null;
  status: ReminderStatus;
  done_at: string | null;
  done_by: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  snooze_count: number;
  last_snoozed_at: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Joined shape — the dashboard "My reminders" panel needs the doc
 * number / status / client so the user can pick the right one to
 * action. Built from a join on `documents` + `clients` (PostgREST
 * nested select syntax).
 */
export type ReminderWithDoc = ReminderRow & {
  documents: {
    id: string;
    number: string | null;
    status: string | null;
    total_price: number | null;
    currency: string | null;
    clients?: {
      company_name: string | null;
      client_code: string | null;
    } | null;
  } | null;
};

/* ===========================================================================
   Date helpers — kept here so both server actions and UI agree on the
   same "today" semantics. We use UTC midnight as the canonical day
   anchor; DATE columns from Postgres come back as YYYY-MM-DD strings
   that we treat as opaque day identifiers.
   =========================================================================== */

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Add (or subtract) calendar days to a YYYY-MM-DD string. UTC-safe. */
export function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Days from today to remind_at. Negative = overdue, 0 = today. */
export function daysUntil(remindAt: string): number {
  const today = new Date(todayIso() + "T00:00:00Z").getTime();
  const target = new Date(remindAt + "T00:00:00Z").getTime();
  if (!Number.isFinite(today) || !Number.isFinite(target)) return 0;
  return Math.round((target - today) / (1000 * 60 * 60 * 24));
}

/* ===========================================================================
   Lifecycle predicates
   =========================================================================== */

/**
 * Should this reminder surface as actionable right now?
 * True iff open AND remind_at <= today.
 */
export function isDue(r: Pick<ReminderRow, "status" | "remind_at">): boolean {
  if (r.status !== "open") return false;
  return r.remind_at <= todayIso();
}

/** Strictly past today (not just due today). */
export function isOverdue(
  r: Pick<ReminderRow, "status" | "remind_at">
): boolean {
  if (r.status !== "open") return false;
  return r.remind_at < todayIso();
}

/** Open and in the future (not yet actionable). */
export function isUpcoming(
  r: Pick<ReminderRow, "status" | "remind_at">
): boolean {
  if (r.status !== "open") return false;
  return r.remind_at > todayIso();
}

/* ===========================================================================
   Formatting
   =========================================================================== */

/** Short label: "Today", "Tomorrow", "in 3 days", "3 days overdue". */
export function formatDueLabel(remindAt: string): string {
  const d = daysUntil(remindAt);
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  if (d === -1) return "Yesterday · overdue";
  if (d > 1) return `in ${d} days`;
  return `${Math.abs(d)} days overdue`;
}

/**
 * Tailwind tone class for a reminder's date label. Drives the urgency
 * coloring across all surfaces (badge, panel rows, doc detail list).
 */
export function dueToneClass(
  r: Pick<ReminderRow, "status" | "remind_at">
): string {
  if (r.status !== "open") return "text-neutral-400";
  const d = daysUntil(r.remind_at);
  if (d < 0) return "text-rose-700"; // overdue
  if (d === 0) return "text-amber-700"; // today
  if (d <= 3) return "text-amber-600"; // very soon
  return "text-neutral-600"; // upcoming
}

/* ===========================================================================
   Snooze presets — the inline quick-action buttons.
   =========================================================================== */

export const SNOOZE_PRESETS = [
  { label: "+3 days", days: 3 },
  { label: "+1 week", days: 7 },
  { label: "+2 weeks", days: 14 },
  { label: "+1 month", days: 30 },
] as const;

export type SnoozePreset = (typeof SNOOZE_PRESETS)[number];
