"use client";

import { useState, useTransition } from "react";
import { useDirty } from "@/app/(app)/task-lists/[id]/DirtyContext";
import {
  TASK_LIST_STATUS_DOT,
  TASK_LIST_STATUS_LABEL,
  type ProductionTaskListStatus,
} from "@/lib/types";
import {
  markProductionReady,
  rejectTaskList,
  reopenForRevision,
  requestRevision,
  submitForValidation,
  validateTaskList,
} from "@/app/(app)/task-lists/[id]/actions";

/** Inline spinner used while an action is in flight. */
function MiniSpinner() {
  return (
    <svg
      className="animate-spin h-3.5 w-3.5 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
        strokeOpacity="0.25"
      />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Compact colored badge for a task list status. */
export function TaskListStatusBadge({
  status,
  size = "sm",
}: {
  status: ProductionTaskListStatus;
  size?: "sm" | "md";
}) {
  const padding =
    size === "md" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-[11px]";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white font-medium text-neutral-700 ${padding}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${TASK_LIST_STATUS_DOT[status]}`}
      />
      {TASK_LIST_STATUS_LABEL[status]}
    </span>
  );
}

/**
 * Renders the role-correct next action for a task list. Sales-side actions
 * are limited to "Submit for production validation" — every PDF and every
 * technical transition lives behind the TLM/admin role.
 */
export default function TaskListWorkflowActions({
  taskListId,
  status,
  isTechnical,
}: {
  taskListId: string;
  status: ProductionTaskListStatus;
  /** True if the current user is task_list_manager or admin. */
  isTechnical: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [showDirtyModal, setShowDirtyModal] = useState(false);
  const [pendingSubmitKey, setPendingSubmitKey] = useState<string | null>(null);
  // useDirty() is safe even when DirtyProvider is absent (context default: hasAnyDirty=false).
  const dirtyCtx = useDirty();

  function fire(key: string, action: (fd: FormData) => Promise<void>) {
    const fd = new FormData();
    fd.set("id", taskListId);
    setPendingKey(key);
    startTransition(async () => {
      try {
        await action(fd);
      } finally {
        setPendingKey(null);
      }
    });
  }

  /** Like fire(), but first checks for unsaved changes and shows a modal. */
  function fireWithDirtyGuard(key: string) {
    if (dirtyCtx.hasAnyDirty) {
      setPendingSubmitKey(key);
      setShowDirtyModal(true);
      return;
    }
    fire(key, submitForValidation);
  }

  async function handleSaveAndSubmit() {
    setShowDirtyModal(false);
    setPendingKey(pendingSubmitKey ?? "submit-draft");
    startTransition(async () => {
      try {
        await dirtyCtx.saveAll();
        const fd = new FormData();
        fd.set("id", taskListId);
        await submitForValidation(fd);
      } finally {
        setPendingKey(null);
        setPendingSubmitKey(null);
      }
    });
  }

  /** Renders either the label or a spinner depending on whether this
   *  specific action key is the one currently in flight. */
  function btnLabel(key: string, label: string, pendingLabel?: string) {
    if (pendingKey === key) {
      return (
        <>
          <MiniSpinner />
          <span>{pendingLabel ?? "Working…"}</span>
        </>
      );
    }
    return <span>{label}</span>;
  }

  const primaryClass =
    "inline-flex items-center gap-1.5 rounded-md bg-solux px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-solux-dark disabled:opacity-50";
  const secondaryClass =
    "inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3.5 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-50";
  const dangerClass =
    "inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-white px-3.5 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50";

  // Dirty-guard modal — rendered once, outside all status branches.
  const dirtyModal = showDirtyModal ? (
    <DirtySubmitModal
      dirtyCount={dirtyCtx.dirtyCount}
      onSaveAndSubmit={handleSaveAndSubmit}
      onCancel={() => setShowDirtyModal(false)}
    />
  ) : null;

  // ---------- DRAFT — Sales is preparing ----------
  if (status === "draft") {
    return (
      <>
        {dirtyModal}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => fireWithDirtyGuard("submit-draft")}
            className={primaryClass}
            title="Hand off to the production team for validation."
          >
            {btnLabel("submit-draft", "Submit for production validation →", "Submitting…")}
          </button>
          {isTechnical && (
            <button
              type="button"
              disabled={pending}
              onClick={() => fire("reject-draft", rejectTaskList)}
              className={dangerClass}
            >
              {btnLabel("reject-draft", "Reject", "Rejecting…")}
            </button>
          )}
        </div>
      </>
    );
  }

  // ---------- UNDER VALIDATION — Production team's turn ----------
  if (status === "under_validation") {
    if (!isTechnical) {
      return (
        <p className="text-xs text-neutral-500">
          Submitted for production validation. The production team will pick
          this up — sales edits are locked until they validate or request
          revisions.
        </p>
      );
    }
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => fire("validate", validateTaskList)}
          className={primaryClass}
        >
          {btnLabel("validate", "Validate", "Validating…")}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => fire("mark-ready-from-uv", markProductionReady)}
          className={secondaryClass}
          title="Skip technical enrichment — mark production-ready directly."
        >
          {btnLabel("mark-ready-from-uv", "Mark production ready", "Marking ready…")}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => fire("request-revision-uv", requestRevision)}
          className={secondaryClass}
        >
          {btnLabel("request-revision-uv", "Request revision", "Requesting…")}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => fire("reject-uv", rejectTaskList)}
          className={dangerClass}
        >
          {btnLabel("reject-uv", "Reject", "Rejecting…")}
        </button>
      </div>
    );
  }

  // ---------- NEEDS REVISION — Sales has work to do ----------
  if (status === "needs_revision") {
    if (!isTechnical) {
      return (
        <>
          {dirtyModal}
          <div className="space-y-2">
            <p className="text-xs text-red-700 font-medium">
              The production team has requested revisions. Please review the
              task list, make the requested changes, then re-submit.
            </p>
            <button
              type="button"
              disabled={pending}
              onClick={() => fireWithDirtyGuard("resubmit")}
              className={primaryClass}
            >
              {btnLabel("resubmit", "Re-submit for validation →", "Submitting…")}
            </button>
          </div>
        </>
      );
    }
    return (
      <div className="space-y-2">
        <p className="text-xs text-neutral-500">
          Sales is working on the requested revisions. They'll re-submit
          when ready.
        </p>
        <button
          type="button"
          disabled={pending}
          onClick={() => fire("reject-revision", rejectTaskList)}
          className={dangerClass}
        >
          {btnLabel("reject-revision", "Reject", "Rejecting…")}
        </button>
      </div>
    );
  }

  // ---------- VALIDATED — Technical enrichment in progress ----------
  if (status === "validated") {
    if (!isTechnical) {
      return (
        <p className="text-xs text-neutral-500">
          Validated by the production team — technical enrichment is in
          progress. Sales edits remain locked.
        </p>
      );
    }
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => fire("mark-ready-from-validated", markProductionReady)}
          className={primaryClass}
        >
          {btnLabel("mark-ready-from-validated", "Mark production ready →", "Marking ready…")}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => fire("request-revision-validated", requestRevision)}
          className={secondaryClass}
        >
          {btnLabel("request-revision-validated", "Request revision", "Requesting…")}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => fire("reject-validated", rejectTaskList)}
          className={dangerClass}
        >
          {btnLabel("reject-validated", "Reject", "Rejecting…")}
        </button>
      </div>
    );
  }

  // ---------- PRODUCTION READY — Factory PDF is now generatable ----------
  if (status === "production_ready") {
    if (!isTechnical) {
      return (
        <p className="text-xs text-emerald-700">
          Production ready. The production team can now generate the
          factory PDF.
        </p>
      );
    }
    return (
      <div className="space-y-2">
        <p className="text-xs text-emerald-700">
          Ready for factory release. Use the <b>Factory PDF</b> button at
          the top to generate the final production document.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => fire("reopen", reopenForRevision)}
            className={secondaryClass}
            title="Reopen for further technical edits before factory release."
          >
            {btnLabel("reopen", "Reopen for revisions", "Reopening…")}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => fire("bounce-back", requestRevision)}
            className={secondaryClass}
          >
            {btnLabel("bounce-back", "Bounce back to sales", "Bouncing…")}
          </button>
        </div>
      </div>
    );
  }

  // ---------- CANCELLED — terminal ----------
  if (status === "cancelled") {
    return (
      <>
        {showDirtyModal && (
          <DirtySubmitModal
            dirtyCount={dirtyCtx.dirtyCount}
            onSaveAndSubmit={handleSaveAndSubmit}
            onCancel={() => setShowDirtyModal(false)}
          />
        )}
        <p className="text-xs text-neutral-500">
          This task list has been rejected and is archived.
        </p>
      </>
    );
  }

  return showDirtyModal ? (
    <DirtySubmitModal
      dirtyCount={dirtyCtx.dirtyCount}
      onSaveAndSubmit={handleSaveAndSubmit}
      onCancel={() => setShowDirtyModal(false)}
    />
  ) : null;
}

