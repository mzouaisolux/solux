"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
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
  requestRevisionWithReason,
  resubmitWithResponse,
  submitForValidation,
  validateTaskList,
} from "@/app/(app)/task-lists/[id]/actions";
import {
  REVISION_CATEGORIES,
  REVISION_DEFAULT_SCOPE,
  REVISION_FIELD_SCOPES,
  type RevisionThreadInfo,
} from "@/lib/revision-shared";

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

/** Shared display of a revision request — used on both the Sales banner
 *  (actionable, red) and the TLM "waiting" banner (neutral). */
function RevisionRequestCard({
  req,
  tone,
}: {
  req: NonNullable<RevisionThreadInfo["request"]>;
  tone: "sales" | "tlm";
}) {
  const accent =
    tone === "sales"
      ? "border-red-200 bg-red-50 text-red-900"
      : "border-amber-200 bg-amber-50 text-amber-900";
  return (
    <div className={`rounded-md border ${accent} px-3 py-2 text-xs`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-semibold">
        <span>
          {tone === "sales"
            ? "Revision requested by Production / Task List Manager"
            : "Waiting for Sales revision"}
        </span>
        <span className="rounded bg-white/70 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide">
          {req.categoryLabel}
        </span>
        {req.field && (
          <span className="rounded bg-white/70 px-1.5 py-0.5 text-[10px] font-medium">
            Field: {req.field}
          </span>
        )}
      </div>
      <p className="mt-1 whitespace-pre-wrap font-normal">{req.message}</p>
      <p className="mt-1 text-[10px] opacity-70">
        {req.authorName ? `by ${req.authorName}` : ""}
        {req.createdAt
          ? ` · ${new Date(req.createdAt).toLocaleString()}`
          : ""}
      </p>
    </div>
  );
}

/**
 * Renders the role-correct next action for a task list. Sales-side actions
 * are limited to "Submit for production validation" — every PDF and every
 * technical transition lives behind the TLM/admin role.
 *
 * D1: "Request revision" and "Re-submit" go through structured modals so a
 * revision always carries a reason and a re-submit always carries a response.
 * "Validate" goes through a "Release to Production?" confirmation that is
 * blocked while mappings are incomplete.
 */
export default function TaskListWorkflowActions({
  taskListId,
  status,
  isTechnical,
  canValidate = false,
  canReject = false,
  revisionThread,
  missingMappingCount = 0,
  clientName = null,
  taskNumber = null,
}: {
  taskListId: string;
  status: ProductionTaskListStatus;
  /** True if the current user is task_list_manager or admin. */
  isTechnical: boolean;
  /** Capability task_list.validate (UI only) — enables Validate / Mark-ready /
   *  Request-revision / Reopen. Backend re-checks via requireCapability. */
  canValidate?: boolean;
  /** Capability task_list.reject (UI only) — enables the Reject buttons. */
  canReject?: boolean;
  /** Latest revision request + response (resolved server-side). */
  revisionThread?: RevisionThreadInfo;
  /** Required factory mappings still missing — blocks Release to Production. */
  missingMappingCount?: number;
  clientName?: string | null;
  taskNumber?: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [showDirtyModal, setShowDirtyModal] = useState(false);
  const [pendingSubmitKey, setPendingSubmitKey] = useState<string | null>(null);
  const [modal, setModal] = useState<null | "revision" | "resubmit" | "release">(
    null
  );
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

  // Capability honesty: a technical-view user who lacks the matrix capability
  // sees the action area disabled WITH a clear reason, instead of an active
  // button that errors on click. Backend (requireCapability) stays the source
  // of truth — this only keeps the UI from lying.
  const missingCaps = [
    !canValidate && "task_list.validate",
    !canReject && "task_list.reject",
  ].filter(Boolean) as string[];
  const capNote =
    isTechnical && missingCaps.length > 0 ? (
      <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
        Read-only for your role — missing <b>{missingCaps.join(" + ")}</b>. Ask a
        super-admin to enable it in <code>/permissions/actions</code>.
      </p>
    ) : null;
  const validateTitle = canValidate
    ? undefined
    : "Requires the task_list.validate capability.";
  const rejectTitle = canReject
    ? undefined
    : "Requires the task_list.reject capability.";

  // Dirty-guard modal — rendered once, outside all status branches.
  const dirtyModal = showDirtyModal ? (
    <DirtySubmitModal
      dirtyCount={dirtyCtx.dirtyCount}
      onSaveAndSubmit={handleSaveAndSubmit}
      onCancel={() => setShowDirtyModal(false)}
    />
  ) : null;

  // Workflow modals (revision request / resubmit / release) — rendered once.
  const workflowModals = (
    <>
      {modal === "revision" && (
        <RevisionRequestModal
          taskListId={taskListId}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "resubmit" && (
        <ResubmitModal
          taskListId={taskListId}
          request={revisionThread?.request ?? null}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "release" && (
        <ReleaseModal
          taskListId={taskListId}
          clientName={clientName}
          taskNumber={taskNumber}
          missingMappingCount={missingMappingCount}
          revisionThread={revisionThread}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );

  // ---------- DRAFT — Sales is preparing ----------
  if (status === "draft") {
    return (
      <>
        {dirtyModal}
        {workflowModals}
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
              disabled={pending || !canReject}
              title={rejectTitle}
              onClick={() => fire("reject-draft", rejectTaskList)}
              className={dangerClass}
            >
              {btnLabel("reject-draft", "Reject", "Rejecting…")}
            </button>
          )}
        </div>
        {capNote}
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
      <>
        {workflowModals}
        <div className="space-y-2">
          {revisionThread?.response && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
              <span className="font-semibold">Latest Sales response</span>
              {revisionThread.response.authorName
                ? ` · ${revisionThread.response.authorName}`
                : ""}
              <p className="mt-1 whitespace-pre-wrap font-normal">
                {revisionThread.response.message}
              </p>
            </div>
          )}
          {capNote}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={pending || !canValidate}
              onClick={() => setModal("release")}
              className={primaryClass}
              title={validateTitle ?? "Review mapping completeness, then release to production."}
            >
              {btnLabel("validate", "Validate →", "Validating…")}
            </button>
            <button
              type="button"
              disabled={pending || !canValidate}
              title={validateTitle}
              onClick={() => setModal("revision")}
              className={secondaryClass}
            >
              {btnLabel("request-revision-uv", "Request revision", "Requesting…")}
            </button>
            <button
              type="button"
              disabled={pending || !canReject}
              title={rejectTitle}
              onClick={() => fire("reject-uv", rejectTaskList)}
              className={dangerClass}
            >
              {btnLabel("reject-uv", "Reject", "Rejecting…")}
            </button>
          </div>
        </div>
      </>
    );
  }

  // ---------- NEEDS REVISION — Sales has work to do ----------
  if (status === "needs_revision") {
    if (!isTechnical) {
      return (
        <>
          {dirtyModal}
          {workflowModals}
          <div className="space-y-2">
            {revisionThread?.request ? (
              <RevisionRequestCard req={revisionThread.request} tone="sales" />
            ) : (
              <p className="text-xs text-red-700 font-medium">
                The production team has requested revisions. Please review the
                task list, make the requested changes, then re-submit.
              </p>
            )}
            <button
              type="button"
              disabled={pending}
              onClick={() => setModal("resubmit")}
              className={primaryClass}
            >
              {btnLabel("resubmit", "Reply & re-submit →", "Submitting…")}
            </button>
          </div>
        </>
      );
    }
    return (
      <>
        {workflowModals}
        <div className="space-y-2">
          {revisionThread?.request ? (
            <RevisionRequestCard req={revisionThread.request} tone="tlm" />
          ) : (
            <p className="text-xs text-neutral-500">
              Sales is working on the requested revisions. They&apos;ll
              re-submit when ready.
            </p>
          )}
          <button
            type="button"
            disabled={pending || !canReject}
            title={rejectTitle}
            onClick={() => fire("reject-revision", rejectTaskList)}
            className={dangerClass}
          >
            {btnLabel("reject-revision", "Reject", "Rejecting…")}
          </button>
          {capNote}
        </div>
      </>
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
      <>
        {workflowModals}
        {capNote}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={pending || !canValidate}
            title={validateTitle}
            onClick={() => fire("mark-ready-from-validated", markProductionReady)}
            className={primaryClass}
          >
            {btnLabel("mark-ready-from-validated", "Mark production ready →", "Marking ready…")}
          </button>
          <button
            type="button"
            disabled={pending || !canValidate}
            title={validateTitle}
            onClick={() => setModal("revision")}
            className={secondaryClass}
          >
            {btnLabel("request-revision-validated", "Request revision", "Requesting…")}
          </button>
          <button
            type="button"
            disabled={pending || !canReject}
            title={rejectTitle}
            onClick={() => fire("reject-validated", rejectTaskList)}
            className={dangerClass}
          >
            {btnLabel("reject-validated", "Reject", "Rejecting…")}
          </button>
        </div>
      </>
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
      <>
        {workflowModals}
        <div className="space-y-2">
          <p className="text-xs text-emerald-700">
            Ready for factory release. Use the <b>Factory PDF</b> button at
            the top to generate the final production document.
          </p>
          {capNote}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={pending || !canValidate}
              onClick={() => fire("reopen", reopenForRevision)}
              className={secondaryClass}
              title={validateTitle ?? "Reopen for further technical edits before factory release."}
            >
              {btnLabel("reopen", "Reopen for revisions", "Reopening…")}
            </button>
            <button
              type="button"
              disabled={pending || !canValidate}
              title={validateTitle}
              onClick={() => setModal("revision")}
              className={secondaryClass}
            >
              {btnLabel("bounce-back", "Bounce back to sales", "Bouncing…")}
            </button>
          </div>
        </div>
      </>
    );
  }

  // ---------- CANCELLED — terminal ----------
  if (status === "cancelled") {
    return (
      <p className="text-xs text-neutral-500">
        This task list has been rejected and is archived.
      </p>
    );
  }

  return null;
}

// =========================================================================
// RevisionRequestModal — structured "send back to Sales" (D1).
// =========================================================================
function RevisionRequestModal({
  taskListId,
  onClose,
}: {
  taskListId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [category, setCategory] = useState("");
  const [message, setMessage] = useState("");
  const [field, setField] = useState(REVISION_DEFAULT_SCOPE);
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (!category) return setError("Please choose a category.");
    if (!message.trim())
      return setError("Please explain what Sales must clarify or correct.");
    setError(null);
    const fd = new FormData();
    fd.set("id", taskListId);
    fd.set("category", category);
    fd.set("message", message.trim());
    fd.set("field", field);
    startTransition(async () => {
      try {
        await requestRevisionWithReason(fd);
        onClose();
        router.refresh();
      } catch (e: any) {
        setError(e?.message ?? "Could not send the revision request.");
      }
    });
  }

  return (
    <ModalShell title="Request revision — send back to Sales" onClose={onClose}>
      <label className="block">
        <span className="text-xs font-medium text-neutral-600">Category *</span>
        <select
          autoFocus
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="mt-1 w-full rounded border px-3 py-2 text-sm"
        >
          <option value="">— select —</option>
          {REVISION_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <label className="mt-3 block">
        <span className="text-xs font-medium text-neutral-600">
          Field / scope
        </span>
        <select
          value={field}
          onChange={(e) => setField(e.target.value)}
          className="mt-1 w-full rounded border px-3 py-2 text-sm"
        >
          {REVISION_FIELD_SCOPES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label className="mt-3 block">
        <span className="text-xs font-medium text-neutral-600">Message *</span>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          placeholder="Explain clearly what Sales must clarify or correct before the Factory Mapping can be completed."
          className="mt-1 w-full rounded border px-3 py-2 text-sm"
        />
      </label>
      {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}
      <ModalFooter
        onClose={onClose}
        pending={pending}
        confirmLabel="Send back to Sales"
        pendingLabel="Sending…"
        onConfirm={submit}
        disabled={!category || !message.trim()}
      />
    </ModalShell>
  );
}

// =========================================================================
// ResubmitModal — Sales answers the revision + re-submits (D1).
// =========================================================================
function ResubmitModal({
  taskListId,
  request,
  onClose,
}: {
  taskListId: string;
  request: RevisionThreadInfo["request"];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [response, setResponse] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (!response.trim())
      return setError(
        "Please summarize what you corrected or confirmed before re-submitting."
      );
    setError(null);
    const fd = new FormData();
    fd.set("id", taskListId);
    fd.set("response", response.trim());
    startTransition(async () => {
      try {
        await resubmitWithResponse(fd);
        onClose();
        router.refresh();
      } catch (e: any) {
        setError(e?.message ?? "Could not re-submit.");
      }
    });
  }

  return (
    <ModalShell title="Reply & re-submit for validation" onClose={onClose}>
      {request && (
        <div className="mb-3">
          <RevisionRequestCard req={request} tone="sales" />
        </div>
      )}
      <label className="block">
        <span className="text-xs font-medium text-neutral-600">
          Sales response / correction summary *
        </span>
        <textarea
          autoFocus
          value={response}
          onChange={(e) => setResponse(e.target.value)}
          rows={4}
          placeholder="Summarize what you corrected or confirmed (e.g. battery, autonomy, sensor, optic, RAL…)."
          className="mt-1 w-full rounded border px-3 py-2 text-sm"
        />
      </label>
      {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}
      <ModalFooter
        onClose={onClose}
        pending={pending}
        confirmLabel="Reply & re-submit"
        pendingLabel="Submitting…"
        onConfirm={submit}
        disabled={!response.trim()}
      />
    </ModalShell>
  );
}

// =========================================================================
// ReleaseModal — "Release to Production?" confirmation + guards (E3).
// =========================================================================
function ReleaseModal({
  taskListId,
  clientName,
  taskNumber,
  missingMappingCount,
  revisionThread,
  onClose,
}: {
  taskListId: string;
  clientName: string | null;
  taskNumber: string | null;
  missingMappingCount: number;
  revisionThread?: RevisionThreadInfo;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const openRequest =
    !!revisionThread?.request && !revisionThread.request.resolved;
  const blocked = missingMappingCount > 0 || openRequest;

  function submit() {
    if (blocked) return;
    setError(null);
    const fd = new FormData();
    fd.set("id", taskListId);
    startTransition(async () => {
      try {
        await validateTaskList(fd);
        // validateTaskList redirect()s to the production order.
      } catch (e: any) {
        if (e?.digest && String(e.digest).startsWith("NEXT_REDIRECT")) throw e;
        setError(e?.message ?? "Could not release to production.");
      }
    });
  }

  const Row = ({ label, value }: { label: string; value: string }) => (
    <div className="flex justify-between gap-3 py-1 text-sm">
      <span className="text-neutral-500">{label}</span>
      <span className="font-medium text-neutral-800 text-right">{value}</span>
    </div>
  );

  return (
    <ModalShell title="Release to Production?" onClose={onClose}>
      <div className="divide-y divide-neutral-100">
        <Row label="Task list" value={taskNumber ?? taskListId.slice(0, 8)} />
        <Row label="Client" value={clientName ?? "—"} />
        <Row
          label="Factory mapping"
          value={
            missingMappingCount > 0
              ? `${missingMappingCount} missing`
              : "Complete"
          }
        />
        <Row
          label="Revision"
          value={openRequest ? "Open — awaiting Sales" : "None open"}
        />
      </div>

      {blocked ? (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {missingMappingCount > 0 && (
            <p>
              <b>Factory Mapping is incomplete.</b> Please complete all{" "}
              {missingMappingCount} required mapping
              {missingMappingCount === 1 ? "" : "s"} before releasing to
              production.
            </p>
          )}
          {openRequest && (
            <p className={missingMappingCount > 0 ? "mt-1" : ""}>
              A revision request is still open — wait for Sales to re-submit.
            </p>
          )}
        </div>
      ) : (
        <p className="mt-3 text-xs text-neutral-500">
          This creates the production order and starts the production phase.
        </p>
      )}
      {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}

      <ModalFooter
        onClose={onClose}
        pending={pending}
        confirmLabel="Release to Production"
        pendingLabel="Releasing…"
        onConfirm={submit}
        disabled={blocked}
      />
    </ModalShell>
  );
}

// =========================================================================
// Small shared modal chrome.
// =========================================================================
function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
        <h3 className="text-base font-semibold text-neutral-900">{title}</h3>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}

function ModalFooter({
  onClose,
  onConfirm,
  pending,
  confirmLabel,
  pendingLabel,
  disabled,
}: {
  onClose: () => void;
  onConfirm: () => void;
  pending: boolean;
  confirmLabel: string;
  pendingLabel: string;
  disabled?: boolean;
}) {
  return (
    <div className="mt-4 flex justify-end gap-2">
      <button
        type="button"
        onClick={onClose}
        disabled={pending}
        className="rounded-md border px-3 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onConfirm}
        disabled={pending || disabled}
        className="rounded-md bg-solux px-3 py-2 text-sm font-semibold text-white hover:bg-solux-dark disabled:opacity-50"
      >
        {pending ? pendingLabel : confirmLabel}
      </button>
    </div>
  );
}

// =========================================================================
// DirtySubmitModal — shown when the user tries to submit with unsaved changes.
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
