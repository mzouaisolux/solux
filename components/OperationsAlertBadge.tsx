import {
  ALERT_LEVEL_CLASS,
  type OperationsAlert,
} from "@/lib/operations-alerts";

/**
 * Shared alert badge for production order rows.
 *
 * Used by /operations, /order-follow-up, /dashboard widgets, and the
 * client workspace so every surface communicates the same alert with the
 * same color + wording.
 *
 * The high-priority variants (overdue, balance_due, completion_approaching,
 * delayed >= 7 days) use a more saturated background and bold text so
 * they're scannable from a long table.
 */
export function OperationsAlertBadge({
  alert,
  size = "sm",
}: {
  alert: OperationsAlert;
  size?: "xs" | "sm";
}) {
  const base = ALERT_LEVEL_CLASS[alert.level];
  const padding = size === "xs" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]";
  return (
    <span
      title={alert.message}
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium ${base} ${padding} ${
        alert.highPriority ? "font-semibold" : ""
      }`}
    >
      {alert.highPriority && (
        <span
          aria-hidden
          className="h-1.5 w-1.5 rounded-full bg-current opacity-80"
        />
      )}
      {alert.label}
    </span>
  );
}

/**
 * Delay badge — separate concept from the alert badge. Shows the +N day
 * deviation between the initial and current deadlines. Use this in
 * tables where you want delay visibility independent of the broader
 * alert classification (e.g. order follow-up tables).
 *
 * Returns null when there's no delay to report (delay ≤ 0 or missing).
 */
export function DelayBadge({ delay }: { delay: number | null }) {
  if (delay == null || delay <= 0) return null;
  const severe = delay >= 7;
  return (
    <span
      title={`Deadline pushed back ${delay} day${delay === 1 ? "" : "s"} since initial commitment`}
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
        severe
          ? "bg-rose-50 text-rose-700 border-rose-200"
          : "bg-orange-50 text-orange-800 border-orange-200"
      }`}
    >
      <span aria-hidden>↑</span>
      {delay}d
    </span>
  );
}
