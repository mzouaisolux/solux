import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ReminderRow } from "./ReminderRow";
import { addDaysIso, isDue, todayIso, type ReminderWithDoc } from "@/lib/reminders";

/**
 * Dashboard panel listing the current user's open reminders across
 * ALL quotations.
 *
 * Two display modes (drives the same data, different scope):
 *   - "full"    : Business slot. Shows due-today/overdue at the top,
 *                 then upcoming up to +30 days. Empty state.
 *   - "compact" : Operations slot. Only DUE reminders (overdue + today).
 *                 Hides itself if there are none — keeps the ops
 *                 cockpit clean when there's nothing to act on.
 *
 * Server component — reads via RLS so it automatically scopes to the
 * caller. Defensive against m043 not applied (table missing).
 */
export async function MyRemindersPanel({
  mode = "full",
  currentUserId,
}: {
  mode?: "full" | "compact";
  currentUserId: string | null;
}) {
  if (!currentUserId) return null;
  const supabase = createClient();

  // 30-day horizon for "full" mode, no horizon for "compact" (we'll
  // filter to due-only client-side).
  const horizon = addDaysIso(todayIso(), 30);
  const query = supabase
    .from("quotation_reminders")
    .select(
      "*, documents:document_id(id, number, status, total_price, currency, clients(company_name, client_code))"
    )
    .eq("user_id", currentUserId)
    .eq("status", "open")
    .order("remind_at", { ascending: true });

  // Apply horizon only in full mode — compact wants due-only and any
  // overdue reminder is by definition <= today.
  const { data, error } =
    mode === "full"
      ? await query.lte("remind_at", horizon)
      : await query.lte("remind_at", todayIso());

  // Soft-fail if m043 isn't applied — return null so the dashboard
  // keeps rendering. (Doc-detail page surfaces the explicit notice.)
  if (error && /quotation_reminders/.test(error.message ?? "")) {
    return null;
  }

  const reminders = (data ?? []) as ReminderWithDoc[];

  // Compact mode: hide entirely if nothing due.
  if (mode === "compact" && reminders.length === 0) return null;

  // Full mode: split into "due" (overdue + today) and "upcoming"
  // (future). Helps the user scan: act first, plan second.
  const due = reminders.filter((r) => isDue(r));
  const upcoming = reminders.filter((r) => !isDue(r));

  if (mode === "compact") {
    return (
      <section className="rounded-xl border border-amber-200 bg-amber-50/40 p-4 space-y-3">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-widerx text-amber-900">
              Your reminders due
            </div>
            <h3 className="text-sm font-semibold text-neutral-900 mt-0.5">
              {due.length} follow-up{due.length === 1 ? "" : "s"} need
              attention
            </h3>
          </div>
        </div>
        <ul className="space-y-2">
          {due.map((r) => (
            <ReminderRow key={r.id} reminder={r} showDocContext />
          ))}
        </ul>
      </section>
    );
  }

  // Full mode
  return (
    <section className="rounded-xl border border-neutral-200/80 bg-white shadow-soft p-5 space-y-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-widerx text-neutral-500">
            My reminders
          </div>
          <h2 className="text-base font-semibold text-neutral-900 mt-0.5">
            {due.length + upcoming.length === 0
              ? "No active reminders"
              : `${due.length} due · ${upcoming.length} upcoming`}
          </h2>
        </div>
        <span className="text-[11px] text-neutral-500">
          Personal — only you see this list
        </span>
      </div>

      {reminders.length === 0 ? (
        <div className="rounded-md border border-dashed border-neutral-200 bg-neutral-50/40 px-3 py-6 text-center text-xs text-neutral-500 space-y-1">
          <p>No active reminders.</p>
          <p className="text-neutral-400">
            Open a quotation and use{" "}
            <b className="text-neutral-700">Add reminder</b> to schedule a
            follow-up.
          </p>
        </div>
      ) : (
        <>
          {due.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-widerx font-semibold text-amber-700 mb-2">
                Due now
              </div>
              <ul className="space-y-2">
                {due.map((r) => (
                  <ReminderRow key={r.id} reminder={r} showDocContext />
                ))}
              </ul>
            </div>
          )}
          {upcoming.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-widerx font-semibold text-neutral-500 mb-2 mt-2">
                Upcoming · next 30 days
              </div>
              <ul className="space-y-2">
                {upcoming.map((r) => (
                  <ReminderRow key={r.id} reminder={r} showDocContext />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
