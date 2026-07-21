"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { openControlledRevision } from "@/app/(app)/task-lists/[id]/actions";
import {
  formatDiffValue,
  type RevisionFieldChange,
  type TaskListRevision,
} from "@/lib/task-list-revisions";

/**
 * FINAL VALIDATION — freeze banner + revision lineage + field diff (m179).
 *
 * On a frozen task list this is the ONLY path back to editability: a
 * controlled revision with a mandatory reason, which re-runs the full
 * Pre-Validation → Final Validation cycle. Every validated revision stays
 * listed forever; the diff highlights exactly what changed between the
 * current work (or the latest validated version) and the previous one.
 */

const REV_STATUS_STYLE: Record<string, string> = {
  validated: "border-emerald-200 bg-emerald-50 text-emerald-800",
  in_progress: "border-sky-200 bg-sky-50 text-sky-800",
  superseded: "border-neutral-200 bg-neutral-100 text-neutral-500",
};

export function RevisionsPanel({
  taskListId,
  frozen,
  currentRev,
  revisions,
  diff,
  diffLabel,
  canManage,
}: {
  taskListId: string;
  frozen: boolean;
  currentRev: string | null;
  revisions: TaskListRevision[];
  /** Server-computed field diff (see page) — empty when nothing to compare. */
  diff: RevisionFieldChange[];
  diffLabel: string | null;
  /** task_list.validate holders — may open a controlled revision. */
  canManage: boolean;
}) {
  const router = useRouter();
  const [opening, setOpening] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [busy, startTransition] = useTransition();

  const submitRevision = () => {
    setError(null);
    const fd = new FormData();
    fd.set("id", taskListId);
    fd.set("reason", reason);
    startTransition(async () => {
      try {
        await openControlledRevision(fd);
        setOpening(false);
        setReason("");
        router.refresh();
      } catch (e: any) {
        setError(e?.message ?? "Failed to open the revision.");
      }
    });
  };

  if (!frozen && revisions.length === 0) return null;

  return (
    <section
      className={`rounded-lg border p-4 space-y-3 ${
        frozen ? "border-amber-300 bg-amber-50/60" : "border-neutral-200 bg-white"
      }`}
      data-testid="revisions-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="eyebrow">
            {frozen ? "Final Validation — frozen" : "Revisions"}
          </div>
          <p className="mt-0.5 max-w-3xl text-xs text-neutral-600">
            {frozen ? (
              <>
                This task list is the official validated version
                {currentRev ? (
                  <>
                    {" "}
                    — <b>Rev {currentRev}</b>
                  </>
                ) : null}
                . Its values, documents, AI extractions and corrections are
                immutable. Any change requires a controlled revision, which
                goes back through the full Pre-Validation cycle.
              </>
            ) : (
              "Every validated version of this task list, with what changed between them."
            )}
          </p>
        </div>
        {frozen && canManage && (
          <button
            type="button"
            onClick={() => setOpening((v) => !v)}
            data-testid="open-revision"
            className="rounded-md border border-amber-400 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
          >
            {opening ? "Cancel" : "Open controlled revision…"}
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </div>
      )}

      {opening && (
        <div className="rounded-md border border-neutral-200 bg-white p-3 space-y-2">
          <label className="block">
            <span className="eyebrow mb-1 block">Reason for change *</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="e.g. Customer changes battery capacity from 65Ah to 100Ah"
              className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm"
              data-testid="revision-reason"
            />
          </label>
          <p className="text-[11px] text-neutral-500">
            A new revision (Rev {nextLabelHint(revisions)}) will be created and
            the task list returns to Pre-Validation. The current validated
            version stays frozen and accessible. The new revision becomes the
            official version only after its own Final Validation.
          </p>
          <button
            type="button"
            onClick={submitRevision}
            disabled={busy || reason.trim().length < 5}
            className="rounded-md border border-solux bg-solux px-3 py-1.5 text-xs font-medium text-white hover:bg-solux/90 disabled:opacity-60"
            data-testid="confirm-revision"
          >
            {busy ? "Opening…" : "Create revision & return to Pre-Validation"}
          </button>
        </div>
      )}

      {/* Lineage */}
      {revisions.length > 0 && (
        <ul className="divide-y divide-neutral-100 rounded-md border border-neutral-200 bg-white">
          {revisions.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2">
              <b className="text-sm text-neutral-900">Rev {r.rev}</b>
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] ${
                  REV_STATUS_STYLE[r.status] ?? REV_STATUS_STYLE.superseded
                }`}
              >
                {r.status === "in_progress" ? "in progress" : r.status}
              </span>
              {r.reason && <span className="text-xs text-neutral-600">{r.reason}</span>}
              <span className="ml-auto text-[11px] text-neutral-500">
                {r.status === "in_progress"
                  ? `opened ${r.created_at?.slice(0, 10) ?? ""}${r.created_by_label ? ` by ${r.created_by_label}` : ""}`
                  : `validated ${r.validated_at?.slice(0, 10) ?? ""}${r.validated_by_label ? ` by ${r.validated_by_label}` : ""}`}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Diff */}
      {diff.length > 0 && diffLabel && (
        <div>
          <button
            type="button"
            onClick={() => setShowDiff((v) => !v)}
            className="text-xs font-medium text-neutral-700 underline decoration-neutral-300 hover:decoration-neutral-500"
            data-testid="toggle-diff"
          >
            {showDiff ? "Hide" : "Show"} changes — {diffLabel} ({diff.length} field
            {diff.length === 1 ? "" : "s"})
          </button>
          {showDiff && (
            <div className="mt-2 overflow-x-auto rounded-md border border-neutral-200 bg-white">
              <table className="w-full text-left text-[11px]">
                <thead className="bg-neutral-50 text-neutral-500">
                  <tr>
                    <th className="px-3 py-1.5 font-medium">Field</th>
                    <th className="px-3 py-1.5 font-medium">Before</th>
                    <th className="px-3 py-1.5 font-medium">After</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {diff.map((c, i) => (
                    <tr key={i}>
                      <td className="px-3 py-1.5 font-mono text-neutral-700">
                        {c.path}
                        {c.kind !== "changed" && (
                          <span className="ml-1 text-[10px] uppercase text-neutral-400">
                            {c.kind}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-neutral-500">{formatDiffValue(c.from)}</td>
                      <td className="px-3 py-1.5 font-medium text-neutral-900">
                        {formatDiffValue(c.to)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function nextLabelHint(revs: TaskListRevision[]): string {
  // Purely cosmetic preview of the next letter (server assigns the real one).
  const n = revs.length === 0 ? 1 : revs.length + 1;
  let x = n,
    out = "";
  while (x > 0) {
    x -= 1;
    out = String.fromCharCode(65 + (x % 26)) + out;
    x = Math.floor(x / 26);
  }
  return out;
}
