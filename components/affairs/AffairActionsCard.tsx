"use client";

// =====================================================================
// Planned actions (CRM step 4, m103) — the affair's to-do engine.
// PLAN_CRM_SOLUX §8: the NEXT ACTION + DATE is the biggest thing on the
// deal. Golden rule: a live affair ALWAYS has a next action with a date
// — no open action (or an overdue one) = red. Completing an action logs
// into the events timeline (server action side).
// Calm grayscale like the rest of the workspace; red is the only alarm.
// =====================================================================

import { useState } from "react";
import {
  createPlannedAction,
  completePlannedAction,
  deletePlannedAction,
} from "@/app/(app)/affairs/actions";
import { toast } from "@/components/feedback/toast-store";
import { fmtDate } from "@/components/affairs/badges";

export type PlannedActionRow = {
  id: string;
  affair_id: string;
  action_type: string;
  title: string | null;
  due_date: string; // yyyy-mm-dd
  done_at: string | null;
  notes: string | null;
  created_at: string;
};

export const ACTION_TYPE_OPTIONS = [
  { value: "call", label: "Call" },
  { value: "meeting", label: "Meeting" },
  { value: "visit", label: "Site visit" },
  { value: "follow_up", label: "Follow-up" },
  { value: "send_quote", label: "Send quote" },
  { value: "other", label: "Other" },
] as const;

const typeLabel = (v: string) =>
  ACTION_TYPE_OPTIONS.find((o) => o.value === v)?.label ?? "Action";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function AddActionForm({
  affairId,
  onClose,
}: {
  affairId: string;
  onClose: () => void;
}) {
  const inputCls =
    "rounded border border-neutral-200 px-2 py-1 text-[12px] focus:outline-none focus:ring-2 focus:ring-neutral-200";
  return (
    <form
      action={async (fd) => {
        try {
          await createPlannedAction(fd);
          toast.success("Action planned");
          onClose();
        } catch (e: any) {
          toast.error(e?.message ?? "Could not plan the action.");
        }
      }}
      className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-neutral-200 bg-neutral-50/60 p-2.5"
    >
      <input type="hidden" name="affair_id" value={affairId} />
      <label className="block">
        <span className="block text-[10px] text-neutral-500">Type</span>
        <select name="action_type" required className={inputCls} defaultValue="call">
          {ACTION_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block min-w-0 flex-1">
        <span className="block text-[10px] text-neutral-500">What (optional)</span>
        <input name="title" placeholder="e.g. call back about pricing" className={`${inputCls} w-full`} />
      </label>
      <label className="block">
        <span className="block text-[10px] text-neutral-500">Due date</span>
        <input name="due_date" type="date" required defaultValue={todayISO()} className={inputCls} />
      </label>
      <div className="flex gap-1.5">
        <button type="submit" className="rounded-md bg-solux px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-solux-dark">
          Plan
        </button>
        <button type="button" onClick={onClose} className="rounded border border-neutral-200 px-2 py-1 text-[11px] text-neutral-600 hover:bg-neutral-50">
          Cancel
        </button>
      </div>
    </form>
  );
}

function DoneButton({ action }: { action: PlannedActionRow }) {
  return (
    <form
      action={async (fd) => {
        try {
          await completePlannedAction(fd);
          toast.success("Action done");
        } catch (e: any) {
          toast.error(e?.message ?? "Could not complete the action.");
        }
      }}
    >
      <input type="hidden" name="id" value={action.id} />
      <input type="hidden" name="affair_id" value={action.affair_id} />
      <button className="rounded border border-neutral-300 px-2 py-0.5 text-[11px] font-semibold text-neutral-800 hover:bg-neutral-50">
        ✓ Done
      </button>
    </form>
  );
}

function DeleteButton({ action }: { action: PlannedActionRow }) {
  return (
    <form
      action={async (fd) => {
        try {
          await deletePlannedAction(fd);
        } catch (e: any) {
          toast.error(e?.message ?? "Could not remove the action.");
        }
      }}
    >
      <input type="hidden" name="id" value={action.id} />
      <input type="hidden" name="affair_id" value={action.affair_id} />
      <button
        className="rounded px-1.5 py-0.5 text-[11px] text-neutral-400 hover:bg-rose-50 hover:text-rose-600"
        title="Remove this planned action"
      >
        ×
      </button>
    </form>
  );
}

export function AffairActionsCard({
  affairId,
  actions,
}: {
  affairId: string;
  actions: PlannedActionRow[];
}) {
  const today = todayISO();
  const open = actions
    .filter((a) => !a.done_at)
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
  const done = actions
    .filter((a) => !!a.done_at)
    .sort((a, b) => (b.done_at ?? "").localeCompare(a.done_at ?? ""))
    .slice(0, 5);
  const next = open[0] ?? null;
  const nextOverdue = !!next && next.due_date < today;
  // Golden rule: no next action, or an overdue one → red.
  const alarm = !next || nextOverdue;

  const [adding, setAdding] = useState(false);
  const showForm = adding || (!next && actions.length === 0);

  return (
    <section>
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
          Next action
        </h3>
        {!showForm && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded border border-neutral-300 px-2 py-0.5 text-[11px] font-semibold text-neutral-800 hover:bg-neutral-50"
          >
            + Plan action
          </button>
        )}
      </div>

      {/* THE next action — the biggest thing on the deal (§8 bloc 1). */}
      <div
        className={`mt-1.5 rounded-lg border px-3 py-2.5 ${
          alarm ? "border-rose-200 bg-rose-50/60" : "border-neutral-200 bg-white"
        }`}
      >
        {next ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-600">
                  {typeLabel(next.action_type)}
                </span>
                <span className="truncate text-[14px] font-semibold text-neutral-900">
                  {next.title ?? typeLabel(next.action_type)}
                </span>
              </div>
              <div className={`mt-0.5 text-[12px] ${nextOverdue ? "font-semibold text-rose-700" : "text-neutral-500"}`}>
                Due {fmtDate(next.due_date, { month: "short", day: "numeric" })}
                {nextOverdue && " — overdue"}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <DoneButton action={next} />
              <DeleteButton action={next} />
            </div>
          </div>
        ) : (
          <p className="text-[13px] font-semibold text-rose-700">
            No next action planned — every live deal needs one.
          </p>
        )}
      </div>

      {showForm && <AddActionForm affairId={affairId} onClose={() => setAdding(false)} />}

      {/* Upcoming (beyond the next one). */}
      {open.length > 1 && (
        <ul className="mt-2 space-y-1">
          {open.slice(1).map((a) => {
            const overdue = a.due_date < today;
            return (
              <li key={a.id} className="flex items-center justify-between gap-2 text-[12px]">
                <span className="min-w-0 truncate text-neutral-700">
                  <span className="text-neutral-400">{typeLabel(a.action_type)} · </span>
                  {a.title ?? typeLabel(a.action_type)}
                  <span className={overdue ? "font-semibold text-rose-700" : "text-neutral-400"}>
                    {" "}
                    · {fmtDate(a.due_date, { month: "short", day: "numeric" })}
                    {overdue && " — overdue"}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <DoneButton action={a} />
                  <DeleteButton action={a} />
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {/* Recently done — muted; the full history lives in the timeline. */}
      {done.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {done.map((a) => (
            <li key={a.id} className="text-[11px] text-neutral-400">
              ✓ {typeLabel(a.action_type)}
              {a.title ? `: ${a.title}` : ""} —{" "}
              {a.done_at ? fmtDate(a.done_at, { month: "short", day: "numeric" }) : ""}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
