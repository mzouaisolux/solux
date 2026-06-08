import { formatDueLabel, type ReminderRow } from "@/lib/reminders";

/**
 * Small "Reminder due" / "Reminder overdue" badge used next to the
 * doc number on the detail page (and any other quotation surface
 * where a single badge needs to communicate the state at a glance).
 *
 * Renders nothing if there's no due reminder. Pass the most-overdue
 * open reminder (lowest remind_at on the user's set for this doc).
 */
export function ReminderDueBadge({
  reminder,
  size = "sm",
}: {
  reminder: Pick<ReminderRow, "remind_at" | "status"> | null;
  size?: "xs" | "sm";
}) {
  if (!reminder) return null;
  if (reminder.status !== "open") return null;

  const today = new Date().toISOString().slice(0, 10);
  const overdue = reminder.remind_at < today;
  const dueToday = reminder.remind_at === today;
  const upcoming = reminder.remind_at > today;

  // We only want to surface DUE / OVERDUE in the badge — upcoming is
  // noise on the detail header. The "My reminders" panel + doc list
  // handle upcoming reminders separately.
  if (upcoming) return null;

  const padding =
    size === "xs"
      ? "px-1.5 py-0.5 text-[10px]"
      : "px-2 py-0.5 text-[11px]";
  const tone = overdue
    ? "border-rose-300 bg-rose-50 text-rose-800"
    : "border-amber-300 bg-amber-50 text-amber-900";
  const label = overdue ? "Reminder overdue" : "Reminder due today";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-semibold ${tone} ${padding}`}
      title={`${label} — ${formatDueLabel(reminder.remind_at)}`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className="h-2.5 w-2.5"
        aria-hidden
      >
        <path d="M10 2a1 1 0 0 1 1 1v.07A7.002 7.002 0 0 1 17 10v3.586l1.707 1.707A1 1 0 0 1 18 17H2a1 1 0 0 1-.707-1.707L3 13.586V10a7.002 7.002 0 0 1 6-6.93V3a1 1 0 0 1 1-1Zm-2 16a2 2 0 1 0 4 0H8Z" />
      </svg>
      {label}
    </span>
  );
}
