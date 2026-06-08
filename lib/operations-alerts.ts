/**
 * Operational alert classification.
 *
 * Centralizes all the "is this production order in a state someone needs
 * to act on?" logic so /operations, /order-follow-up, /dashboard and the
 * client workspace render consistent badges + filter rules.
 *
 * Every helper here is pure — given the same row it always returns the
 * same alert, so we can compute alerts at render time without any extra
 * persistence.
 */

import type {
  ProductionOrder,
  PaymentMode,
  PaymentTerms,
} from "@/lib/types";
import {
  computeExpectedDeposit,
  computeExpectedBalance,
  computeProductionDelay,
  PRODUCTION_ACTIVE_STATUSES,
  PRODUCTION_COMPLETED_STATUSES,
  PRODUCTION_TERMINAL_STATUSES,
} from "@/lib/types";
import { calendarDaysBetween, todayISO } from "@/lib/working-days";

/** How close to completion before the sales team should request balance. */
export const COMPLETION_APPROACHING_DAYS = 10;

/** A production order's operational alert level — the highest-priority one wins. */
export type OperationsAlertLevel =
  /** All clear. */
  | "ok"
  /** Awaiting deposit — production can't start until deposit clears. */
  | "awaiting_deposit"
  /** Within COMPLETION_APPROACHING_DAYS of estimated completion — sales should request balance. */
  | "completion_approaching"
  /** Past the estimated completion with status not yet completed. */
  | "overdue"
  /** Updated deadline pushed back vs the original. */
  | "delayed"
  /** Balance still outstanding after production completed — blocks shipment. */
  | "balance_due";

export type OperationsAlert = {
  level: OperationsAlertLevel;
  /** Short label for badges. */
  label: string;
  /** Longer human-readable message used in tooltips + alert lists. */
  message: string;
  /** True when the row should jump to the top of any operational list. */
  highPriority: boolean;
};

const ALERT_PRIORITY: Record<OperationsAlertLevel, number> = {
  overdue: 100,
  balance_due: 90,
  delayed: 80,
  completion_approaching: 70,
  awaiting_deposit: 60,
  ok: 0,
};

/**
 * Inputs needed to classify an order. Decoupled from the raw row so
 * callers can pass already-derived values (e.g. expected deposit) when
 * available rather than reload them.
 */
export type OperationsAlertInput = {
  order: Pick<
    ProductionOrder,
    | "status"
    | "initial_production_deadline"
    | "current_production_deadline"
    | "deposit_received_amount"
    | "balance_received_amount"
    | "actual_completion_date"
  >;
  totalPrice: number;
  paymentMode: PaymentMode | null;
  paymentTerms: PaymentTerms | null;
  today?: string; // override for testing
};

/**
 * Compute the most relevant alert for a production order.
 *
 * Order of precedence (highest priority first):
 *   1. overdue — current_deadline < today AND status not completed/shipped
 *   2. balance_due — production_completed but expected balance not in
 *   3. delayed — current_deadline > initial_deadline by 1+ day
 *   4. completion_approaching — current_deadline ≤ today + 10 days
 *   5. awaiting_deposit — status awaiting_deposit AND deposit expected > 0
 *   6. ok — none of the above
 */
