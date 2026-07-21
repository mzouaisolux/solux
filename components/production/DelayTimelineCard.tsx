/**
 * Delay Timeline — unified operational view (m075).
 *
 * What the operator needs to understand how this project's deadline evolved:
 *
 *   1. Add-event form (in-production only)
 *   2. Visual timeline of events (DelayEventRow)
 *   3. Mark-complete CTA (in-production only, when allowed)
 *
 * The data model is unchanged — additive delay events remain the source of
 * truth; this card is purely a visualization.
 *
 * Ops Dense (2026-07-16): the deadline cluster (baseline / due / actual) and
 * the +Nd factory-vs-external summary MOVED OUT to the owning
 * CollapsibleSection header in the order page, so this card no longer takes
 * those numbers at all — it is the form + the timeline.
 *
 * Phase-aware (drives which sub-blocks render):
 *   awaiting_start → no events yet, baseline pending
 *   in_production  → full controls (add + edit + delete + mark complete)
 *   completed      → read-only timeline with the locked completion summary
 *   closed         → read-only timeline + "closed" notice
 */

import { DelayEventForm } from "./DelayEventForm";
import { DelayEventRow } from "./DelayEventRow";
import { MarkProductionCompleteButton } from "@/components/MarkProductionCompleteButton";
import type { DelayType } from "@/lib/delays";

export type DelayTimelineEvent = {
  id: string;
  days_added: number | null;
  delay_type: DelayType | null;
  reason: string | null;
  previous_date: string | null;
  new_date: string;
  created_at: string;
  updated_at: string | null;
  changed_by: string | null;
  updated_by: string | null;
};

export type DelayTimelineLifecyclePhase =
  | "awaiting_start"
  | "in_production"
  | "completed"
  | "closed";

export type DelayTimelineCardProps = {
  orderId: string;
  productionDue: string | null;
  events: DelayTimelineEvent[];
  lifecyclePhase: DelayTimelineLifecyclePhase;
  /** Technical roles only — gates add / edit / delete buttons + mark complete. */
  canEditDeadline: boolean;
  canMarkComplete: boolean;
  /** Page resolves a uid → human label; we just call this for each row. */
  userLabel: (uid: string | null | undefined) => string;
};

export function DelayTimelineCard({
  orderId,
  productionDue,
  events,
  lifecyclePhase,
  canEditDeadline,
  canMarkComplete,
  userLabel,
}: DelayTimelineCardProps) {
  return (
    <div>
      {/* Header (+Nd, baseline/due/actual) lives in the CollapsibleSection. */}
      <div className="space-y-4">
        {canEditDeadline && lifecyclePhase === "in_production" && (
          <DelayEventForm orderId={orderId} productionDue={productionDue} />
        )}

        <div className="border-t border-neutral-100 pt-4">
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <div className="text-[11px] uppercase tracking-widerx text-neutral-500 font-semibold">
              Event timeline
            </div>
            <span className="text-[11px] text-neutral-400 tabular-nums">
              {events.length} event{events.length === 1 ? "" : "s"}
            </span>
          </div>

          {events.length === 0 ? (
            <EmptyTimeline phase={lifecyclePhase} />
          ) : (
            <ol className="relative border-l border-neutral-200 ml-2 space-y-4 py-1">
              {events.map((e) => (
                <DelayEventRow
                  key={e.id}
                  event={{
                    id: e.id,
                    days_added: e.days_added,
                    delay_type: e.delay_type,
                    reason: e.reason,
                    previous_date: e.previous_date,
                    new_date: e.new_date,
                    created_at: e.created_at,
                    updated_at: e.updated_at,
                  }}
                  actorLabel={userLabel(e.changed_by)}
                  editorLabel={e.updated_by ? userLabel(e.updated_by) : null}
                  editable={canEditDeadline && lifecyclePhase === "in_production"}
                />
              ))}
            </ol>
          )}
        </div>
      </div>

      {/* ─────────── FOOTER: mark complete CTA (in_production only) ─────────── */}
      {canMarkComplete && lifecyclePhase === "in_production" && (
        <div className="mt-3 pt-3 border-t border-neutral-100 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-neutral-500">
            {events.length} event{events.length === 1 ? "" : "s"} · once the
            factory is done, stamp actual completion.
          </p>
          <MarkProductionCompleteButton orderId={orderId} />
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── inner subcomponents ───────────────────────── */

function EmptyTimeline({
  phase,
}: {
  phase: DelayTimelineLifecyclePhase;
}) {
  const message =
    phase === "awaiting_start"
      ? "No delay events yet. The project will start tracking on its baseline once production activates."
      : phase === "completed"
      ? "Completed with zero delay events — the baseline held."
      : "No delays recorded. The project is running on its original baseline.";
  return (
    <div className="rounded-lg border border-dashed border-neutral-200 px-4 py-6 text-center">
      <div className="text-xs text-neutral-500 max-w-sm mx-auto">
        {message}
      </div>
    </div>
  );
}
