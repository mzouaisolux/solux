"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import {
  DELAY_TYPES,
  DELAY_TYPE_LABEL,
  DELAY_TYPE_BADGE,
  type DelayType,
} from "@/lib/delays";
import {
  updateDelayEvent,
  deleteDelayEvent,
} from "@/app/(app)/production/orders/actions";

/**
 * One row in the delay-event history list (m074).
 *
 * Read mode: shows Δ + type chip + reason + actor + timestamp + Edit / Delete.
 * Edit mode: inline form with the same 3 fields as the create form.
 *
 * Each save / delete recomputes the materialized ETA on the server and writes
 * an audit event into the existing Timeline ("Delay event edited" /
 * "Delay event deleted"), so the history reads cleanly in place AND the audit
 * trail still tells the full story.
 */
export function DelayEventRow({
  event,
  actorLabel,
  editorLabel,
  editable,
}: {
  event: {
    id: string;
    days_added: number | null;
    delay_type: DelayType | null;
    reason: string | null;
    previous_date: string | null;
    new_date: string;
    created_at: string;
    updated_at: string | null;
  };
  actorLabel: string;
  editorLabel: string | null;
  editable: boolean;
}) {
  const [editing, setEditing] = useState(false);

  // Authoritative delta — fall back to date diff for un-backfilled rows.
  let delta = 0;
  if (event.days_added != null) {
    delta = Number(event.days_added);
  } else if (event.previous_date) {
    const a = Date.parse(event.previous_date + "T00:00:00Z");
    const b = Date.parse(event.new_date + "T00:00:00Z");
    if (Number.isFinite(a) && Number.isFinite(b))
      delta = Math.round((b - a) / 86_400_000);
  }

  if (editing) {
    return (
      <li className="pl-6 relative">
        <span className="absolute -left-[5px] top-3 h-2.5 w-2.5 rounded-full bg-violet-500 ring-4 ring-white" />
        <EditForm
          event={event}
          delta={delta}
          onDone={() => setEditing(false)}
        />
      </li>
    );
  }

  const dt = event.delay_type;
  const wasEdited =
    event.updated_at != null && event.updated_at !== event.created_at;
  const isRecovery = delta < 0;
  const deltaTone = isRecovery
    ? "bg-emerald-50 text-emerald-800 border-emerald-200"
    : delta > 0
    ? "bg-rose-50 text-rose-800 border-rose-200"
    : "bg-neutral-50 text-neutral-600 border-neutral-200";
  const dotTone = isRecovery
    ? "bg-emerald-500"
    : delta > 0
    ? "bg-rose-500"
    : "bg-neutral-300";
  const friendlyDate = new Date(event.created_at).toLocaleDateString(
    undefined,
    { month: "short", day: "2-digit" }
  );

  return (
    <li className="pl-6 relative group">
      <span
        className={`absolute -left-[5px] top-3 h-2.5 w-2.5 rounded-full ring-4 ring-white ${dotTone}`}
        aria-hidden
      />

      {/* Top line: prominent Δ + type chip · edit/delete on hover */}
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[12px] font-semibold tabular-nums ${deltaTone}`}
        >
          {delta === 0
            ? "0d"
            : delta > 0
            ? `+${delta}d`
            : `${delta}d`}
        </span>
        {dt ? (
          <span
            className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widerx ${DELAY_TYPE_BADGE[dt]}`}
            title={DELAY_TYPE_LABEL[dt]}
          >
            {dt === "production"
              ? "Factory"
              : DELAY_TYPE_LABEL[dt].replace(" delay", "")}
          </span>
        ) : (
          <span
            className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widerx bg-neutral-100 text-neutral-500 border border-neutral-200"
            title="Pre-m072 row · counted as factory by default."
          >
            Untagged
          </span>
        )}
        {wasEdited && (
          <span
            className="text-[10px] text-neutral-400 italic"
            title={`Last edited ${new Date(event.updated_at as string).toLocaleString()}${editorLabel ? ` by ${editorLabel}` : ""}`}
          >
            edited
          </span>
        )}
        {editable && (
          <span className="ml-auto flex items-center gap-3 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-[11px] text-neutral-500 hover:text-neutral-900 hover:underline"
              title="Edit this delay event"
            >
              Edit
            </button>
            <DeleteButton eventId={event.id} delta={delta} />
          </span>
        )}
      </div>

      {/* Reason — primary content, not a footnote */}
      {event.reason && (
        <div className="text-sm text-neutral-800 mt-1.5 leading-snug">
          {event.reason}
        </div>
      )}

      {/* Footer: who added it · when */}
      <div className="text-[11px] text-neutral-400 mt-1">
        Added by{" "}
        <span className="text-neutral-600 font-medium">{actorLabel}</span>{" "}
        · {friendlyDate}
      </div>
    </li>
  );
}

