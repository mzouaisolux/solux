import { createClient } from "@/lib/supabase/server";
import { ReminderPicker } from "./ReminderPicker";
import { ReminderRow } from "./ReminderRow";
import type { ReminderWithDoc } from "@/lib/reminders";

/**
 * Reminders block for the quotation detail page.
 *
 * Lists the CURRENT USER's own reminders on this document (RLS does
 * the heavy lifting — `qr_read_own_or_admin`). Admins also see all
 * other users' reminders on the same doc, surfaced as a separate
 * "Team reminders" section below the personal list (read-only for
 * the admin, since they don't "own" them).
 *
 * Server component — fetches on every render. Defensive against the
 * table not existing yet (m043 not applied): renders a one-liner
 * notice and the picker disabled.
 */
export async function QuotationRemindersSection({
  documentId,
  currentUserId,
}: {
  documentId: string;
  currentUserId: string | null;
}) {
  const supabase = createClient();

  // Fetch ALL accessible reminders on this doc (RLS filters by
  // ownership + admin override). We separate them into "mine" vs.
  // "others" client-side because the RLS layer doesn't know which
  // bucket the row belongs to without the auth context.
  const { data, error } = await supabase
    .from("quotation_reminders")
    .select("*")
    .eq("document_id", documentId)
    .order("remind_at", { ascending: true });

  // If the table doesn't exist (m043 not applied), surface a clear
  // notice rather than crashing the entire doc detail page.
  if (error && /quotation_reminders/.test(error.message ?? "")) {
    return (
      <section className="panel p-5 space-y-2">
        <div className="eyebrow">Reminders</div>
        <p className="text-xs text-amber-700 italic">
          The reminders table isn&apos;t available yet — run migration{" "}
          <code className="font-mono">043_quotation_reminders.sql</code>{" "}
          to enable this feature.
        </p>
      </section>
    );
  }

  const all = (data ?? []) as ReminderWithDoc[];
  const mine = currentUserId
    ? all.filter((r) => r.user_id === currentUserId)
    : [];
  const others = currentUserId
    ? all.filter((r) => r.user_id !== currentUserId)
    : all;

  const myOpen = mine.filter((r) => r.status === "open");
  const myClosed = mine.filter((r) => r.status !== "open");

  return (
    <section className="panel p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="eyebrow">Reminders</div>
          <p className="text-xs text-neutral-500 mt-0.5 max-w-xl">
            Personal tickler for this quotation. Only you (and admins)
            see your reminders. They appear in your dashboard and the
            Operations feed when they come due.
          </p>
        </div>
        <ReminderPicker documentId={documentId} />
      </div>

      {/* MY OPEN REMINDERS */}
      {myOpen.length > 0 ? (
        <ul className="space-y-2">
          {myOpen.map((r) => (
            <ReminderRow
              key={r.id}
              reminder={r}
              showDocContext={false}
            />
          ))}
        </ul>
      ) : (
        <div className="rounded-md border border-dashed border-neutral-200 bg-neutral-50/40 px-3 py-4 text-center text-xs text-neutral-500">
          No active reminders on this quotation. Use{" "}
          <b className="text-neutral-700">Add reminder</b> to set one.
        </div>
      )}

      {/* MY CLOSED — collapsible-looking section, just a divider+title */}
      {myClosed.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-[11px] font-semibold text-neutral-500 uppercase tracking-widerx hover:text-neutral-800 list-none flex items-center gap-1">
            <span className="transition-transform group-open:rotate-90 inline-block">
              ›
            </span>
            Closed reminders ({myClosed.length})
          </summary>
          <ul className="space-y-2 mt-2">
            {myClosed.map((r) => (
              <ReminderRow
                key={r.id}
                reminder={r}
                showDocContext={false}
              />
            ))}
          </ul>
        </details>
      )}

      {/* TEAM REMINDERS — admin sees other users' reminders here.
          Read-only summary; admins shouldn't normally close someone
          else's reminder unless cleaning up orphaned data. */}
      {others.length > 0 && (
        <details className="group border-t border-neutral-100 pt-3">
          <summary className="cursor-pointer text-[11px] font-semibold text-neutral-500 uppercase tracking-widerx hover:text-neutral-800 list-none flex items-center gap-1">
            <span className="transition-transform group-open:rotate-90 inline-block">
              ›
            </span>
            Team reminders ({others.length}) — admin view
          </summary>
          <ul className="space-y-2 mt-2">
            {others.map((r) => (
              <ReminderRow
                key={r.id}
                reminder={r}
                showDocContext={false}
              />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/**
 * Helper to fetch only the most-urgent OPEN reminder for the current
 * user on a doc. Used by the doc detail header to drive the
 * `ReminderDueBadge`. Returns null if none.
 */
export async function getMyMostUrgentReminder(
  documentId: string,
  currentUserId: string | null
) {
  if (!currentUserId) return null;
  const supabase = createClient();
  const { data, error } = await supabase
    .from("quotation_reminders")
    .select("remind_at, status")
    .eq("document_id", documentId)
    .eq("user_id", currentUserId)
    .eq("status", "open")
    .order("remind_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data as { remind_at: string; status: "open" };
}
