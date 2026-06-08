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
  info: "bg-sky-500",
  success: "bg-emerald-500",
  warn: "bg-amber-500",
  danger: "bg-rose-500",
  neutral: "bg-neutral-300",
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
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <div>
          <div className="eyebrow">Validation history</div>
          <p className="text-[11px] text-neutral-500 mt-0.5">
            Who moved this task list through the production-validation flow.
          </p>
        </div>
        <span className="text-[11px] text-neutral-400 tabular-nums">
          {steps.length} step{steps.length === 1 ? "" : "s"}
        </span>
      </div>

      {steps.length === 0 ? (
        <p className="text-xs text-neutral-400">
          Not yet submitted for validation. The history fills in as the task
          list moves through review → validation → production approval.
        </p>
      ) : (
        <ol className="relative border-l border-neutral-200 ml-1.5 space-y-3">
          {steps.map((e) => {
            const meta = VALIDATION_TYPES[e.event_type];
            const actor = e.actor_id
              ? actorLabelByUser?.get(e.actor_id) ??
                `user·${e.actor_id.slice(0, 6)}`
              : "system";
            return (
              <li key={e.id} className="pl-4 relative">
                <span
                  className={`absolute -left-[5px] top-1.5 h-2 w-2 rounded-full ring-2 ring-white ${
                    DOT[meta.tone] ?? DOT.neutral
                  }`}
                  aria-hidden
                />
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <span className="text-xs font-semibold text-neutral-900">
                    {meta.label}
                  </span>
                  <span className="text-[11px] text-neutral-400 tabular-nums whitespace-nowrap">
                    {actor} · {formatWhen(e.created_at)}
                  </span>
                </div>
                {e.payload?.reason && (
                  <p className="text-[11px] text-neutral-500 italic mt-0.5">
                    “{String(e.payload.reason)}”
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
