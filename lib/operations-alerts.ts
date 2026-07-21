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

// Relative .ts imports on purpose (not "@/lib/…"): both targets are
// import-free pure modules, which keeps this whole chain loadable by the
// node test runner (tests/*.test.ts — node resolves neither tsconfig
// path aliases nor extension-less relative imports).
import type {
  ProductionOrder,
  PaymentMode,
  PaymentTerms,
} from "./types.ts";
import {
  computeExpectedDeposit,
  computeExpectedBalance,
  computeEffectiveBalanceDueDate,
  computeProductionDelay,
  reconcilePaymentTranche,
  PRODUCTION_ACTIVE_STATUSES,
  PRODUCTION_COMPLETED_STATUSES,
  PRODUCTION_TERMINAL_STATUSES,
} from "./types.ts";
import { calendarDaysBetween, todayISO } from "./working-days.ts";

/** How close to completion before the sales team should request balance. */
export const COMPLETION_APPROACHING_DAYS = 10;

/**
 * How many days a deposit override (production started WITHOUT deposit,
 * m025) may run before the still-missing deposit becomes an alert.
 * Audit 2026-06-11 P0: an override used to disappear from every radar —
 * production runs, money never arrives, nobody is chasing it.
 */
export const DEPOSIT_OVERRIDE_UNPAID_DAYS = 14;

/**
 * How many days before a Letter of Credit expires the alert starts firing
 * (while the balance is still outstanding). An expired LC = produced goods
 * that can no longer be paid under the LC — the single most expensive
 * payment failure in this business, so the warning window is generous.
 */
export const LC_EXPIRY_WARNING_DAYS = 15;

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
  > & {
    /**
     * m025 deposit-override stamp (not part of the base ProductionOrder
     * type — legacy DBs may lack the column). Optional on purpose:
     * callers that don't select it simply never get the unpaid-override
     * alert; callers passing full rows get it for free.
     */
    deposit_override_at?: string | null;
    /**
     * m114 (audit Phase 1 — cash) + m070 ETA. Optional for the same
     * reason: pre-migration rows simply never produce the date-based
     * balance / LC alerts. Callers passing full rows get them for free.
     */
    balance_due_date?: string | null;
    lc_expiry_date?: string | null;
    eta?: string | null;
  };
  totalPrice: number;
  paymentMode: PaymentMode | null;
  paymentTerms: PaymentTerms | null;
  today?: string; // override for testing
};

