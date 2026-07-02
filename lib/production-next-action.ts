/**
 * production-next-action — the single "what should Operations do next?" for a
 * production order, plus the ranked queue of everything else outstanding.
 *
 * The live PO detail page renders 7 equally-weighted sections; the operator has
 * to scan all of them to reconstruct "what's on me right now". This module does
 * that reconstruction ONCE, deterministically: it collapses the signals the page
 * already derives (payment state, BL completeness, doc readiness, balance/LC
 * timers, lifecycle status) into
 *
 *   • primary  — the ONE hero action for the current state, or null,
 *   • queue    — every other outstanding item, ranked most-urgent first,
 *   • clear    — true when nothing is actionable (idle / on track),
 *   • closed   — true for terminal states (cancelled / delivered / archived).
 *
 * It invents no data and touches no DB — it only RANKS values computed upstream,
 * exactly like lib/order-severity.ts and lib/operations-alerts.ts. Zero imports
 * on purpose, so the node test runner (tests/*.test.ts) can load it directly.
 * The string unions below mirror the source enums; callers pass the real values
 * straight through (they ARE these exact strings).
 *
 * Copy follows the app's existing convention (operations-alerts.ts returns plain
 * English label/message strings, not i18n keys) — a prototype-grade choice.
 */

export type NaStatus =
  | "awaiting_deposit"
  | "deposit_received"
  | "production_scheduled"
  | "in_production"
  | "production_delayed"
  | "production_completed"
  | "shipment_booked"
  | "shipped"
  | "delivered"
  | "cancelled";

export type NaPaymentState =
  | "awaiting_deposit"
  | "deposit_received"
  | "partial_balance"
  | "paid_in_full"
  | "no_deposit_required";

export type NaBlStatus = "complete" | "partial" | "missing";

/** Semantic weight of an item — drives the left-accent + the primary pick. */
export type NaTone = "blocked" | "action" | "at_risk" | "info" | "good";

export type NextActionItem = {
  key: string;
  tone: NaTone;
  /** Tabler icon name (outline) for the prototype UI. */
  icon: string;
  title: string;
  detail: string;
  ctaLabel: string | null;
};

export type NextAction = {
  primary: NextActionItem | null;
  queue: NextActionItem[];
  clear: boolean;
  closed: boolean;
};

export type NextActionInput = {
  status: NaStatus;
  paymentState: NaPaymentState;
  productionCanStart: boolean;
  shipmentBooked: boolean;
  depositOverrideActive: boolean;
  blStatus: NaBlStatus;
  docsAllRequiredReady: boolean;
  docsRequiredReady: number;
  docsRequiredTotal: number;
  ciGenerated: boolean;
  /** balance portion still outstanding (expectedBalance > received). */
  balanceOutstanding: boolean;
  /** Pre-formatted "USD 92,250" for the detail line. */
  balanceRemainingLabel: string;
  /** Pre-formatted effective due date, or null. */
  balanceDueLabel: string | null;
  /** Days past the balance due date; > 0 = late, null = unknown. */
  balanceDueDaysLate: number | null;
  /** Calendar days until current ETA; negative = past. */
  daysToEta: number | null;
  /** Per-order "remind N days before ETA" threshold, or null. */
  balanceReminderDaysBeforeEta: number | null;
  /** LC in play and inside the expiry warning window. */
  lcCritical: boolean;
  /** Days until LC expiry; negative = already expired. */
  lcDaysToExpiry: number | null;
  archived: boolean;
};

/** Internal candidate carries a numeric weight; higher = more urgent. */
type Candidate = NextActionItem & { weight: number };

const W = {
  depositGate: 500,
  lcExpiring: 490,
  productionDelayed: 480,
  balanceOverdue: 470,
  startProduction: 460,
  completeBl: 440,
  bookShipment: 430,
  exportDocs: 410,
  balanceDueSoon: 350,
  confirmDeparture: 300,
  markDelivered: 260,
  overrideInfo: 120,
  inProductionOk: 100,
} as const;

const DEFAULT_REMINDER_WINDOW = 15;

/**
 * Collapse an order's already-derived signals into one primary action + a ranked
 * queue. Precedence is encoded as weights (see W): cash blockers (deposit gate,
 * LC expiry, overdue balance) outrank logistics steps on purpose — nothing ships
 * or matters while money is stuck.
 */
