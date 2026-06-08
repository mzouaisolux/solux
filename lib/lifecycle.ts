/**
 * Canonical operational lifecycle definitions.
 *
 * Three entities (quotation/document, task_list, production_order) each
 * have their own status enum. Historically these were treated as
 * independent — a doc could be `cancelled` while its task list was
 * `validated` and its production_order `in_production`. Migration 023
 * now propagates cancellations at the DB layer via triggers.
 *
 * This module is the TS-side counterpart: a single canonical place
 * where every component can ask:
 *   - "is this entity active?"
 *   - "is this entity cancelled?"
 *   - "is this entity archived?"
 *   - "is this entity terminal (no more work expected)?"
 *
 * Why a separate file:
 *   - `lib/types.ts` defines the raw status enums + DB shape. Keep it
 *     pure data.
 *   - `lib/lifecycle.ts` (this file) is the *semantic* layer: how the
 *     app interprets those statuses.
 *
 * If you find yourself writing `status === "cancelled"` inline in a
 * server action or page, please reach for the helpers here instead.
 * Concentrating the predicates here lets us refactor terminal-status
 * semantics in one place (e.g. if we ever add a "paused" status).
 */

import type {
  DocStatus,
  ProductionTaskListStatus,
  ProductionOrderStatus,
} from "@/lib/types";

/* ===========================================================================
   ARCHIVED — soft delete model
   =========================================================================== */

/**
 * Shape of any entity that carries the archived_at convention. Use
 * structural typing instead of forcing the caller to pick a specific
 * entity type — works for documents, production_task_lists, and
 * production_orders alike (migration 024).
 */
export type Archivable = { archived_at?: string | null };

/** True when the row has been soft-archived (hidden from default lists). */
export function isArchived(row: Archivable | null | undefined): boolean {
  return !!row?.archived_at;
}

/* ===========================================================================
   DOCUMENT (quotation) lifecycle
   =========================================================================== */

/**
 * Terminal document statuses — no further sales work is expected.
 *
 * Note: `lost` is included because once a deal is marked lost, the
 * downstream production work should also be considered dead. Migration
 * 023's trigger cascades lost → cancelled on the task list + PO.
 */
export const DOC_TERMINAL_STATUSES: DocStatus[] = ["won", "lost", "cancelled"];

/** Statuses where the deal is dead and shouldn't count in active KPIs. */
export const DOC_DEAD_STATUSES: DocStatus[] = ["lost", "cancelled"];

/** Statuses where the deal is still alive (in pipeline). */
export const DOC_ALIVE_STATUSES: DocStatus[] = [
  "draft",
  "sent",
  "negotiating",
  "won",
];

/** Statuses that should count as "in pipeline" on the dashboard. */
export const DOC_PIPELINE_STATUSES: DocStatus[] = [
  "sent",
  "negotiating",
];

export function isDocCancelled(status: DocStatus | null | undefined): boolean {
  return status === "cancelled" || status === "lost";
}

export function isDocActive(
  status: DocStatus | null | undefined,
  archived: Archivable | null | undefined = null
): boolean {
  if (!status) return false;
  if (isDocCancelled(status)) return false;
  if (archived && isArchived(archived)) return false;
  return true;
}

/* ===========================================================================
   TASK LIST lifecycle
   =========================================================================== */

/** Statuses where the task list is dead. */
export const TASK_LIST_DEAD_STATUSES: ProductionTaskListStatus[] = ["cancelled"];

/** Statuses where the task list is in active production-flow. */
export const TASK_LIST_ALIVE_STATUSES: ProductionTaskListStatus[] = [
  "draft",
  "under_validation",
  "needs_revision",
  "validated",
  "production_ready",
];

/** Statuses where production tracking applies (PO should exist). */
export const TASK_LIST_PRODUCTION_STATUSES: ProductionTaskListStatus[] = [
  "validated",
  "production_ready",
];

export function isTaskListCancelled(
  status: ProductionTaskListStatus | null | undefined
): boolean {
  return status === "cancelled";
}

export function isTaskListActive(
  status: ProductionTaskListStatus | null | undefined,
  archived: Archivable | null | undefined = null
): boolean {
  if (!status) return false;
  if (isTaskListCancelled(status)) return false;
  if (archived && isArchived(archived)) return false;
  return true;
}

