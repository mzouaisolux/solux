/**
 * Order pills — operational status badges shown on each row of the
 * dashboard's "Orders in flight" list.
 *
 * The goal: users instantly read the operational state of an order
 * without opening the PO detail page. Each pill encodes ONE signal
 * (payment / production / logistics / blocker) with a tone and a
 * short label.
 *
 * Design rules (per user spec)
 * ----------------------------
 *   - Subtle, dense, professional. No emoji vomit.
 *   - One pill per signal type, never duplicated.
 *   - Hard cap at 4 visible pills (priority: blocker > payment >
 *     production > logistics).
 *   - Tone palette stays consistent across the app:
 *       danger  = rose   (production delayed, balance overdue, customs)
 *       warn    = amber  (awaiting payment, ending soon)
 *       info    = sky    (in transit, shipping booked, ready to ship)
 *       success = emerald(paid in full, delivered)
 *       default = neutral(ETA, no special state)
 *
 * Pure function — no DB, no React. Same helper can be called from
 * server (dashboard data prep) AND client (defensive recompute) if
 * we ever need to.
 */

import type {
  ProductionPaymentState,
  ProductionTaskListStatus,
} from "@/lib/types";
import { PRODUCTION_COMPLETED_STATUSES } from "@/lib/types";

export type OrderPillKind =
  | "blocker"
  | "validation"
  | "payment"
  | "production"
  | "logistics";

export type OrderPillTone =
  | "danger"
  | "warn"
  | "info"
  | "success"
  | "default";

export type OrderPill = {
  kind: OrderPillKind;
  label: string;
  tone: OrderPillTone;
  /** Optional tooltip — fuller context that the compact label clips. */
  title?: string;
};

export type OrderPillInput = {
  /** Raw production_order.status. */
  production_status?: string | null;
  current_deadline?: string | null;
  /** Computed total delay = current - initial deadline (days). Kept for
   *  callers that don't yet pass the m072 split. Positive = late. */
  delay_days?: number | null;
  /** m072 — slip days attributed to the FACTORY (delay_type = 'production').
   *  When provided, this drives the red "Delayed" pill instead of the
   *  bulk `delay_days` value, so external causes don't poison factory KPI. */
  factory_delay_days?: number | null;
  /** m072 — slip days attributed to EXTERNAL causes (payment, shipping,
   *  client, supplier, customs, other). When > 0 we emit a separate
   *  amber pill so the cause is unambiguous. */
  external_delay_days?: number | null;
  /** Computed days until current_deadline. Negative = past, positive = future. */
  ending_in_days?: number | null;
  shipment_booked?: boolean | null;
  etd?: string | null;
  eta?: string | null;
  actual_completion_date?: string | null;
  /** Pre-computed payment state from computeProductionPaymentState(). */
  payment_state?: ProductionPaymentState | null;
  /** Task list status — drives the "factory validation" pill before
   *  production materially starts. Sales' single most-asked question
   *  at this stage is "has factory validated yet?". */
  task_list_status?: ProductionTaskListStatus | null;
  /** How many days before ETA the balance reminder should fire.
   *  When set + balance not received + today ≥ (ETA - N days), the
   *  helper emits a "Balance due in Md" amber pill. */
  balance_reminder_days_before_eta?: number | null;
};

/** Compact "MMM dd" date — used in pill labels where space is tight. */
function fmtShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "2-digit",
  });
}

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Compute the visible pill set for an order. Returns an ordered array
 * (most important first), capped at 4.
 */
