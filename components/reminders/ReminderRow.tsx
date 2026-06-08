"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  cancelReminder,
  markReminderDone,
  rescheduleReminder,
  snoozeReminder,
} from "@/app/(app)/documents/[id]/reminder-actions";
import {
  SNOOZE_PRESETS,
  daysUntil,
  dueToneClass,
  formatDueLabel,
  todayIso,
  type ReminderWithDoc,
} from "@/lib/reminders";

/**
 * Single reminder row used by every list surface (doc detail panel,
 * dashboard "My reminders", operations feed top strip).
 *
 * Props
 * -----
 *   reminder           the row (with optional joined document/client)
 *   showDocContext     true on dashboard / ops feed (where the user is
 *                      looking across docs), false on doc detail
 *                      (redundant context)
 *
 * Inline action buttons: Snooze (with preset menu) / Reschedule
 * (date picker) / Done / Cancel. All wired to server actions; errors
 * are surfaced inline.
 */
export function ReminderRow({
  reminder,
  showDocContext = true,
}: {
  reminder: ReminderWithDoc;
  showDocContext?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Sub-popup states — only one open at a time. Keeps the row compact.
  const [openSnooze, setOpenSnooze] = useState(false);
  const [openReschedule, setOpenReschedule] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState(reminder.remind_at);

  function call(fn: (fd: FormData) => Promise<void>, fd: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        await fn(fd);
        setOpenSnooze(false);
        setOpenReschedule(false);
      } catch (e: any) {
        setError(e?.message ?? "Action failed.");
      }
    });
  }

  function doSnooze(days: number) {
    const fd = new FormData();
    fd.set("id", reminder.id);
    fd.set("days", String(days));
    call(snoozeReminder, fd);
  }

  function doReschedule() {
    const fd = new FormData();
    fd.set("id", reminder.id);
    fd.set("remind_at", rescheduleDate);
    call(rescheduleReminder, fd);
  }

  function doDone() {
    const fd = new FormData();
    fd.set("id", reminder.id);
    call(markReminderDone, fd);
  }

  function doCancel() {
    if (!confirm("Cancel this reminder? It won't be deleted, just closed.")) {
      return;
    }
    const fd = new FormData();
    fd.set("id", reminder.id);
    call(cancelReminder, fd);
  }

  const days = daysUntil(reminder.remind_at);
  const isOverdue = days < 0 && reminder.status === "open";
  const doc = reminder.documents;

  return (
    <li
      className={`rounded-lg border px-3 py-2.5 space-y-1.5 transition-colors ${
        reminder.status !== "open"
          ? "border-neutral-200 bg-neutral-50/50 opacity-70"
          : isOverdue
          ? "border-rose-200 bg-rose-50/40"
          : days === 0
          ? "border-amber-200 bg-amber-50/40"
          : "border-neutral-200 bg-white"
      }`}
    >
      {/* Header — date label + optional doc context */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex items-center gap-2 flex-wrap">
          <span
            className={`text-[11px] font-semibold uppercase tracking-widerx ${dueToneClass(
              reminder
            )}`}
          >
            {reminder.status === "done"
              ? "Done"
              : reminder.status === "cancelled"
              ? "Cancelled"
              : formatDueLabel(reminder.remind_at)}
          </span>
          <span className="text-[10px] tabular-nums text-neutral-500 font-mono">
            {reminder.remind_at}
          </span>
          {reminder.snooze_count > 0 && reminder.status === "open" && (
            <span
              className="text-[10px] font-medium text-amber-700"
              title={`Snoozed ${reminder.snooze_count} time(s)`}
            >
              ↻ {reminder.snooze_count}×
            </span>
          )}
        </div>
        {showDocContext && doc && (
          <Link
            href={`/documents/${doc.id}`}
            className="text-[11px] font-mono text-neutral-700 hover:text-neutral-900 hover:underline truncate max-w-[40%]"
            title={
              doc.clients?.company_name
                ? `${doc.number ?? "—"} · ${doc.clients.company_name}`
                : (doc.number ?? "—")
            }
          >
            {doc.number ?? "—"}
            {doc.clients?.company_name && (
              <span className="text-neutral-500 ml-1">
                · {doc.clients.company_name}
              </span>
            )}
          </Link>
        )}
      </div>

      {/* Note */}
      {reminder.note && (
        <div className="text-xs text-neutral-700 leading-snug">
          {reminder.note}
        </div>
      )}

      {/* Action row — open only */}
      {reminder.status === "open" && (
        <div className="flex items-center gap-1.5 flex-wrap pt-1">
          <button
            type="button"
            onClick={doDone}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md bg-emerald-700 text-white px-2 py-1 text-[10px] font-semibold hover:bg-emerald-800 disabled:opacity-50"
          >
            ✓ Done
          </button>
          <button
            type="button"
            onClick={() => {
              setOpenSnooze((v) => !v);
              setOpenReschedule(false);
            }}
            disabled={pending}
            className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-[10px] font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            Snooze
          </button>
          <button
            type="button"
            onClick={() => {
              setOpenReschedule((v) => !v);
              setOpenSnooze(false);
              setRescheduleDate(reminder.remind_at);
            }}
            disabled={pending}
            className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-[10px] font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            Reschedule
          </button>
          <button
            type="button"
            onClick={doCancel}
            disabled={pending}
            className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-[10px] font-medium text-neutral-500 hover:bg-neutral-50 hover:text-rose-700 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Done / cancelled audit footer — keeps the row readable when
          historical reminders are shown (e.g. on doc detail "show all"). */}
      {reminder.status !== "open" && (
        <div className="text-[10px] text-neutral-500 pt-0.5">
          {reminder.status === "done"
            ? `Done${reminder.done_at ? ` · ${reminder.done_at.slice(0, 10)}` : ""}`
            : `Cancelled${
                reminder.cancelled_at
                  ? ` · ${reminder.cancelled_at.slice(0, 10)}`
                  : ""
              }`}
        </div>
      )}

      {/* Snooze sub-popup */}
      {openSnooze && reminder.status === "open" && (
        <div className="border-t border-neutral-100 pt-2 flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-neutral-500 font-semibold uppercase tracking-widerx">
            Snooze for
          </span>
          {SNOOZE_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => doSnooze(p.days)}
              disabled={pending}
              className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {/* Reschedule sub-popup */}
      {openReschedule && reminder.status === "open" && (
        <div className="border-t border-neutral-100 pt-2 flex items-center gap-1.5 flex-wrap">
          <input
            type="date"
            value={rescheduleDate}
            min={todayIso()}
            onChange={(e) => setRescheduleDate(e.target.value)}
            disabled={pending}
            className="rounded-md border border-neutral-200 px-2 py-0.5 text-[11px] disabled:bg-neutral-50"
          />
          <button
            type="button"
            onClick={doReschedule}
            disabled={pending || !rescheduleDate}
            className="rounded-md bg-neutral-900 text-white px-2 py-0.5 text-[10px] font-semibold hover:bg-neutral-800 disabled:opacity-50"
          >
            {pending ? "Saving…" : "Reschedule"}
          </button>
        </div>
      )}

      {error && (
        <div className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] text-rose-700">
          {error}
        </div>
      )}
    </li>
  );
}