/* ===========================================================================
   PRODUCTION ORDER lifecycle
   =========================================================================== */

/** Terminal — operationally closed, will not change. */
export const PO_TERMINAL_STATUSES: ProductionOrderStatus[] = [
  "delivered",
  "cancelled",
];

/** Dead — counts as "killed". */
export const PO_DEAD_STATUSES: ProductionOrderStatus[] = ["cancelled"];

/** Closed successfully — should count as revenue / completed. */
export const PO_CLOSED_SUCCESS_STATUSES: ProductionOrderStatus[] = ["delivered"];

/** Where production work is happening right now. */
export const PO_ACTIVE_STATUSES: ProductionOrderStatus[] = [
  "awaiting_deposit",
  "deposit_received",
  "production_scheduled",
  "in_production",
  "production_delayed",
];

/** After production, before delivered — shipment in flight. */
export const PO_SHIPPING_STATUSES: ProductionOrderStatus[] = [
  "production_completed",
  "shipment_booked",
  "shipped",
];

export function isPOCancelled(
  status: ProductionOrderStatus | null | undefined
): boolean {
  return status === "cancelled";
}

export function isPOTerminal(
  status: ProductionOrderStatus | null | undefined
): boolean {
  if (!status) return false;
  return PO_TERMINAL_STATUSES.includes(status);
}

export function isPOActive(
  status: ProductionOrderStatus | null | undefined,
  archived: Archivable | null | undefined = null
): boolean {
  if (!status) return false;
  if (isPOTerminal(status)) return false;
  if (archived && isArchived(archived)) return false;
  return true;
}

/* ===========================================================================
   CANCELLATION PROPAGATION — mirrors migration 023's SQL triggers
   ===========================================================================

   The DB triggers are the source of truth — they fire on every UPDATE
   to status regardless of which code path issued it. This TS map is
   purely documentation + handy lookups for the UI ("if you cancel this
   doc, these N task lists and M POs will also be cancelled").

   Read this together with supabase/migrations/023_lifecycle_propagation.sql.
*/

export type CascadeSource = "document" | "task_list";

export type CascadeRule = {
  /** What the user is cancelling. */
  from: CascadeSource;
  /** What gets cancelled as a side effect. */
  to: "task_list" | "production_order";
  /** Statuses on the target that we skip (already-terminal). */
  skipIfStatusIn: string[];
  /** Human-readable summary, used in confirmation dialogs. */
  summary: string;
};

export const CASCADE_RULES: CascadeRule[] = [
  {
    from: "document",
    to: "task_list",
    skipIfStatusIn: ["cancelled"],
    summary:
      "Cancelling a quotation also cancels every linked task list (unless already cancelled).",
  },
  {
    from: "document",
    to: "production_order",
    skipIfStatusIn: ["cancelled", "delivered"],
    summary:
      "Cancelling a quotation also cancels every linked production order (unless already cancelled or delivered).",
  },
  {
    from: "task_list",
    to: "production_order",
    skipIfStatusIn: ["cancelled", "delivered"],
    summary:
      "Cancelling a task list also cancels its linked production order (unless already cancelled or delivered).",
  },
];

/** Get the cascade summary for displaying in a confirm dialog. */
export function describeCascade(source: CascadeSource): string[] {
  return CASCADE_RULES.filter((r) => r.from === source).map((r) => r.summary);
}

/* ===========================================================================
   ORDER-IN-FLIGHT LIFECYCLE — the operational "bird's-eye view".
   ---------------------------------------------------------------------------
   ONE source of truth for "where is this order, really?". An order combines
   three entities (quotation → task list → production order); this collapses
   their statuses into the SINGLE current operational stage, with plain-English
   context, so anyone (sales / TLM / ops / management) reads the same truth.

   The fine stage (label) is precise; `phaseIndex` maps it onto a compact
   6-phase strip for the at-a-glance progress bar:

     0 Quote → 1 Task list → 2 Payment → 3 Production → 4 Shipping → 5 Delivered
   =========================================================================== */

export const ORDER_FLIGHT_PHASES = [
  "Quote",
  "Task list",
  "Payment",
  "Production",
  "Shipping",
  "Delivered",
] as const;