/**
 * Compute the most relevant alert for a production order.
 *
 * Order of precedence (highest priority first):
 *   1.  overdue — current_deadline < today AND status not completed/shipped
 *   1b. awaiting_deposit (override unpaid) — production started WITHOUT
 *       deposit ≥ DEPOSIT_OVERRIDE_UNPAID_DAYS ago and the deposit still
 *       hasn't been received. Money risk outranks everything but overdue.
 *   1c. balance_due (LC expiry) — Letter of Credit expires within
 *       LC_EXPIRY_WARNING_DAYS (or already expired) while the balance is
 *       outstanding. Reuses the balance_due level — it IS a balance-
 *       collection emergency, just with a harder deadline.
 *   2.  balance_due — balance outstanding AND (past its effective due
 *       date → "Balance overdue Xd", or production completed → classic
 *       "Balance due"). The effective due date is derived by
 *       computeEffectiveBalanceDueDate (manual override → deadline →
 *       ETA+LC days → ETA), so it follows deadline/ETA changes.
 *   3.  delayed — current_deadline > initial_deadline by 1+ day
 *   4.  completion_approaching — current_deadline ≤ today + 10 days
 *   5.  awaiting_deposit — status awaiting_deposit AND deposit expected > 0
 *   6.  ok — none of the above
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

  // ---- 1b. deposit override unpaid ----
  // Production was launched WITHOUT the deposit (manual exception, m025)
  // and the money still hasn't arrived after DEPOSIT_OVERRIDE_UNPAID_DAYS.
  // Reuses the existing `awaiting_deposit` level (no new alert type /
  // badge / color) but flags highPriority: the deposit gate was bypassed,
  // not satisfied — the longer this runs unpaid, the bigger the exposure.
  const overrideAt = order.deposit_override_at ?? null;
  if (
    overrideAt &&
    expectedDeposit > 0 &&
    !reconcilePaymentTranche(expectedDeposit, order.deposit_received_amount).covered
  ) {
    const age = calendarDaysBetween(String(overrideAt).slice(0, 10), today);
    if (age !== null && age >= DEPOSIT_OVERRIDE_UNPAID_DAYS) {
      const remaining = reconcilePaymentTranche(expectedDeposit, order.deposit_received_amount).outstanding;
      return alert(
        "awaiting_deposit",
        `Deposit missing ${age}d`,
        `Production started WITHOUT deposit ${age} days ago and ${remaining.toLocaleString(
          undefined,
          { maximumFractionDigits: 2 }
        )} still hasn't been received — chase the client or escalate to management.`,
        true
      );
    }
  }

  // Shared by 1c + 2: is there balance money still missing?
  const balanceOutstanding =
    expectedBalance > 0 &&
    !reconcilePaymentTranche(expectedBalance, order.balance_received_amount).covered;
  const balanceRemaining = reconcilePaymentTranche(expectedBalance, order.balance_received_amount).outstanding;
  // Date-based money alerts only make sense once the deposit gate is
  // behind us — while awaiting_deposit, alert #5 is the truthful one.
  const pastDepositGate = order.status !== "awaiting_deposit";

  // ---- 1c. LC expiry (m114) ----
  // The Letter of Credit covering this order expires soon (or already
  // has) while the balance is outstanding. Reuses the balance_due level
  // (no new alert type): it IS balance collection, with a hard deadline.
  const lcExpiry = order.lc_expiry_date ?? null;
  if (lcExpiry && balanceOutstanding && pastDepositGate) {
    const daysToExpiry = calendarDaysBetween(today, lcExpiry);
    if (daysToExpiry !== null && daysToExpiry < 0) {
      return alert(
        "balance_due",
        `LC expired ${Math.abs(daysToExpiry)}d`,
        `The Letter of Credit expired ${Math.abs(daysToExpiry)} day${
          Math.abs(daysToExpiry) === 1 ? "" : "s"
        } ago with ${fmtAmount(balanceRemaining)} still outstanding — the LC can no longer pay it. Get an extension/amendment or collect by wire immediately.`,
        true
      );
    }
    if (daysToExpiry !== null && daysToExpiry <= LC_EXPIRY_WARNING_DAYS) {
      return alert(
        "balance_due",
        daysToExpiry === 0 ? "LC expires today" : `LC expires in ${daysToExpiry}d`,
        `The Letter of Credit expires ${
          daysToExpiry === 0 ? "TODAY" : `in ${daysToExpiry} day${daysToExpiry === 1 ? "" : "s"}`
        } and ${fmtAmount(balanceRemaining)} is still outstanding — present documents before expiry or request an extension now.`,
        true
      );
    }
  }

  // ---- 2. balance_due ----
  // Money first: past the EFFECTIVE due date (m114 — manual override, or
  // derived from deadline / ETA+LC days / ETA) the alert says exactly how
  // late we are, whatever the production status. With no derivable due
  // date, the original behavior stands: production done + balance missing.
  if (balanceOutstanding && pastDepositGate) {
    const dueDate = computeEffectiveBalanceDueDate({
      balanceDueDate: order.balance_due_date ?? null,
      paymentMode,
      paymentTerms,
      currentProductionDeadline: order.current_production_deadline,
      eta: order.eta ?? null,
    }).date;
    if (dueDate) {
      const daysLate = calendarDaysBetween(dueDate, today);
      if (daysLate !== null && daysLate > 0) {
        return alert(
          "balance_due",
          `Balance overdue ${daysLate}d`,
          `Balance of ${fmtAmount(balanceRemaining)} was due on ${dueDate} — ${daysLate} day${
            daysLate === 1 ? "" : "s"
          } late. Chase the client or escalate.`,
          true
        );
      }
    }
    if (PRODUCTION_COMPLETED_STATUSES.includes(order.status)) {
      return alert(
        "balance_due",
        "Balance due",
        `Balance of ${fmtAmount(balanceRemaining)} still outstanding before shipment.`,
        true
      );
    }
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

  // ---- 3b. delayed (status-led) ----
  // An operator explicitly flipped the order to `production_delayed`. Even
  // with no recorded deadline slip this MUST alert — a human declared the
  // delay (alert-routing audit: the bell and the dashboards have to agree).
  if (order.status === "production_delayed") {
    return alert(
      "delayed",
      "Delayed",
      "Order marked production-delayed by operations. Inform the client and follow up with the factory.",
      true
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
    !reconcilePaymentTranche(expectedDeposit, order.deposit_received_amount).covered
  ) {
    const remaining = reconcilePaymentTranche(expectedDeposit, order.deposit_received_amount).outstanding;
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

/** Compact money formatting for alert copy (no currency — the row shows it). */
function fmtAmount(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
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