export function computeNextAction(input: NextActionInput): NextAction {
  // ---- Terminal states: no actions to propose. -----------------------------
  if (input.archived || input.status === "cancelled") {
    return { primary: null, queue: [], clear: false, closed: true };
  }
  if (input.status === "delivered") {
    return { primary: null, queue: [], clear: true, closed: true };
  }

  const c: Candidate[] = [];

  // ---- Stage-driven action (one of these applies at a time). ---------------
  if (input.paymentState === "awaiting_deposit" && !input.depositOverrideActive) {
    c.push({
      key: "deposit",
      tone: "blocked",
      icon: "ti-cash",
      title: "Record the deposit",
      detail: "Production is gated until the deposit lands.",
      ctaLabel: "Record deposit",
      weight: W.depositGate,
    });
  } else if (
    input.productionCanStart &&
    (input.status === "deposit_received" ||
      input.status === "production_scheduled")
  ) {
    c.push({
      key: "start",
      tone: "action",
      icon: "ti-player-play",
      title: "Start production",
      detail: "Deposit cleared — kick off the build and freeze the baseline.",
      ctaLabel: "Start production",
      weight: W.startProduction,
    });
  }

  if (input.status === "production_delayed") {
    c.push({
      key: "delay",
      tone: "blocked",
      icon: "ti-alert-triangle",
      title: "Revise the deadline",
      detail: "Production is flagged delayed — log the cause and set a new ETA.",
      ctaLabel: "Update timeline",
      weight: W.productionDelayed,
    });
  }

  if (input.status === "production_completed" && !input.shipmentBooked) {
    if (input.blStatus !== "complete") {
      c.push({
        key: "bl",
        tone: "action",
        icon: "ti-address-book",
        title: "Complete the BL profile",
        detail: "Booking is blocked until consignee / notify details are set.",
        ctaLabel: "Complete BL profile",
        weight: W.completeBl,
      });
    } else {
      c.push({
        key: "book",
        tone: "action",
        icon: "ti-ship",
        title: "Book the shipment",
        detail: "Production's done and the BL profile is ready. Book a carrier.",
        ctaLabel: "Book shipment",
        weight: W.bookShipment,
      });
    }
  }

  // Export docs: relevant once the goods are (about to be) moving.
  if (
    !input.docsAllRequiredReady &&
    (input.shipmentBooked ||
      input.status === "production_completed" ||
      input.status === "shipped")
  ) {
    c.push({
      key: "docs",
      tone: "action",
      icon: "ti-file-invoice",
      title: input.ciGenerated
        ? "Complete the export documents"
        : "Generate the commercial invoice",
      detail: `${input.docsRequiredReady}/${input.docsRequiredTotal} required documents ready.`,
      ctaLabel: input.ciGenerated ? "Open documents" : "Generate CI",
      weight: W.exportDocs,
    });
  }

  if (input.status === "shipment_booked") {
    c.push({
      key: "etd",
      tone: "at_risk",
      icon: "ti-calendar",
      title: "Confirm departure",
      detail: "Set ETD / ETA once the carrier confirms loading.",
      ctaLabel: "Update shipping",
      weight: W.confirmDeparture,
    });
  }
  if (input.status === "shipped") {
    c.push({
      key: "deliver",
      tone: "at_risk",
      icon: "ti-package",
      title: "Mark delivered on arrival",
      detail: "Container has sailed — close the order once it lands.",
      ctaLabel: "Mark delivered",
      weight: W.markDelivered,
    });
  }

  // ---- Cross-cutting cash signals (co-exist with any stage above). ---------
  if (input.lcCritical) {
    const d = input.lcDaysToExpiry;
    c.push({
      key: "lc",
      tone: "blocked",
      icon: "ti-file-certificate",
      title: "Letter of credit expiring",
      detail:
        d == null
          ? "The LC covering this order is close to expiry."
          : d < 0
          ? `Expired ${Math.abs(d)}d ago — the balance is at risk.`
          : d === 0
          ? "Expires today — collect against it now."
          : `${d}d left before the LC expires.`,
      ctaLabel: "Review LC",
      weight: W.lcExpiring,
    });
  }

  const balanceOverdue =
    input.balanceOutstanding &&
    input.balanceDueDaysLate != null &&
    input.balanceDueDaysLate > 0;
  const balanceDueSoon =
    input.balanceOutstanding &&
    !balanceOverdue &&
    input.daysToEta != null &&
    input.daysToEta <=
      (input.balanceReminderDaysBeforeEta ?? DEFAULT_REMINDER_WINDOW);

  if (balanceOverdue) {
    c.push({
      key: "balance-overdue",
      tone: "blocked",
      icon: "ti-cash",
      title: "Balance overdue",
      detail: `${input.balanceRemainingLabel} outstanding · ${input.balanceDueDaysLate}d late.`,
      ctaLabel: "Record payment",
      weight: W.balanceOverdue,
    });
  } else if (balanceDueSoon) {
    c.push({
      key: "balance-due",
      tone: "at_risk",
      icon: "ti-cash",
      title: "Balance due soon",
      detail:
        `${input.balanceRemainingLabel} outstanding` +
        (input.balanceDueLabel ? ` · due ${input.balanceDueLabel}` : "") +
        (input.daysToEta != null && input.daysToEta >= 0
          ? ` · ${input.daysToEta}d to ETA`
          : ""),
      ctaLabel: "Record / remind",
      weight: W.balanceDueSoon,
    });
  }

  // ---- Informational (never primary). --------------------------------------
  const info: NextActionItem[] = [];
  if (input.depositOverrideActive) {
    info.push({
      key: "override",
      tone: "info",
      icon: "ti-shield-half",
      title: "Running without deposit",
      detail: "Manual exception is active — the deposit may still arrive.",
      ctaLabel: null,
    });
  }

  // ---- Rank + split. -------------------------------------------------------
  // Stable sort by weight desc: equal weights keep insertion order.
  const actionable = c
    .map((item, i) => ({ item, i }))
    .sort((a, b) => b.item.weight - a.item.weight || a.i - b.i)
    .map(({ item }) => item);

  const strip = ({ weight, ...rest }: Candidate): NextActionItem => rest;

  if (actionable.length === 0) {
    // Nothing outstanding. Give an on-track "good" line when actively building.
    const good: NextActionItem[] = [];
    if (input.status === "in_production") {
      good.push({
        key: "in-production",
        tone: "good",
        icon: "ti-progress",
        title: "Production in progress",
        detail: "On schedule — nothing needs you right now.",
        ctaLabel: null,
      });
    }
    return {
      primary: null,
      queue: [...good, ...info],
      clear: true,
      closed: false,
    };
  }

  const [primary, ...rest] = actionable.map(strip);
  return {
    primary,
    queue: [...rest, ...info],
    clear: false,
    closed: false,
  };
}
