"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createTaskListActionItem,
  setTaskListActionItemStatus,
  deleteTaskListActionItem,
} from "@/app/(app)/task-lists/[id]/action-items";
import {
  ACTION_ITEM_DEPARTMENTS,
  ACTION_ITEM_DEPARTMENT_LABELS,
  isPendingActionStatus,
  pendingItemsSorted,
  type TaskListActionItem,
} from "@/lib/task-list-action-items";

/**
 * PRE-VALIDATION BOARD (m178) — the dashboard of the collaborative phase.
 *
 * One glance answers: what is blocking Final Validation, what is pending and
 * on whose desk, which AI-extracted values still need a human, and what the
 * team has flagged as risky. Blocking errors aggregate the EXISTING release
 * gates (required fields, factory mappings, tilt checkpoint m159, tilt
 * conflict m176, open revision) plus the new blocking action items; nothing
 * here invents a second source of truth — every signal is the same one the
 * server-side evaluateRelease enforces.
 */

export type BoardSignals = {
  requiredEmptyCount: number;
  missingMappingCount: number;
  tiltCheckpointPending: boolean;
  tiltConflictPending: boolean;
  hasOpenRevision: boolean;
  lineCount: number;
};

export type BoardAiField = {
  label: string;
  value: string;
  /** 0..1 when the model reported one. */
  confidence: number | null;
  /** m176-style review state when the field has one (tilt today). */
  state?: "pending" | "applied" | "accepted_ai" | "kept_manual" | null;
  manuallyModified?: boolean;
};

