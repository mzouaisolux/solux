import { Fragment } from "react";
import {
  DOC_ALIVE_STATUSES,
  DOC_PIPELINE_STATUSES,
  DOC_TERMINAL_STATUSES,
  DOC_DEAD_STATUSES,
  TASK_LIST_ALIVE_STATUSES,
  TASK_LIST_PRODUCTION_STATUSES,
  TASK_LIST_DEAD_STATUSES,
  PO_ACTIVE_STATUSES,
  PO_SHIPPING_STATUSES,
  PO_TERMINAL_STATUSES,
  PO_DEAD_STATUSES,
  PO_CLOSED_SUCCESS_STATUSES,
} from "@/lib/lifecycle";

/**
 * Static lifecycle diagram for /admin/diagnostics.
 *
 * Renders the canonical state buckets for the three operational
 * entities (Document, Task list, Production order), reading them
 * directly from `lib/lifecycle.ts`. Because the rendering and the
 * runtime read from the same constants, this diagram cannot drift
 * from what the app actually enforces — change the const, the
 * diagram updates automatically.
 *
 * The flow is left-to-right, with each entity laid out as a small
 * pipeline: in-progress buckets first, then terminal-success in
 * green, then dead buckets in rose. Each status is shown as a small
 * chip so the super-admin can spot at a glance what statuses are
 * possible and where each value falls.
 *
 * NOT a directed graph — drawing edges between every state pair
 * would be visual noise. Super-admin can read the transition rules
 * in `supabase/migrations/023_lifecycle_propagation.sql` (linked
 * below) if they need the precise wire-up.
 */

type Bucket = {
  label: string;
  blurb: string;
  /** Tailwind color family for the bucket pill + chips. */
  tone: "blue" | "amber" | "emerald" | "rose" | "neutral";
  statuses: readonly string[];
};

type EntityFlow = {
  title: string;
  blurb: string;
  buckets: Bucket[];
};

const TONE: Record<
  Bucket["tone"],
  { bucket: string; chip: string; dot: string }
> = {
  blue: {
    bucket: "border-sky-200 bg-sky-50/60",
    chip: "border-sky-200 bg-white text-sky-800",
    dot: "bg-sky-500",
  },
  amber: {
    bucket: "border-amber-200 bg-amber-50/60",
    chip: "border-amber-200 bg-white text-amber-800",
    dot: "bg-amber-500",
  },
  emerald: {
    bucket: "border-emerald-200 bg-emerald-50/60",
    chip: "border-emerald-200 bg-white text-emerald-800",
    dot: "bg-emerald-500",
  },
  rose: {
    bucket: "border-rose-200 bg-rose-50/60",
    chip: "border-rose-200 bg-white text-rose-800",
    dot: "bg-rose-500",
  },
  neutral: {
    bucket: "border-neutral-200 bg-neutral-50/60",
    chip: "border-neutral-200 bg-white text-neutral-700",
    dot: "bg-neutral-400",
  },
};

const FLOWS: EntityFlow[] = [
  {
    title: "Document (quotation)",
    blurb:
      "Sales pipeline. The terminal statuses won/lost/cancelled stop the doc; cancelled/lost cascades to task lists + POs via the migration 023 trigger.",
    buckets: [
      {
        label: "Active",
        blurb: "Still selling. Will fold into KPIs as in-pipeline.",
        tone: "blue",
        // Use the alive list, but call out the pipeline subset visually
        // via the dedicated bucket below.
        statuses: DOC_ALIVE_STATUSES.filter((s) => s !== "won"),
      },
      {
        label: "Pipeline forecast",
        blurb: "Counted in pipeline value on the dashboard.",
        tone: "amber",
        statuses: DOC_PIPELINE_STATUSES,
      },
      {
        label: "Terminal · won",
        blurb: "Triggers task list creation downstream.",
        tone: "emerald",
        statuses: DOC_TERMINAL_STATUSES.filter((s) => s === "won"),
      },
      {
        label: "Dead",
        blurb: "Cascades cancellation to all linked task lists + POs.",
        tone: "rose",
        statuses: DOC_DEAD_STATUSES,
      },
    ],
  },
  {
    title: "Task list (production_task_lists)",
    blurb:
      "Validation handoff from sales to production. Reaching validated / production_ready should auto-create a production_order.",
    buckets: [
      {
        label: "Active",
        blurb: "Sales/production iteration in progress.",
        tone: "blue",
        statuses: TASK_LIST_ALIVE_STATUSES.filter(
          (s) => !TASK_LIST_PRODUCTION_STATUSES.includes(s)
        ),
      },
      {
        label: "Production-ready",
        blurb: "PO should exist. Drift here = orphan task list.",
        tone: "emerald",
        statuses: TASK_LIST_PRODUCTION_STATUSES,
      },
      {
        label: "Dead",
        blurb: "Cancelled — should cascade from the parent doc.",
        tone: "rose",
        statuses: TASK_LIST_DEAD_STATUSES,
      },
    ],
  },
  {
    title: "Production order",
    blurb:
      "Operational tracking of the factory cycle. Active statuses split into pre-shipment work vs in-flight shipment.",
    buckets: [
      {
        label: "Active · production",
        blurb: "Work on the factory floor.",
        tone: "amber",
        statuses: PO_ACTIVE_STATUSES,
      },
      {
        label: "Active · shipping",
        blurb: "Goods left the factory, in transit.",
        tone: "blue",
        statuses: PO_SHIPPING_STATUSES,
      },
      {
        label: "Terminal · delivered",
        blurb: "Closed successfully. Counts as completed revenue.",
        tone: "emerald",
        statuses: PO_CLOSED_SUCCESS_STATUSES,
      },
      {
        label: "Dead",
        blurb: "Cancelled. Order is closed unsuccessfully.",
        tone: "rose",
        statuses: PO_DEAD_STATUSES,
      },
      // PO_TERMINAL_STATUSES = PO_CLOSED_SUCCESS_STATUSES ∪ PO_DEAD_STATUSES,
      // so listing them separately above is enough — no all-up "Terminal" bucket needed.
    ],
  },
];

export function LifecycleSection() {
  return (
    <>
      <div className="sx-micro" style={{ margin: "22px 0 8px" }}>
        Lifecycle · canonical state machine
      </div>
      <p className="ad-lead" style={{ marginBottom: 10 }}>
        Read from <code>lib/lifecycle.ts</code> so the diagram always matches the code — legal statuses per
        entity, in order. Terminal states are greyed. Cancellation propagates downstream via the migration 023
        trigger: a doc marked <b>cancelled</b> or <b>lost</b> cancels every linked task list and production
        order in the same SQL statement.
      </p>
      <div className="card ad-sub-block">
        {FLOWS.map((flow, fi) => {
          const segs = flow.buckets.filter((b) => b.statuses.length > 0);
          return (
            <div key={flow.title}>
              <div className={`ad-lc-label${fi === 0 ? " first" : ""}`}>{flow.title}</div>
              <div className="ad-lifecycle">
                {segs.map((b, j) => {
                  const terminal = b.tone === "emerald" || b.tone === "rose";
                  return (
                    <Fragment key={b.label}>
                      {j > 0 && <span className="ad-lc-arrow">→</span>}
                      {b.statuses.map((s) => (
                        <span key={s} className={`ad-lc-node${terminal ? " terminal" : ""}`}>
                          {s}
                        </span>
                      ))}
                    </Fragment>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