// =========================================================================
// DirtySubmitModal — shown when the user tries to submit with unsaved changes.
// Rendered inline by TaskListWorkflowActions via the showDirtyModal state.
// Extracted here so it can be portal-rendered. The parent renders it.
// =========================================================================
export function DirtySubmitModal({
  dirtyCount,
  onSaveAndSubmit,
  onCancel,
}: {
  dirtyCount: number;
  onSaveAndSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="mx-4 w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start gap-3 border-b border-neutral-100 bg-amber-50 px-5 py-4">
          <span className="mt-0.5 text-xl leading-none text-amber-500" aria-hidden>
            ⚠
          </span>
          <div>
            <h2 className="text-[15px] font-semibold text-neutral-900">
              You have unsaved changes
            </h2>
            <p className="mt-1 text-[12px] text-neutral-600">
              {dirtyCount} line{dirtyCount === 1 ? "" : "s"} with unsaved changes will be
              lost if you submit now.
            </p>
          </div>
        </div>
        <div className="px-5 py-4 text-[12px] text-neutral-600">
          Save all changes before submitting?
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-neutral-100 px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-[13px] font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSaveAndSubmit}
            className="rounded-md bg-solux px-4 py-2 text-[13px] font-semibold text-white shadow-sm hover:bg-solux-dark"
          >
            Save &amp; Submit
          </button>
        </div>
      </div>
    </div>
  );
}
