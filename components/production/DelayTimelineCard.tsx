/**
 * Delay Timeline — unified operational view (m075).
 *
 * One card that ties together everything the operator needs to understand
 * how this project's deadline evolved:
 *
 *   1. ETA cluster (initial / current / actual completion)
 *   2. Delay summary (factory vs external split)
 *   3. Add-event form (in-production only)
 *   4. Visual timeline of events (DelayEventRow)
 *   5. Mark-complete CTA (in-production only, when allowed)
 *
 * Replaces the old "Actual Production Deadline" + separate "Deadline
 * history" sections. The data model is unchanged — additive delay events
 * remain the source of truth; this card is purely a richer visualization.
 *
 * Phase-aware (drives the inline copy + which sub-blocks render):
 *   awaiting_start → no events yet, baseline pending
 *   in_production  → full controls (add + edit + delete + mark complete)
 *   completed      → read-only timeline with the locked completion summary
 *   closed         → read-only timeline + "closed" notice
 */

import { DelayEventForm } from "./DelayEventForm";
import { DelayEventRow } from "./DelayEventRow";
import { MarkProductionCompleteButton } from "@/components/MarkProductionCompleteButton";
import type { DelayType, DelayBreakdown } from "@/lib/delays";

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
  initialEta: string | null;
  currentEta: string | null;
  actualCompletion: string | null;
  breakdown: DelayBreakdown;
  events: DelayTimelineEvent[];
  lifecyclePhase: DelayTimelineLifecyclePhase;
  /** Technical roles only — gates add / edit / delete buttons + mark complete. */
  canEditDeadline: boolean;
  canMarkComplete: boolean;
  /** Page resolves a uid → human label; we just call this for each row. */
  userLabel: (uid: string | null | undefined) => string;
};

function fmtLongDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
}

export function DelayTimelineCard({
  orderId,
  initialEta,
  currentEta,
  actualCompletion,
  breakdown,
  events,
  lifecyclePhase,
  canEditDeadline,
  canMarkComplete,
  userLabel,
}: DelayTimelineCardProps) {
  const total = breakdown.factoryDays + breakdown.externalDays;
  const phaseCopy = {
    awaiting_start:
      "Production hasn't started yet — the live deadline activates once the deposit lands or production is started manually.",
    in_production:
      "Live tracking. Every event below adds or recovers days from the current ETA; only Production-tagged events count toward the factory KPI.",
    completed:
      "Production completed. The final delay below is locked against the baseline and will not change.",
    closed:
      "Operationally closed — no further deadline updates expected.",
  }[lifecyclePhase];

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
      {/* ─────────── HEADER: title + delay summary ─────────── */}
      <header className="px-5 pt-5 pb-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="eyebrow">Delay timeline</div>
            <p className="text-xs text-neutral-500 mt-0.5 max-w-xl">
              {phaseCopy}
            </p>
          </div>
          <TotalDelayChip
            total={total}
            factory={breakdown.factoryDays}
            external={breakdown.externalDays}
            latestType={breakdown.latestType}
          />
        </div>

        {/* ETA cluster */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
          <EtaCell
            label="Initial baseline"
            value={fmtLongDate(initialEta)}
            tone="muted"
          />
          <EtaCell
            label={lifecyclePhase === "completed" ? "Final deadline" : "Current ETA"}
            value={fmtLongDate(currentEta)}
            tone={
              lifecyclePhase === "completed"
                ? "muted"
                : breakdown.factoryDays > 0
                ? "rose"
                : breakdown.externalDays > 0
                ? "amber"
                : "neutral"
            }
          />
          <EtaCell
            label="Actual completion"
            value={fmtLongDate(actualCompletion)}
            tone={actualCompletion ? "emerald" : "muted"}
          />
        </div>
      </header>

      {/* ─────────── BODY: add form (when editable) + timeline ─────────── */}
      <div className="px-5 pb-5 space-y-5">
        {canEditDeadline && lifecyclePhase === "in_production" && (
          <DelayEventForm orderId={orderId} currentEta={currentEta} />
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
        <footer className="px-5 py-4 border-t border-neutral-100 bg-neutral-50/40 flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-widerx text-neutral-500 font-semibold">
              Completion
            </div>
            <p className="text-xs text-neutral-600 mt-0.5 max-w-md">
              Once the factory is done, stamp the actual completion date.
              The final delay vs. baseline is locked into the audit trail.
            </p>
          </div>
          <MarkProductionCompleteButton orderId={orderId} />
        </footer>
      )}
    </section>
  );
}

/* ───────────────────────── inner subcomponents ───────────────────────── */

function TotalDelayChip({
  total,
  factory,
  external,
  latestType,
}: {
  total: number;
  factory: number;
  external: number;
  latestType: DelayType | null;
}) {
  if (total === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 px-3 py-1 text-xs font-semibold">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
        On schedule
      </span>
    );
  }
  const factoryDominant = factory >= external;
  const headline = total > 0 ? `+${total}d` : `${total}d`;
  return (
    <div className="text-right">
      <div
        className={`text-2xl font-semibold tabular-nums ${
          total > 0 ? "text-rose-700" : "text-emerald-700"
        }`}
      >
        {headline}
      </div>
      <div className="text-[10px] uppercase tracking-widerx text-neutral-500 font-semibold mt-0.5">
        Total delay
      </div>
      <div className="flex items-center gap-2 justify-end mt-1 text-[11px]">
        <span
          className={`tabular-nums ${
            factory > 0 ? "text-rose-700 font-semibold" : "text-neutral-400"
          }`}
        >
          {factory > 0 ? `+${factory}d` : factory < 0 ? `${factory}d` : "0d"} factory
        </span>
        <span className="text-neutral-300">·</span>
        <span
          className={`tabular-nums ${
            external > 0
              ? "text-amber-700 font-semibold"
              : "text-neutral-400"
          }`}
        >
          {external > 0
            ? `+${external}d`
            : external < 0
            ? `${external}d`
            : "0d"}{" "}
          external
        </span>
      </div>
    </div>
  );
}

function EtaCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "neutral" | "muted" | "rose" | "amber" | "emerald";
}) {
  const cls: Record<typeof tone, string> = {
    neutral: "text-neutral-900",
    muted: "text-neutral-500",
    rose: "text-rose-800",
    amber: "text-amber-800",
    emerald: "text-emerald-700",
  };
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-widerx text-neutral-500 font-semibold">
        {label}
      </div>
      <div className={`text-sm font-semibold tabular-nums mt-1 ${cls[tone]}`}>
        {value}
      </div>
    </div>
  );
}

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
