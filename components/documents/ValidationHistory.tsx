import type { EventRow } from "@/lib/events";

/**
 * ValidationHistory — a lightweight, timeline-oriented view of a task
 * list's factory-validation lifecycle. Filters the entity's events to
 * the validation transitions and renders them as a clean vertical
 * timeline (oldest → newest): Submitted by Sales → Reviewed → Factory
 * validated → Revised → Approved for production.
 *
 * Operational traceability, not bureaucracy. Pure presentation — reuses
 * the events + actor labels already loaded by the page.
 */

const VALIDATION_TYPES: Record<
  string,
  { label: string; tone: "info" | "success" | "warn" | "danger" | "neutral" }
> = {
  "tl.submitted_for_validation": {
    label: "Submitted for validation",
    tone: "info",
  },
  "tl.validated": { label: "Factory validated", tone: "success" },
  "tl.production_ready": { label: "Approved for production", tone: "success" },
  "tl.needs_revision": { label: "Sent back for revision", tone: "warn" },
  "tl.reopened": { label: "Reopened for revision", tone: "warn" },
  "tl.cancelled": { label: "Cancelled", tone: "danger" },
};

const DOT: Record<string, string> = {
  info: "ok",
  success: "ok",
  warn: "warn",
  danger: "danger",
  neutral: "",
};

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ValidationHistory({
  events,
  actorLabelByUser,
}: {
  events: EventRow[];
  actorLabelByUser?: Map<string, string>;
}) {
  // Keep only validation transitions, oldest → newest (the progression).
  const steps = events
    .filter((e) => e.event_type in VALIDATION_TYPES)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));

  return (
    <section className="panel p-4">
      <div className="sec-head">
        <div className="lhs">
          <h2>Validation history</h2>
          <div className="lead">
            Who moved this task list through the production-validation flow.
          </div>
        </div>
        <div className="rhs tnum">
          {steps.length} step{steps.length === 1 ? "" : "s"}
        </div>
      </div>

      {steps.length === 0 ? (
        <p className="text-xs text-neutral-400">
          Not yet submitted for validation. The history fills in as the task
          list moves through review → validation → production approval.
        </p>
      ) : (
        <div>
          {steps.map((e) => {
            const meta = VALIDATION_TYPES[e.event_type];
            const actor = e.actor_id
              ? actorLabelByUser?.get(e.actor_id) ??
                `user·${e.actor_id.slice(0, 6)}`
              : "system";
            return (
              <div key={e.id} className="vh-row">
                <div className="vh-left">
                  <span
                    className={`vh-dot ${DOT[meta.tone] ?? ""}`}
                    aria-hidden
                  />
                  <div>
                    <div className="vh-label">{meta.label}</div>
                    {e.payload?.reason && (
                      <div className="vh-reason">
                        “{String(e.payload.reason)}”
                      </div>
                    )}
                  </div>
                </div>
                <span className="vh-meta tnum">
                  {actor} · {formatWhen(e.created_at)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