export function PreValidationBoard({
  taskListId,
  items,
  users,
  signals,
  aiFields,
  warnings,
  canCreate,
  canBlock,
  isTechnical,
  userId,
  m178Live,
}: {
  taskListId: string;
  items: TaskListActionItem[];
  users: { id: string; label: string }[];
  signals: BoardSignals;
  aiFields: BoardAiField[];
  warnings: string[];
  /** May add items (technical always; sales during the working window). */
  canCreate: boolean;
  /** May mark an item blocking (technical only — it gates the release). */
  canBlock: boolean;
  isTechnical: boolean;
  userId: string | null;
  /** false = m178 not applied — the board renders read-only with a hint. */
  m178Live: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const pending = pendingItemsSorted(items);
  const doneCount = items.filter((i) => !isPendingActionStatus(i.status)).length;
  const blockingItems = pending.filter((i) => i.blocking);

  // ---- blocking errors: the release gate, itemised --------------------------
  const blockers: { text: string; anchor?: string }[] = [];
  if (signals.lineCount === 0)
    blockers.push({ text: "No products on this task list — nothing to manufacture." });
  for (const it of blockingItems)
    blockers.push({ text: `${it.title} (${ACTION_ITEM_DEPARTMENT_LABELS[it.department]})` });
  if (signals.hasOpenRevision)
    blockers.push({ text: "Open revision request — Sales must reply and re-submit." });
  if (signals.requiredEmptyCount > 0)
    blockers.push({
      text: `${signals.requiredEmptyCount} required field${signals.requiredEmptyCount === 1 ? "" : "s"} still empty`,
      anchor: "#tl-product",
    });
  if (signals.missingMappingCount > 0)
    blockers.push({
      text: `${signals.missingMappingCount} factory mapping${signals.missingMappingCount === 1 ? "" : "s"} missing`,
      anchor: "#tl-product",
    });
  if (signals.tiltConflictPending)
    blockers.push({
      text: "Tilt angle conflict — the Energy Study disagrees with the task list",
      anchor: "#tl-industrial",
    });
  if (signals.tiltCheckpointPending)
    blockers.push({
      text: "Pole drawing not yet verified against the tilt angle",
      anchor: "#tl-industrial",
    });

  const aiNeedingReview = aiFields.filter(
    (f) => f.state === "pending" || (f.state == null && f.confidence != null && f.confidence < 0.85)
  );

  const submitCreate = (fd: FormData) => {
    setError(null);
    fd.set("task_list_id", taskListId);
    startTransition(async () => {
      try {
        await createTaskListActionItem(fd);
        setAdding(false);
        router.refresh();
      } catch (e: any) {
        setError(e?.message ?? "Failed to add the item.");
      }
    });
  };

  const setStatus = (itemId: string, status: string) => {
    setError(null);
    const fd = new FormData();
    fd.set("item_id", itemId);
    fd.set("status", status);
    startTransition(async () => {
      try {
        await setTaskListActionItemStatus(fd);
        router.refresh();
      } catch (e: any) {
        setError(e?.message ?? "Failed to update the item.");
      }
    });
  };

  const remove = (itemId: string) => {
    setError(null);
    const fd = new FormData();
    fd.set("item_id", itemId);
    startTransition(async () => {
      try {
        await deleteTaskListActionItem(fd);
        router.refresh();
      } catch (e: any) {
        setError(e?.message ?? "Failed to delete the item.");
      }
    });
  };

  const input = "w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-xs";
  const chip = "rounded-full border px-2.5 py-1 text-[11px]";

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4 space-y-4" data-testid="pre-validation-board">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="eyebrow">Pre-Validation</div>
          <p className="mt-0.5 text-xs text-neutral-500 max-w-3xl">
            The collaborative phase: iterate with the factory, engineering, the
            study lab, purchasing and sales until the file is complete.
            Everything below must be settled before Final Validation.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className={`${chip} ${blockers.length ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
            {blockers.length ? `${blockers.length} blocking` : "Nothing blocking"}
          </span>
          <span className={`${chip} border-neutral-200 bg-neutral-50 text-neutral-600`}>
            {pending.length} pending · {doneCount} done
          </span>
          {aiNeedingReview.length > 0 && (
            <span className={`${chip} border-indigo-200 bg-indigo-50 text-indigo-800`}>
              {aiNeedingReview.length} AI value{aiNeedingReview.length === 1 ? "" : "s"} to review
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>
      )}

      {/* ---- Blocking errors ---- */}
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
          Blocking errors — prevent Final Validation
        </div>
        {blockers.length === 0 ? (
          <p className="mt-1 text-xs text-emerald-700">None — the release gate is clear.</p>
        ) : (
          <ul className="mt-1 space-y-0.5 text-xs text-neutral-800">
            {blockers.map((b, i) => (
              <li key={i} className="flex items-baseline gap-1.5">
                <span className="text-rose-500" aria-hidden>●</span>
                <span>
                  {b.text}
                  {b.anchor && (
                    <>
                      {" — "}
                      <a className="underline decoration-neutral-300 hover:decoration-neutral-500" href={b.anchor}>resolve ↓</a>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ---- Pending issues (action items) ---- */}
      <div>
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            Pending issues — who owes what
          </div>
          {canCreate && m178Live && (
            <button
              type="button"
              onClick={() => setAdding((v) => !v)}
              className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-[11px] font-medium text-neutral-700 hover:bg-neutral-50"
              data-testid="add-action-item"
            >
              {adding ? "Cancel" : "+ Add item"}
            </button>
          )}
        </div>

        {!m178Live && (
          <p className="mt-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
            Action items activate once migration <b>m178</b> (178_task_list_action_items.sql)
            is applied in Supabase — the rest of the board already works.
          </p>
        )}

        {adding && (
          <form action={submitCreate} className="mt-2 grid grid-cols-1 gap-2 rounded-md border border-neutral-200 bg-neutral-50/60 p-3 md:grid-cols-12">
            <input name="title" required placeholder="e.g. Waiting for pole calculation" className={`${input} md:col-span-5`} aria-label="Item title" />
            <select name="department" className={`${input} md:col-span-2`} defaultValue="factory" aria-label="Department">
              {ACTION_ITEM_DEPARTMENTS.map((d) => (
                <option key={d} value={d}>{ACTION_ITEM_DEPARTMENT_LABELS[d]}</option>
              ))}
            </select>
            <select name="assignee" className={`${input} md:col-span-2`} defaultValue="" aria-label="Assignee">
              <option value="">— Unassigned —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.label}</option>
              ))}
            </select>
            <input name="due_date" type="date" className={`${input} md:col-span-2`} aria-label="Due date (optional)" />
            <div className="md:col-span-1 flex items-center">
              {canBlock && (
                <label className="inline-flex items-center gap-1 text-[11px] text-neutral-700" title="An open blocking item prevents Final Validation">
                  <input type="checkbox" name="blocking" value="1" className="h-3.5 w-3.5 rounded border-neutral-300" />
                  Blocks
                </label>
              )}
            </div>
            <input name="details" placeholder="Details (optional)" className={`${input} md:col-span-10`} aria-label="Details" />
            <button type="submit" disabled={busy} className="md:col-span-2 rounded-md border border-solux bg-solux px-3 py-1.5 text-xs font-medium text-white hover:bg-solux/90 disabled:opacity-60">
              {busy ? "Adding…" : "Add"}
            </button>
          </form>
        )}

        {pending.length === 0 ? (
          <p className="mt-1 text-xs text-neutral-500">No pending items.</p>
        ) : (
          <ul className="mt-1.5 divide-y divide-neutral-100 rounded-md border border-neutral-200">
            {pending.map((it) => {
              const mine = userId != null && (it.created_by === userId || it.assignee === userId);
              const mayToggle = isTechnical || mine;
              return (
                <li key={it.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  {it.blocking && (
                    <span className="rounded-full border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-700">blocking</span>
                  )}
                  <span className="text-xs font-medium text-neutral-900">{it.title}</span>
                  <span className="rounded-full border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 text-[10px] text-neutral-600">
                    {ACTION_ITEM_DEPARTMENT_LABELS[it.department]}
                  </span>
                  {it.assignee_label && (
                    <span className="text-[11px] text-neutral-500">→ {it.assignee_label}</span>
                  )}
                  {it.due_date && (
                    <span className="text-[11px] tabular-nums text-neutral-500">due {it.due_date}</span>
                  )}
                  {it.status === "in_progress" && (
                    <span className="text-[10px] uppercase tracking-wide text-sky-700">in progress</span>
                  )}
                  {it.details && <span className="basis-full text-[11px] text-neutral-500">{it.details}</span>}
                  {mayToggle && (
                    <span className="ml-auto flex items-center gap-2">
                      {it.status === "open" ? (
                        <button type="button" disabled={busy} onClick={() => setStatus(it.id, "in_progress")} className="text-[11px] text-sky-700 underline decoration-sky-200 hover:decoration-sky-500">start</button>
                      ) : (
                        <button type="button" disabled={busy} onClick={() => setStatus(it.id, "open")} className="text-[11px] text-neutral-500 underline decoration-neutral-200">pause</button>
                      )}
                      <button type="button" disabled={busy} onClick={() => setStatus(it.id, "done")} className="text-[11px] text-emerald-700 underline decoration-emerald-200 hover:decoration-emerald-500">done</button>
                      {(isTechnical || it.created_by === userId) && (
                        <button type="button" disabled={busy} onClick={() => remove(it.id)} className="text-[11px] text-neutral-400 hover:text-rose-600">✕</button>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ---- AI review ---- */}
      {aiFields.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            AI-extracted values — review before Final Validation
          </div>
          <ul className="mt-1 space-y-0.5 text-xs">
            {aiFields.map((f, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-neutral-600">{f.label}:</span>
                <b className="tabular-nums text-neutral-900">{f.value}</b>
                {f.confidence != null && (
                  <span className={`text-[11px] ${f.confidence < 0.85 ? "text-amber-700" : "text-neutral-400"}`}>
                    {Math.round(f.confidence * 100)}% confidence
                  </span>
                )}
                {f.state === "pending" && (
                  <span className="rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-900">conflict — resolve below</span>
                )}
                {f.state === "accepted_ai" && (
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-800">confirmed</span>
                )}
                {f.state === "kept_manual" && (
                  <span className="rounded-full border border-neutral-200 bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600">manual value kept</span>
                )}
                {f.manuallyModified && (
                  <span className="text-[10px] text-neutral-500">· manually corrected since</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---- Warnings (non-blocking) ---- */}
      {warnings.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            Warnings — non-blocking
          </div>
          <ul className="mt-1 space-y-0.5 text-xs text-amber-900">
            {warnings.map((w, i) => (
              <li key={i} className="flex items-baseline gap-1.5">
                <span aria-hidden>⚠</span>
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
