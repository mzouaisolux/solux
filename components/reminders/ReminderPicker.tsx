"use client";

import { useState, useTransition } from "react";
import { createReminder } from "@/app/(app)/documents/[id]/reminder-actions";
import { addDaysIso, todayIso } from "@/lib/reminders";

/**
 * Inline "Add reminder" picker. Renders as a single button by default;
 * clicking expands a small panel with:
 *
 *   - Quick presets (+3d / +1w / +2w / +1mo)
 *   - Custom date picker
 *   - Optional note
 *   - Submit + Cancel
 *
 * Same inline-expand pattern as StartWithoutDepositButton /
 * MarkProductionCompleteButton so the UX is consistent across the
 * app's "do something specific to this entity" actions.
 *
 * Mounting rule (set by the parent):
 *   - User is authenticated (any role can create their own reminders).
 *   - Document exists.
 * No other gating — backend RLS enforces user_id = auth.uid().
 */
export function ReminderPicker({
  documentId,
  compact = false,
}: {
  documentId: string;
  /** Compact mode collapses the trigger to a smaller button (e.g.
   *  for inline use under the "My reminders" panel). */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Sensible default: +7 days. Most sales follow-ups land there.
  const [date, setDate] = useState(() => addDaysIso(todayIso(), 7));
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setDate(addDaysIso(todayIso(), 7));
    setNote("");
    setError(null);
  }

  function submit() {
    setError(null);
    const fd = new FormData();
    fd.set("document_id", documentId);
    fd.set("remind_at", date);
    if (note.trim()) fd.set("note", note.trim());
    startTransition(async () => {
      try {
        await createReminder(fd);
        setOpen(false);
        reset();
      } catch (e: any) {
        setError(e?.message ?? "Failed to create reminder.");
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          compact
            ? "inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2 py-1 text-[11px] font-medium text-neutral-700 hover:bg-neutral-50 transition-colors"
            : "inline-flex items-center gap-1.5 rounded-md border border-sky-300 bg-sky-50 px-3 py-1.5 text-[12px] font-semibold text-sky-900 hover:bg-sky-100 transition-colors"
        }
        title="Set a follow-up reminder for this quotation. Personal — only you and admins see it."
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className={compact ? "h-3 w-3" : "h-3.5 w-3.5"}
          aria-hidden
        >
          <path d="M10 2a1 1 0 0 1 1 1v.07A7.002 7.002 0 0 1 17 10v3.586l1.707 1.707A1 1 0 0 1 18 17H2a1 1 0 0 1-.707-1.707L3 13.586V10a7.002 7.002 0 0 1 6-6.93V3a1 1 0 0 1 1-1Zm-2 16a2 2 0 1 0 4 0H8Z" />
        </svg>
        Add reminder
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-sky-300 bg-sky-50/40 p-3 space-y-2.5 max-w-md">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-widerx text-sky-900">
          New reminder
        </div>
        <p className="text-xs text-sky-900 mt-0.5 leading-relaxed">
          Schedule a personal follow-up on this quotation. Only you (and
          admins) will see it.
        </p>
      </div>
      {/* Quick presets */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {[
          { label: "+3 days", days: 3 },
          { label: "+1 week", days: 7 },
          { label: "+2 weeks", days: 14 },
          { label: "+1 month", days: 30 },
        ].map((p) => {
          const targetDate = addDaysIso(todayIso(), p.days);
          const active = date === targetDate;
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => setDate(targetDate)}
              disabled={pending}
              className={`rounded-md border px-2 py-0.5 text-[10px] font-medium transition-colors disabled:opacity-50 ${
                active
                  ? "border-sky-500 bg-sky-100 text-sky-900"
                  : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50"
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <label className="block">
        <span className="text-[11px] font-semibold text-neutral-700">
          Or pick a date
        </span>
        <input
          type="date"
          value={date}
          min={todayIso()}
          onChange={(e) => setDate(e.target.value)}
          disabled={pending}
          required
          className="mt-1 w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-xs disabled:bg-neutral-50"
        />
      </label>
      <label className="block">
        <span className="text-[11px] font-semibold text-neutral-700">
          Note{" "}
          <span className="font-normal text-neutral-500">(optional)</span>
        </span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Follow up on container revision, ask about PO"
          rows={2}
          disabled={pending}
          className="mt-1 w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-xs disabled:bg-neutral-50"
        />
      </label>
      {error && (
        <div className="rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-[11px] text-rose-700">
          {error}
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            reset();
          }}
          disabled={pending}
          className="rounded-md border border-neutral-200 bg-white px-2.5 py-1 text-[11px] font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending || !date}
          className="rounded-md bg-sky-700 px-3 py-1 text-[11px] font-semibold text-white hover:bg-sky-800 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save reminder"}
        </button>
      </div>
    </div>
  );
}
