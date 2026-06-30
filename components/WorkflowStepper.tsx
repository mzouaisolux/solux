import Link from "next/link";

/**
 * End-to-end lifecycle visualizer:
 *
 *   Quotation → Won → Task list → Validated → Production → Shipped → Delivered
 *
 * Each stage carries:
 *  - label  (e.g. "Won")
 *  - sub    (small caption like "Mark won to confirm")
 *  - state  (done | current | pending | skipped — drives color)
 *  - href   (optional jump-to target)
 *
 * Callers compute the stages from the actual quotation / task list /
 * production order state and pass them in. This component is purely
 * presentational, so it can be reused on document detail, task list
 * detail, and production order detail without leaking domain logic.
 */
export type WorkflowStage = {
  key: string;
  label: string;
  sub?: string;
  state: "done" | "current" | "pending" | "skipped";
  href?: string;
};

export default function WorkflowStepper({
  stages,
  compact = false,
  premium = false,
}: {
  stages: WorkflowStage[];
  compact?: boolean;
  /** Opt-in Premium skin (Production Order page). Default keeps the legacy
   *  look used on document / task-list detail — byte-identical. */
  premium?: boolean;
}) {
  return (
    <div className={`flex items-stretch gap-0 w-full overflow-x-auto`}>
      {stages.map((stage, i) => {
        const isLast = i === stages.length - 1;
        const next = stages[i + 1];
        // Connector tone reflects "have we passed this point?". Solid black
        // up to the current stage, soft gray after.
        const connectorPassed =
          stage.state === "done" ||
          (stage.state === "current" && next && next.state !== "pending");

        const dotClass = premium
          ? `po-step-dot ${
              stage.state === "current"
                ? "po-step-dot--current"
                : stage.state === "done"
                ? "po-step-dot--done"
                : "po-step-dot--todo"
            }`
          : `inline-flex h-3 w-3 rounded-full transition-all ${
              stage.state === "current"
                ? "bg-solux ring-4 ring-solux/20"
                : stage.state === "done"
                ? "bg-neutral-900"
                : stage.state === "skipped"
                ? "bg-neutral-200 border border-neutral-300"
                : "bg-white border border-neutral-300"
            }`;

        const nameClass = premium
          ? `po-step-name block ${
              stage.state === "current" || stage.state === "done"
                ? "text-[color:var(--ink)]"
                : "text-[color:var(--mute)]"
            } ${stage.state === "skipped" ? "line-through" : ""}`
          : `block text-[11px] font-semibold uppercase tracking-widerx ${
              stage.state === "current"
                ? "text-neutral-900"
                : stage.state === "done"
                ? "text-neutral-700"
                : stage.state === "skipped"
                ? "text-neutral-400 line-through"
                : "text-neutral-400"
            }`;

        const subClass = premium
          ? `block text-[10px] mt-0.5 ${
              stage.state === "current"
                ? "text-[color:var(--green-deep)] font-semibold"
                : "text-[color:var(--mute)]"
            }`
          : `block text-[10px] mt-0.5 ${
              stage.state === "current" ? "text-neutral-700" : "text-neutral-400"
            }`;

        const connClass = premium
          ? `flex-1 mx-1 po-step-conn ${
              connectorPassed ? "po-step-conn--done" : "po-step-conn--todo"
            }`
          : `flex-1 h-[2px] mx-1 ${
              connectorPassed ? "bg-neutral-900" : "bg-neutral-200"
            }`;

        const inner = (
          <div
            className={`flex items-center gap-2 ${
              compact ? "py-1" : "py-2"
            } px-2 rounded-md transition-colors ${
              stage.href
                ? premium
                  ? "hover:bg-[color:var(--canvas)]"
                  : "hover:bg-neutral-100/70"
                : ""
            }`}
          >
            <span className="relative flex items-center justify-center">
              <span className={dotClass} />
            </span>
            <span
              className={`text-left ${
                compact ? "leading-tight" : "leading-snug"
              }`}
            >
              <span className={nameClass}>{stage.label}</span>
              {stage.sub && !compact && (
                <span className={subClass}>{stage.sub}</span>
              )}
            </span>
          </div>
        );
        return (
          <div
            key={stage.key}
            className={`flex items-center ${isLast ? "" : "flex-1 min-w-0"}`}
          >
            {stage.href ? (
              <Link href={stage.href} className="block">
                {inner}
              </Link>
            ) : (
              inner
            )}
            {!isLast && <div className={connClass} />}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Domain helper — derive the canonical 7-stage workflow from real data.
// ---------------------------------------------------------------------------

export function buildLifecycleStages(args: {
  quotationStatus: string | null;
  quotationId: string;
  hasTaskList: boolean;
  taskListStatus: string | null;
  taskListId: string | null;
  productionOrderStatus: string | null;
  productionOrderId: string | null;
}): WorkflowStage[] {
  const {
    quotationStatus,
    quotationId,
    hasTaskList,
    taskListStatus,
    taskListId,
    productionOrderStatus,
    productionOrderId,
  } = args;

  // ---- Stage states ----
  // A draft isn't "in play" yet — the lifecycle only begins once the
  // quotation is sent. So only sent/negotiating count as active here.
  const quotationActive = ["sent", "negotiating"].includes(
    quotationStatus ?? ""
  );
  const isDraft = quotationStatus === "draft";
  const quotationWon = quotationStatus === "won";
  const quotationDead =
    quotationStatus === "lost" || quotationStatus === "cancelled";

  const taskListValidated = ["validated", "production_ready"].includes(
    taskListStatus ?? ""
  );
  const taskListInFlight = [
    "draft",
    "under_validation",
    "needs_revision",
  ].includes(taskListStatus ?? "");

  const productionActive = [
    "deposit_received",
    "production_scheduled",
    "in_production",
    "production_delayed",
  ].includes(productionOrderStatus ?? "");
  const productionDone = [
    "production_completed",
    "shipment_booked",
    "shipped",
    "delivered",
  ].includes(productionOrderStatus ?? "");

  const shipmentInFlight = [
    "shipment_booked",
    "shipped",
  ].includes(productionOrderStatus ?? "");
  const delivered = productionOrderStatus === "delivered";

  // ---- Build the 7-stage list with derived states ----
  const stages: WorkflowStage[] = [];

  // 1. Quotation
  stages.push({
    key: "quotation",
    label: "Quotation",
    sub:
      // #13 — once the deal has advanced (won / task list / production order)
      // the document here is the INTERNAL proforma; never show "Draft — not
      // sent" on a live order. Only a genuine, un-advanced quote reads "Draft".
      quotationWon || hasTaskList || productionOrderId
        ? "Drafted"
        : quotationActive
        ? "Sent / negotiating"
        : isDraft
        ? "Draft — not sent"
        : "Started",
    state:
      quotationWon || hasTaskList || productionOrderId
        ? "done"
        : quotationActive
        ? "current"
        : quotationDead
        ? "skipped"
        : "current",
    href: `/documents/${quotationId}`,
  });

  // 2. Won
  stages.push({
    key: "won",
    label: "Won",
    sub:
      // #13 — a live task list / production order means the deal IS won, even
      // though the internal proforma's own status is still "draft". Don't ask
      // to "Mark won" on something already in production.
      quotationStatus === "won" || hasTaskList || productionOrderId
        ? "Confirmed"
        : quotationDead
        ? "Did not close"
        : "Mark won to confirm",
    state: quotationWon || hasTaskList || productionOrderId
      ? "done"
      : quotationDead
      ? "skipped"
      : "pending",
    href: `/documents/${quotationId}`,
  });

  // 3. Task list
  stages.push({
    key: "task_list",
    label: "Task list",
    sub: hasTaskList
      ? taskListValidated
        ? "Validated"
        : taskListInFlight
        ? "In review"
        : "Drafted"
      : "Generate after Won",
    state:
      taskListValidated || productionOrderId
        ? "done"
        : hasTaskList
        ? "current"
        : "pending",
    href: taskListId ? `/task-lists/${taskListId}` : undefined,
  });

  // 4. Validated (the task list reached production_ready / validated)
  stages.push({
    key: "validated",
    label: "Validated",
    sub: productionOrderId
      ? "Production order created"
      : taskListInFlight
      ? "Waiting on production team"
      : taskListValidated
      ? "Ready for production"
      : "Pending technical review",
    state: productionOrderId
      ? "done"
      : taskListValidated
      ? "current"
      : "pending",
    href: taskListId ? `/task-lists/${taskListId}` : undefined,
  });

  // 5. Production (operational tracking — the production order's state)
  stages.push({
    key: "production",
    label: "Production",
    sub: productionDone
      ? "Complete"
      : productionActive
      ? "Running"
      : productionOrderStatus === "awaiting_deposit"
      ? "Awaiting deposit"
      : productionOrderId
      ? "Scheduled"
      : "Not yet started",
    state: productionDone
      ? "done"
      : productionActive || productionOrderStatus === "awaiting_deposit"
      ? "current"
      : "pending",
    href: productionOrderId
      ? `/production/orders/${productionOrderId}`
      : undefined,
  });

  // 6. Shipped
  stages.push({
    key: "shipped",
    label: "Shipped",
    sub: delivered
      ? "Departed"
      : productionOrderStatus === "shipped"
      ? "In transit"
      : shipmentInFlight
      ? "Booked"
      : "Awaiting production",
    state: delivered
      ? "done"
      : productionOrderStatus === "shipped"
      ? "current"
      : shipmentInFlight
      ? "current"
      : "pending",
    href: productionOrderId
      ? `/production/orders/${productionOrderId}`
      : undefined,
  });

  // 7. Delivered
  stages.push({
    key: "delivered",
    label: "Delivered",
    sub: delivered ? "Installed" : "Final destination",
    state: delivered ? "done" : "pending",
    href: productionOrderId
      ? `/production/orders/${productionOrderId}`
      : undefined,
  });

  return stages;
}