export function computeOperationsAlert(input: OperationsAlertInput): OperationsAlert {
  const { order, totalPrice, paymentMode, paymentTerms } = input;
  const today = input.today ?? todayISO();

  // Terminal statuses never alert.
  if (PRODUCTION_TERMINAL_STATUSES.includes(order.status)) {
    return alert("ok", "OK", "Order closed.", false);
  }

  const expectedDeposit = computeExpectedDeposit(
    totalPrice,
    paymentMode,
    paymentTerms
  );
  const expectedBalance = computeExpectedBalance(
    totalPrice,
    paymentMode,
    paymentTerms
  );

  // ---- 1. overdue ----
  // current_production_deadline has passed and we're still not in a
  // shipping or terminal state.
  if (
    order.current_production_deadline &&
    PRODUCTION_ACTIVE_STATUSES.includes(order.status)
  ) {
    const days = calendarDaysBetween(today, order.current_production_deadline);
    if (days !== null && days < 0) {
      return alert(
        "overdue",
        `Overdue ${Math.abs(days)}d`,
        `Production overdue by ${Math.abs(days)} day${
          Math.abs(days) === 1 ? "" : "s"
        }. Update the deadline or escalate.`,
        true
      );
    }
  }

  // ---- 2. balance_due ----
  // Production is done but the balance hasn't fully come in yet.
  if (
    PRODUCTION_COMPLETED_STATUSES.includes(order.status) &&
    expectedBalance > 0 &&
    order.balance_received_amount + 0.01 < expectedBalance
  ) {
    const remaining = expectedBalance - order.balance_received_amount;
    return alert(
      "balance_due",
      "Balance due",
      `Balance of ${remaining.toLocaleString(undefined, {
        maximumFractionDigits: 2,
      })} still outstanding before shipment.`,
      true
    );
  }

  // ---- 3. delayed ----
  // The current deadline has been pushed back vs the initial commitment.
  const delay = computeProductionDelay(order);
  if (delay !== null && delay > 0) {
    return alert(
      "delayed",
      `+${delay}d`,
      `Production deadline pushed back by ${delay} day${
        delay === 1 ? "" : "s"
      } since initial commitment.`,
      delay >= 7
    );
  }

  // ---- 4. completion_approaching ----
  // Within the alert window — sales should reach out for balance payment.
  if (
    order.current_production_deadline &&
    PRODUCTION_ACTIVE_STATUSES.includes(order.status)
  ) {
    const days = calendarDaysBetween(today, order.current_production_deadline);
    if (days !== null && days >= 0 && days <= COMPLETION_APPROACHING_DAYS) {
      return alert(
        "completion_approaching",
        `${days}d to completion`,
        days === 0
          ? "Production completion expected today — request balance payment."
          : `Production completes in ${days} day${
              days === 1 ? "" : "s"
            } — request balance payment from the client.`,
        true
      );
    }
  }

  // ---- 5. awaiting_deposit ----
  if (
    order.status === "awaiting_deposit" &&
    expectedDeposit > 0 &&
    order.deposit_received_amount + 0.01 < expectedDeposit
  ) {
    const remaining = expectedDeposit - order.deposit_received_amount;
    return alert(
      "awaiting_deposit",
      "Awaiting deposit",
      `Deposit of ${remaining.toLocaleString(undefined, {
        maximumFractionDigits: 2,
      })} needed before production can start.`,
      false
    );
  }

  return alert("ok", "On track", "Production is tracking to schedule.", false);
}

function alert(
  level: OperationsAlertLevel,
  label: string,
  message: string,
  highPriority: boolean
): OperationsAlert {
  return { level, label, message, highPriority };
}

/** Comparator for sorting orders by alert priority (highest first). */
export function alertPriorityDesc(a: OperationsAlert, b: OperationsAlert): number {
  return ALERT_PRIORITY[b.level] - ALERT_PRIORITY[a.level];
}

/** Tailwind classes for the alert badge. Mirrors the existing pill design. */
export const ALERT_LEVEL_CLASS: Record<OperationsAlertLevel, string> = {
  ok: "bg-emerald-50 text-emerald-700 border-emerald-200",
  awaiting_deposit: "bg-neutral-100 text-neutral-700 border-neutral-200",
  completion_approaching: "bg-amber-50 text-amber-800 border-amber-200",
  overdue: "bg-red-50 text-red-700 border-red-200",
  delayed: "bg-orange-50 text-orange-800 border-orange-200",
  balance_due: "bg-rose-50 text-rose-700 border-rose-200",
};

/** Friendly category labels for the operations-page section headers. */
export const ALERT_LEVEL_TITLE: Record<OperationsAlertLevel, string> = {
  ok: "On track",
  awaiting_deposit: "Awaiting deposit",
  completion_approaching: "Completion approaching",
  overdue: "Overdue",
  delayed: "Delayed",
  balance_due: "Balance outstanding",
};
