"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { RevisionsPanel } from "@/components/RevisionsPanel";
import type {
  RevisionFieldChange,
  TaskListRevision,
} from "@/lib/task-list-revisions";

/**
 * REVISION — first-class in the rail (Ops Dense).
 *
 * The lineage used to be buried in the Activity tab, seventh of seven, so the
 * page only ever showed "Rev D" as a label: how many revisions existed, when
 * they were opened and what changed were all one tab away. The reference makes
 * this a rail card that opens a full history overlay (`revModal`).
 *
 * This component adds NO revision logic. It renders a summary and, in the
 * overlay, the existing RevisionsPanel untouched — so `openControlledRevision`
 * stays the one and only way to open a revision, with the same capability gate
 * and the same mandatory reason.
 */

const CHIP: Record<string, string> = {
  in_progress: "rev-chip ink",
  validated: "rev-chip green",
  superseded: "rev-chip grey",
};

function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

export function RevisionRailCard({
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
  diff: RevisionFieldChange[];
  diffLabel: string | null;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  // The overlay is portalled to <body>: rendered in place it lives inside the
  // sticky rail, and the sticky command bar / KPI strip / tab bar (their own
  // stacking contexts) painted straight over it.
  useEffect(() => setMounted(true), []);

  // Escape closes, and the page must not scroll behind the overlay.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const inProgress = revisions.find((r) => r.status === "in_progress");
  const validated = revisions.filter((r) => r.status !== "in_progress");
  const latest = inProgress ?? validated[0] ?? null;
  const count = revisions.length;

  return (
    <>
      <section className="ops-card rev-card" data-testid="revision-rail-card">
        <div className="ops-card-h">
          <span>Revision</span>
          <span>{currentRev ? `Rev ${currentRev}` : "—"}</span>
        </div>
        <div className="ops-card-b">
          {latest && (
            <div className="rev-now">
              <span className={CHIP[latest.status] ?? CHIP.superseded}>
                {latest.status === "in_progress" ? "in progress" : latest.status}
              </span>
              <span className="rev-date">
                {latest.status === "in_progress"
                  ? `opened ${shortDate(latest.created_at)}`
                  : `validated ${shortDate(latest.validated_at)}`}
              </span>
            </div>
          )}

          <div className="nx-meta" style={{ marginTop: latest ? 8 : 0 }}>
            {frozen
              ? "This version is frozen. Any change requires a controlled revision, which re-runs the full Pre-Validation cycle."
              : "Editable — the next Final Validation will freeze this revision."}
          </div>

          {count > 0 ? (
            <>
              {/* The last few, newest first — enough to see the lineage exists
                  without turning the rail into a table. */}
              <ul className="rev-mini">
                {revisions.slice(0, 3).map((r) => (
                  <li key={r.id} className={r.rev === currentRev ? "is-current" : ""}>
                    <b>Rev {r.rev}</b>
                    <span className={CHIP[r.status] ?? CHIP.superseded}>
                      {r.status === "in_progress" ? "in progress" : r.status}
                    </span>
                    <span className="d">
                      {r.status === "in_progress"
                        ? shortDate(r.created_at)
                        : shortDate(r.validated_at)}
                    </span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="rev-open"
                onClick={() => setOpen(true)}
                data-testid="open-revision-history"
              >
                Full history &amp; changes ({count}) →
              </button>
            </>
          ) : (
            <button
              type="button"
              className="rev-open"
              onClick={() => setOpen(true)}
              data-testid="open-revision-history"
            >
              Revision history →
            </button>
          )}
        </div>
      </section>

      {open && mounted && createPortal(
        /* `tl-detail ops` keeps the page's scoped CSS applying to the portalled
           node; `tl-portal` is display:contents, so the wrapper itself adds no
           box of its own. */
        <div className="tl-detail ops tl-portal">
        <div
          className="rev-modal-scrim"
          role="presentation"
          onClick={() => setOpen(false)}
        >
          <div
            className="rev-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Revision history"
            data-testid="revision-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="rev-modal-h">
              <div>
                <span className="micro">Revision history</span>
                <b>
                  {count} revision{count === 1 ? "" : "s"}
                  {currentRev ? ` · current Rev ${currentRev}` : ""}
                </b>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rev-modal-x"
                aria-label="Close revision history"
                data-testid="close-revision-history"
              >
                ✕
              </button>
            </div>
            <div className="rev-modal-b">
              {/* The existing panel, unchanged: lineage, reasons, authors,
                  the field-level diff and the controlled-revision form. */}
              <RevisionsPanel
                taskListId={taskListId}
                frozen={frozen}
                currentRev={currentRev}
                revisions={revisions}
                diff={diff}
                diffLabel={diffLabel}
                canManage={canManage}
              />
            </div>
          </div>
        </div>
        </div>,
        document.body
      )}
    </>
  );
}