/** Inline edit form — 3 fields, no live preview (the strip refreshes after save). */
function EditForm({
  event,
  delta,
  onDone,
}: {
  event: {
    id: string;
    days_added: number | null;
    delay_type: DelayType | null;
    reason: string | null;
  };
  delta: number;
  onDone: () => void;
}) {
  const [days, setDays] = useState(String(delta || event.days_added || ""));
  const [type, setType] = useState<DelayType | "">(event.delay_type ?? "");
  const [reason, setReason] = useState(event.reason ?? "");

  return (
    <form
      action={async (fd) => {
        await updateDelayEvent(fd);
        onDone();
      }}
      className="space-y-2 rounded-md border border-violet-200 bg-violet-50/40 p-2.5"
    >
      <input type="hidden" name="event_id" value={event.id} />
      <div className="grid grid-cols-1 md:grid-cols-[100px_1fr_1fr] gap-2">
        <label className="block">
          <span className="text-[10px] uppercase tracking-widerx text-neutral-500 font-semibold">
            Days
          </span>
          <input
            type="number"
            name="days_added"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            className="input tabular-nums text-right"
            required
          />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-widerx text-neutral-500 font-semibold">
            Delay type
          </span>
          <select
            name="delay_type"
            value={type}
            onChange={(e) => setType(e.target.value as DelayType)}
            className="input"
            required
          >
            <option value="" disabled>
              — pick —
            </option>
            {DELAY_TYPES.map((t) => (
              <option key={t} value={t}>
                {DELAY_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-widerx text-neutral-500 font-semibold">
            Reason
          </span>
          <input
            name="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. supplier recovered"
            className="input"
          />
        </label>
      </div>
      <div className="flex items-center justify-end gap-2 text-[11px]">
        <button
          type="button"
          onClick={onDone}
          className="text-neutral-500 hover:text-neutral-900 hover:underline"
        >
          Cancel
        </button>
        <SaveButton />
      </div>
    </form>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-violet-700 text-white px-3 py-1 text-xs font-medium hover:bg-violet-800 disabled:opacity-50"
    >
      {pending ? "Saving…" : "Save edit"}
    </button>
  );
}

/** Tiny delete-confirm button. Uses browser confirm() for lightness — no
 *  modal infrastructure needed and the action is small enough that a
 *  one-click confirmation is enough friction. */
function DeleteButton({
  eventId,
  delta,
}: {
  eventId: string;
  delta: number;
}) {
  return (
    <form
      action={deleteDelayEvent}
      onSubmit={(e) => {
        const ok = window.confirm(
          `Delete this delay event (${delta > 0 ? "+" : ""}${delta}d)? The ETA will be recomputed.`
        );
        if (!ok) e.preventDefault();
      }}
      className="inline"
    >
      <input type="hidden" name="event_id" value={eventId} />
      <DeleteSubmit />
    </form>
  );
}

function DeleteSubmit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="text-[11px] text-rose-600 hover:text-rose-800 hover:underline disabled:opacity-50"
      title="Delete this delay event"
    >
      {pending ? "Deleting…" : "Delete"}
    </button>
  );
}
