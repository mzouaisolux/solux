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
    <section className="panel p-5 space-y-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <div className="eyebrow">Lifecycle · canonical state machine</div>
          <h2 className="text-base font-semibold text-neutral-900 mt-0.5">
            Doc → Task list → Production order
          </h2>
        </div>
        <a
          href="https://github.com/your-repo"
          className="text-[11px] text-neutral-400 italic select-none"
          aria-hidden
        >
          {/* Intentional non-link — keeps a balanced header without
              adding a destination we don't control. */}
          read from lib/lifecycle.ts
        </a>
      </div>

      <p className="text-xs text-neutral-500 max-w-3xl">
        Buckets reflect what the runtime enforces. Cancellation
        propagates downstream via the migration 023 trigger: a doc
        marked <b>cancelled</b> or <b>lost</b> cancels every linked
        task list and production order in the same SQL statement.
      </p>

      <div className="space-y-4">
        {FLOWS.map((flow) => (
          <article
            key={flow.title}
            className="rounded-lg border border-neutral-200 bg-white p-4 space-y-3"
          >
            <header>
              <h3 className="text-sm font-semibold text-neutral-900">
                {flow.title}
              </h3>
              <p className="text-[11px] text-neutral-500 mt-0.5">
                {flow.blurb}
              </p>
            </header>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              {flow.buckets.map((bucket) => {
                const tone = TONE[bucket.tone];
                return (
                  <div
                    key={bucket.label}
                    className={`rounded-md border px-3 py-2 ${tone.bucket}`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`inline-block w-1.5 h-1.5 rounded-full ${tone.dot}`}
                        aria-hidden
                      />
                      <span className="text-[11px] font-semibold uppercase tracking-widerx text-neutral-700">
                        {bucket.label}
                      </span>
                    </div>
                    <p className="text-[10px] text-neutral-500 mt-0.5">
                      {bucket.blurb}
                    </p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {bucket.statuses.length === 0 ? (
                        <span className="text-[10px] text-neutral-400 italic">
                          (none)
                        </span>
                      ) : (
                        bucket.statuses.map((s) => (
                          <span
                            key={s}
                            className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-mono ${tone.chip}`}
                          >
                            {s}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </article>
        ))}
      </div>

      <p className="text-[10px] text-neutral-400 italic">
        Source: <code>lib/lifecycle.ts</code>. Transition rules:{" "}
        <code>supabase/migrations/023_lifecycle_propagation.sql</code>.
      </p>
    </section>
  );
}
