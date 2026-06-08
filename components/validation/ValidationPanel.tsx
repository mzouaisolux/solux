import {
  VALIDATION_LABEL,
  VALIDATION_HELP,
  VALIDATION_BADGE,
  VALIDATION_DOT,
  type ValidationStatus,
} from "@/lib/validation";
import {
  requestValidation,
  reviewValidation,
  cancelValidationRequest,
} from "@/app/(app)/documents/[id]/actions";

/**
 * Advisory validation panel (m068) — mounted on the quotation detail page.
 *
 * Light, manual loop. Sales clicks "Request validation" to flag a quote for
 * a manager's eyes; a manager (technical role) Approves or Requests changes
 * with a note. Nothing here blocks sending or winning the quote — it's a
 * review flag + a visible trail. All wording lives in lib/validation.ts.
 *
 * Role is resolved by the page:
 *   - canReview  → technical/management (sees Approve / Request changes)
 *   - canRequest → sales (sees Request validation / Withdraw / Re-request)
 */
export function ValidationPanel({
  docId,
  status,
  requestedByName,
  requestedAt,
  note,
  reviewedByName,
  reviewedAt,
  reviewNote,
  canReview,
  canRequest,
}: {
  docId: string;
  status: ValidationStatus | null;
  requestedByName: string | null;
  requestedAt: string | null;
  note: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  canReview: boolean;
  canRequest: boolean;
}) {
  const textarea =
    "w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm focus:border-solux focus:outline-none focus:ring-1 focus:ring-solux/40";

  return (
    <section className="rounded-xl border border-neutral-200/80 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-widerx text-neutral-500">
            Validation
          </div>
          <p className="text-[11px] text-neutral-400 mt-0.5">
            Optional second opinion — never blocks sending.
          </p>
        </div>
        {status && (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${VALIDATION_BADGE[status]}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${VALIDATION_DOT[status]}`} />
            {VALIDATION_LABEL[status]}
          </span>
        )}
      </div>

      {/* Current state context (who / when / notes). */}
      {status && (
        <div className="rounded-md bg-neutral-50 border border-neutral-100 px-3 py-2 space-y-1.5">
          <p className="text-[12px] text-neutral-600">{VALIDATION_HELP[status]}</p>
          {(requestedByName || requestedAt) && (
            <p className="text-[11px] text-neutral-500">
              Requested by{" "}
              <b className="text-neutral-700">{requestedByName ?? "—"}</b>
              {requestedAt ? ` · ${fmtDateTime(requestedAt)}` : ""}
            </p>
          )}
          {note && (
            <p className="text-[12px] text-neutral-700">
              <span className="text-neutral-400">Note: </span>“{note}”
            </p>
          )}
          {(status === "approved" || status === "rejected") &&
            (reviewedByName || reviewNote) && (
              <div className="mt-1 border-t border-neutral-200/70 pt-1.5">
                <p className="text-[11px] text-neutral-500">
                  {status === "approved" ? "Approved" : "Reviewed"} by{" "}
                  <b className="text-neutral-700">{reviewedByName ?? "—"}</b>
                  {reviewedAt ? ` · ${fmtDateTime(reviewedAt)}` : ""}
                </p>
                {reviewNote && (
                  <p className="text-[12px] text-neutral-700">
                    <span className="text-neutral-400">Manager note: </span>“
                    {reviewNote}”
                  </p>
                )}
              </div>
            )}
        </div>
      )}

      {/* Manager review controls — only when something is pending. */}
      {canReview && status === "pending" && (
        <form action={reviewValidation} className="space-y-2">
          <input type="hidden" name="id" value={docId} />
          <textarea
            name="review_note"
            rows={2}
            placeholder="Optional note for the salesperson…"
            className={textarea}
          />
          <div className="flex flex-wrap gap-2">
            <button
              name="decision"
              value="approved"
              className="rounded-md bg-emerald-600 text-white px-3 py-1.5 text-xs font-medium hover:bg-emerald-700"
            >
              ✓ Approve
            </button>
            <button
              name="decision"
              value="rejected"
              className="rounded-md border border-amber-300 bg-amber-50 text-amber-900 px-3 py-1.5 text-xs font-medium hover:bg-amber-100"
            >
              Request changes
            </button>
          </div>
        </form>
      )}

      {/* Requester: ask for validation (none yet, or re-ask after a review). */}
      {canRequest && status !== "pending" && (
        <form action={requestValidation} className="space-y-2">
          <input type="hidden" name="id" value={docId} />
          <textarea
            name="note"
            rows={2}
            placeholder={
              status
                ? "Add a note and request validation again…"
                : "Why does this need a second opinion? (optional)"
            }
            className={textarea}
          />
          <button className="rounded-md bg-neutral-900 text-white px-3 py-1.5 text-xs font-medium hover:bg-neutral-800">
            {status ? "Request validation again" : "Request validation"}
          </button>
        </form>
      )}

      {/* Requester: withdraw a pending request. */}
      {canRequest && status === "pending" && (
        <form action={cancelValidationRequest}>
          <input type="hidden" name="id" value={docId} />
          <button className="text-[11px] text-neutral-400 hover:text-rose-600">
            Withdraw request
          </button>
        </form>
      )}

      {/* Manager looking at a quote with no request — gentle hint. */}
      {canReview && !canRequest && !status && (
        <p className="text-[12px] text-neutral-400">
          No validation has been requested on this quotation.
        </p>
      )}
    </section>
  );
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
