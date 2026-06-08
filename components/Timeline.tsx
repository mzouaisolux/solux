import {
  SEVERITY_DOT,
  SEVERITY_PILL,
  SEVERITY_LABEL,
  eventTypeLabel,
  type EventRow,
} from "@/lib/events";

/**
 * Operational timeline — renders an audit-log feed for a single entity.
 *
 * Drop this onto any entity detail page (production order, task list,
 * client workspace, etc.) to show "what changed, who, when, why" in a
 * scannable vertical timeline. Reads from the `events` table via the
 * `listEventsForEntity` helper — but rendering is decoupled from data
 * loading, so this component is pure presentation.
 *
 * Designed to coexist with entity-specific history panels (e.g. the
 * production_deadline_changes panel on PO detail). Where those panels
 * give surgical detail for one type of change, this gives the cross-
 * cutting view across every change.
 */
export function Timeline({
  events,
  actorLabelByUser,
  emptyMessage = "No activity recorded yet.",
}: {
  events: EventRow[];
  /** Map auth.users.id → short label ("admin · a1b2c3d4"). Built by the
   *  server component and passed in so this stays client-safe. */
  actorLabelByUser?: Map<string, string>;
  emptyMessage?: string;
}) {
  if (events.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50/50 px-4 py-8 text-center">
        <p className="text-sm text-neutral-500">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <ol className="relative border-l border-neutral-200 ml-2 space-y-3">
      {events.map((e) => {
        const dotClass = SEVERITY_DOT[e.severity] ?? "bg-neutral-300";
        const pillClass = SEVERITY_PILL[e.severity] ?? SEVERITY_PILL.low;
        const actor = e.actor_id
          ? actorLabelByUser?.get(e.actor_id) ??
            `user·${e.actor_id.slice(0, 6)}`
          : "system";
        return (
          <li key={e.id} className="pl-4 relative">
            <span
              className={`absolute -left-[5px] top-1.5 h-2 w-2 rounded-full ring-2 ring-white ${dotClass}`}
              aria-hidden
            />
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] font-semibold text-neutral-900">
                    {eventTypeLabel(e.event_type as any)}
                  </span>
                  {e.severity !== "low" && (
                    <span
                      className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${pillClass}`}
                    >
                      {SEVERITY_LABEL[e.severity]}
                    </span>
                  )}
                </div>
                <p className="text-xs text-neutral-700 mt-0.5 leading-snug">
                  {e.message}
                </p>
                {/* Payload preview — show structured before/after when
                    we have it, so the user doesn't have to parse the
                    message string. */}
                {(e.payload?.from !== undefined &&
                  e.payload?.to !== undefined &&
                  e.event_type !== "po.deposit_received" &&
                  e.event_type !== "po.balance_received" &&
                  e.event_type !== "po.status_changed") && (
                  <div className="text-[11px] text-neutral-500 mt-1 tabular-nums">
                    <span className="text-neutral-400 line-through">
                      {fmtVal(e.payload.from)}
                    </span>{" "}
                    →{" "}
                    <span className="text-neutral-900 font-medium">
                      {fmtVal(e.payload.to)}
                    </span>
                  </div>
                )}
                {e.payload?.reason && (
                  <p className="text-[11px] text-neutral-500 mt-1 italic">
                    “{e.payload.reason}”
                  </p>
                )}
              </div>
              <div className="text-[11px] text-neutral-400 tabular-nums whitespace-nowrap">
                <span className="font-mono">{actor}</span>
                <span className="mx-1">·</span>
                {formatRelativeOrDate(e.created_at)}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function fmtVal(v: any): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return v.toLocaleString();
  return String(v);
}

function formatRelativeOrDate(iso: string): string {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
