"use client";

import { useState, useTransition } from "react";
import { markProductionComplete } from "@/app/(app)/production/orders/actions";

/**
 * Primary "Mark production complete" CTA, used in the Actual Production
 * Deadline panel once production is active.
 *
 * Inline confirm pattern (mirroring StartWithoutDepositButton):
 *   - First click expands to show:
 *       · completion date picker (default today)
 *       · optional notes field (container number, forwarder, etc.)
 *       · explicit Confirm button
 *   - Cancel collapses the expanded state.
 *
 * Mounting rule (set by the parent page):
 *   - lifecyclePhase === "in_production"
 *   - actual_completion_date IS NULL
 *   - caller has the production_order.edit_status capability
 * The button shouldn't be rendered outside these conditions.
 *
 * Backend gating is the source of truth — `markProductionComplete`
 * runs `requireCapability("production_order.edit_status")` and
 * re-validates state (started, not cancelled, not already complete).
 */
export function MarkProductionCompleteButton({
  orderId,
}: {
  orderId: string;
}) {
  const [open, setOpen] = useState(false);
  // Default the date picker to today (YYYY-MM-DD slice).
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [pending, startActionTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    const fd = new FormData();
    fd.set("id", orderId);
    if (date) fd.set("actual_completion_date", date);
    if (notes.trim()) fd.set("notes", notes.trim());
    startActionTransition(async () => {
      try {
        await markProductionComplete(fd);
        setOpen(false);
        setNotes("");
      } catch (e: any) {
        setError(e?.message ?? "Failed to mark complete.");
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-emerald-800 transition-colors shadow-sm"
        title="Stamp the actual completion date and flip status to Production completed."
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-3.5 w-3.5"
          aria-hidden
        >
          <path
            fillRule="evenodd"
            d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
            clipRule="evenodd"
          />
        </svg>
        Mark production complete
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-emerald-300 bg-emerald-50/40 p-3 space-y-2.5 max-w-md">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-widerx text-emerald-900">
          Confirm completion
        </div>
        <p className="text-xs text-emerald-900 mt-0.5 leading-relaxed">
          This stamps the actual completion date, flips the status to{" "}
          <b>Production completed</b>, and surfaces the milestone on
          the dashboard. Final delay vs. the frozen baseline is logged
          in the timeline.
        </p>
      </div>
      <label className="block">
        <span className="text-[11px] font-semibold text-neutral-700">
          Completion date
        </span>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          disabled={pending}
          required
          className="mt-1 w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-xs disabled:bg-neutral-50"
        />
        <span className="block text-[10px] text-neutral-500 mt-0.5">
          Defaults to today — override only when recording a past
          completion.
        </span>
      </label>
      <label className="block">
        <span className="text-[11px] font-semibold text-neutral-700">
          Notes{" "}
          <span className="font-normal text-neutral-500">(optional)</span>
        </span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Shipped via Cosco, container SLXU1234567"
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
            setNotes("");
            setDate(today);
            setError(null);
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
          className="rounded-md bg-emerald-700 px-3 py-1 text-[11px] font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Confirm: mark complete"}
        </button>
      </div>
    </div>
  );
}