export function computeOrderPills(meta: OrderPillInput): OrderPill[] {
  const pills: OrderPill[] = [];
  const today = todayIso();
  const status = meta.production_status ?? null;
  const delivered = status === "delivered";
  const completed =
    !!meta.actual_completion_date ||
    (status != null && (PRODUCTION_COMPLETED_STATUSES as string[]).includes(status));

  /* ─────────── 0. BLOCKERS (highest priority) ─────────── */
  if (status === "cancelled") {
    pills.push({
      kind: "blocker",
      label: "Cancelled",
      tone: "danger",
      title: "Production order cancelled",
    });
    return pills; // nothing else matters
  }

  /* ─────────── 1. VALIDATION (only pre-production) ─────────── */
  // Sales' #1 operational question early in the lifecycle: "has the
  // factory validated the task list yet?". The validation pill makes
  // it explicit on each row, so they don't have to open the PTL.
  // We only surface this before production has materially started
  // (no PO status, or PO still awaiting deposit). Once production
  // is active, the payment / production / logistics pills take over.
  const productionMaterial =
    status !== null &&
    status !== "awaiting_deposit" &&
    status !== "cancelled";
  if (!productionMaterial && meta.task_list_status) {
    switch (meta.task_list_status) {
      case "under_validation":
        pills.push({
          kind: "validation",
          label: "Awaiting factory validation",
          tone: "warn",
          title: "Task list submitted — factory review pending",
        });
        break;
      case "needs_revision":
        pills.push({
          kind: "validation",
          label: "Factory revision needed",
          tone: "danger",
          title: "Factory requested revision on the task list",
        });
        break;
      case "validated":
        pills.push({
          kind: "validation",
          label: "Validated",
          tone: "info",
          title: "Factory validated · awaiting production order activation",
        });
        break;
      case "production_ready":
        pills.push({
          kind: "validation",
          label: "Production approved",
          tone: "success",
          title: "Factory approved · production cleared to start",
        });
        break;
      // 'draft' / 'cancelled' don't show a validation pill — handled
      // elsewhere or not relevant here.
    }
  }

  /* ─────────── 2. PAYMENT ─────────── */
  // We only surface a payment pill when the state demands attention.
  // Mid-flight (deposit received, balance not yet expected) → silent.
  if (meta.payment_state === "awaiting_deposit") {
    pills.push({
      kind: "payment",
      label: "Awaiting deposit",
      tone: "warn",
      title: "Production is gated on the deposit",
    });
  } else if (
    completed &&
    (meta.payment_state === "partial_balance" ||
      meta.payment_state === "deposit_received")
  ) {
    // Production done, balance not received → operational blocker.
    pills.push({
      kind: "payment",
      label: "Balance overdue",
      tone: "danger",
      title: "Production complete — balance still outstanding",
    });
  } else if (
    meta.eta &&
    meta.balance_reminder_days_before_eta != null &&
    meta.balance_reminder_days_before_eta >= 0 &&
    meta.payment_state !== "paid_in_full" &&
    meta.payment_state !== "no_deposit_required" &&
    !delivered
  ) {
    // Balance reminder threshold reached but ETA not yet past.
    // Drives the proactive "push the client now" operational alert
    // — TLM/Ops configures the offset per order.
    const etaMs = new Date(meta.eta + "T00:00:00Z").getTime();
    const todayMs = new Date(today + "T00:00:00Z").getTime();
    const reminderMs =
      etaMs - meta.balance_reminder_days_before_eta * 86_400_000;
    if (
      Number.isFinite(etaMs) &&
      Number.isFinite(todayMs) &&
      todayMs >= reminderMs &&
      todayMs < etaMs
    ) {
      const daysToEta = Math.max(
        1,
        Math.ceil((etaMs - todayMs) / 86_400_000)
      );
      pills.push({
        kind: "payment",
        label: `Balance due in ${daysToEta}d`,
        tone: "warn",
        title: `Reminder set ${meta.balance_reminder_days_before_eta}d before ETA · balance not yet received`,
      });
    }
  } else if (meta.payment_state === "paid_in_full" && !delivered) {
    // Paid but not yet delivered — quiet confidence signal.
    pills.push({
      kind: "payment",
      label: "Paid in full",
      tone: "success",
    });
  }

  /* ─────────── 2. PRODUCTION ─────────── */
  // m072 — split factory vs external. Falls back to the bulk `delay_days`
  // when the page hasn't computed the split yet (treated as factory, the
  // pre-m072 default).
  const factoryDelay =
    meta.factory_delay_days != null
      ? meta.factory_delay_days
      : meta.delay_days ?? 0;
  const externalDelay = meta.external_delay_days ?? 0;

  if (delivered) {
    // Delivered → no production pill (logistics will surface it).
  } else if (factoryDelay > 0 && !completed) {
    // Responsibility-tagged label so the ops board doesn't read as
    // anonymous "Delayed" — operators see WHO owns the slip at a glance.
    pills.push({
      kind: "production",
      label: `${factoryDelay}d late · factory`,
      tone: "danger",
      title: `Factory is ${factoryDelay} day(s) past baseline — counts toward factory KPI`,
    });
  } else if (externalDelay > 0 && !completed) {
    // Non-factory blocker. Amber, not red — doesn't damage factory KPI.
    pills.push({
      kind: "production",
      label: `${externalDelay}d late · external`,
      tone: "warn",
      title: `Project is ${externalDelay} day(s) behind for external reasons (payment / shipping / client / supplier / customs). Factory is not responsible.`,
    });
  } else if (
    meta.ending_in_days != null &&
    meta.ending_in_days < 0 &&
    !completed
  ) {
    // Past the current deadline AND not marked complete = overdue.
    const days = Math.abs(meta.ending_in_days);
    pills.push({
      kind: "production",
      label: `Overdue ${days}d`,
      tone: "danger",
      title: `Past current deadline by ${days} day(s) — production not yet marked complete`,
    });
  } else if (
    meta.ending_in_days != null &&
    meta.ending_in_days >= 0 &&
    meta.ending_in_days <= 7 &&
    !completed
  ) {
    pills.push({
      kind: "production",
      label: `Ending in ${meta.ending_in_days}d`,
      tone: "warn",
      title: `Production ends in ${meta.ending_in_days} day(s)`,
    });
  } else if (completed && !meta.shipment_booked && !delivered) {
    pills.push({
      kind: "production",
      label: "Ready to ship",
      tone: "info",
      title: "Production complete · awaiting shipment booking",
    });
  } else if (meta.current_deadline && !completed) {
    // Neutral ETA when no urgency signal applies.
    pills.push({
      kind: "production",
      label: `ETA ${fmtShort(meta.current_deadline)}`,
      tone: "default",
      title: "Current production deadline",
    });
  }

  /* ─────────── 3. LOGISTICS ─────────── */
  if (delivered) {
    pills.push({
      kind: "logistics",
      label: `Delivered ${meta.eta ? `· ${fmtShort(meta.eta)}` : ""}`.trim(),
      tone: "success",
      title: "Order delivered to client",
    });
  } else if (meta.shipment_booked) {
    if (meta.eta && meta.eta < today) {
      // ETA passed, not yet delivered → likely at port / customs.
      pills.push({
        kind: "logistics",
        label: "Customs pending",
        tone: "warn",
        title: `ETA ${fmtShort(meta.eta)} has passed — order in customs / final delivery`,
      });
    } else if (meta.etd && meta.etd <= today && meta.eta && meta.eta > today) {
      pills.push({
        kind: "logistics",
        label: `In transit · ETA ${fmtShort(meta.eta)}`,
        tone: "info",
        title: `Container departed ${fmtShort(meta.etd)} · ETA ${fmtShort(meta.eta)}`,
      });
    } else if (meta.etd) {
      pills.push({
        kind: "logistics",
        label: `Booked · ETD ${fmtShort(meta.etd)}`,
        tone: "info",
        title: `Shipment booked · estimated departure ${fmtShort(meta.etd)}`,
      });
    } else if (meta.eta) {
      pills.push({
        kind: "logistics",
        label: `Booked · ETA ${fmtShort(meta.eta)}`,
        tone: "info",
        title: `Shipment booked · estimated arrival ${fmtShort(meta.eta)}`,
      });
    } else {
      pills.push({
        kind: "logistics",
        label: "Shipping booked",
        tone: "info",
      });
    }
  }

  return pills.slice(0, 4);
}

/** Tailwind palette for the pill chrome. Single source of truth so
 *  the component renderer + any other surface stay consistent. */
export const ORDER_PILL_TONES: Record<OrderPillTone, string> = {
  danger: "border-rose-200 bg-rose-50 text-rose-800",
  warn: "border-amber-200 bg-amber-50 text-amber-800",
  info: "border-sky-200 bg-sky-50 text-sky-800",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  default: "border-neutral-200 bg-neutral-50 text-neutral-700",
};