export type OrderStageTone =
  | "neutral"
  | "sky"
  | "amber"
  | "violet"
  | "emerald"
  | "red";

export type OrderFlightStage = {
  /** 0..5 index into ORDER_FLIGHT_PHASES — drives the progress strip. */
  phaseIndex: number;
  /** Precise current stage, e.g. "Awaiting deposit". */
  label: string;
  /** Plain-English operational context, e.g. "Awaiting customer deposit…". */
  context: string;
  tone: OrderStageTone;
};

/** Minimal shape needed to compute the stage (matches OrderInFlight fields). */
export type OrderStageInput = {
  task_list_id?: string | null;
  task_list_status?: ProductionTaskListStatus | null;
  production_status?: string | null;
  shipment_booked?: boolean | null;
  etd?: string | null;
  eta?: string | null;
  delay_days?: number | null;
};

function fmtDay(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

/**
 * Resolve the real current stage of an in-flight order from the most advanced
 * signal available: the production order's status first (it's furthest along),
 * then the task list status, then "won but nothing started".
 */
export function computeOrderFlightStage(o: OrderStageInput): OrderFlightStage {
  const ps = o.production_status ?? null;
  const delay = o.delay_days ?? 0;
  const etd = fmtDay(o.etd);
  const eta = fmtDay(o.eta);

  // ---- Production-order driven (most advanced) ----
  if (ps && ps !== "cancelled") {
    switch (ps) {
      case "delivered":
        return { phaseIndex: 5, label: "Delivered", context: "Order delivered to the customer.", tone: "emerald" };
      case "shipped":
        return { phaseIndex: 4, label: "In transit", context: eta ? `On the water — ETA ${eta}.` : "Shipped — in transit to destination.", tone: "violet" };
      case "shipment_booked":
        return { phaseIndex: 4, label: "Shipment booked", context: etd ? `Booked — departs ${etd}.` : "Shipment booked — awaiting departure.", tone: "violet" };
      case "production_completed":
        return { phaseIndex: 4, label: "Production complete", context: o.shipment_booked ? "Finished — shipment booked." : "Manufacturing finished — preparing shipment.", tone: "emerald" };
      case "production_delayed":
        return { phaseIndex: 3, label: "Production delayed", context: delay > 0 ? `Behind schedule by ${delay}d — chasing the factory.` : "Production behind schedule.", tone: "red" };
      case "in_production":
        return { phaseIndex: 3, label: "In production", context: delay > 0 ? `Manufacturing — ${delay}d behind baseline.` : "Manufacturing in progress at the factory.", tone: delay > 0 ? "red" : "amber" };
      case "production_scheduled":
        return { phaseIndex: 3, label: "Production approved", context: "Approved — waiting for the factory slot.", tone: "sky" };
      case "deposit_received":
        return { phaseIndex: 3, label: "Deposit received", context: "Deposit in — production release pending.", tone: "sky" };
      case "awaiting_deposit":
        return { phaseIndex: 2, label: "Awaiting deposit", context: "Awaiting customer deposit before production release.", tone: "amber" };
    }
  }

  // ---- Task-list driven (no usable production order yet) ----
  switch (o.task_list_status ?? null) {
    case "production_ready":
      return { phaseIndex: 2, label: "Production ready", context: "Validated — production order being created.", tone: "sky" };
    case "validated":
      return { phaseIndex: 2, label: "Task list validated", context: "Approved by the factory — releasing to production.", tone: "sky" };
    case "under_validation":
      return { phaseIndex: 1, label: "Under task list review", context: "Task list under review by the factory.", tone: "amber" };
    case "needs_revision":
      return { phaseIndex: 1, label: "Needs revision", context: "Sent back to sales — clarification needed.", tone: "red" };
    case "draft":
      return { phaseIndex: 1, label: "Task list draft", context: "Sales is preparing the task list.", tone: "neutral" };
    case "cancelled":
      return { phaseIndex: 1, label: "Task list cancelled", context: "The task list was cancelled.", tone: "neutral" };
  }

  // ---- Won, nothing started yet ----
  return { phaseIndex: 1, label: "Awaiting task list", context: "Deal won — task list not started yet.", tone: "neutral" };
}
