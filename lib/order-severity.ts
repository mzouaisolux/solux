/**
 * Order severity — pure presentational scoring for the Operations V2
 * "Orders in flight" board.
 *
 * It maps signals THAT ALREADY EXIST elsewhere (the operational alert level
 * from operations-alerts.ts, the lifecycle stage tone from lifecycle.ts, the
 * order pills from order-pills.ts, and the sections of the action-center items
 * attached to the order) onto a SINGLE 3-tier severity. That severity drives
 * two things only:
 *   1. the card's left-border colour (🔴 blocked / 🟠 at risk / 🟢 on track)
 *   2. the automatic sort order (deals that burn first float to the top)
 *
 * This is NOT business logic — it invents no rule and reads no data. It only
 * RANKS signals that are already computed. The thresholds live here, in one
 * place, on purpose: tuning "what counts as blocked vs at risk" is a single
 * edit, and the function is trivially unit-testable.
 *
 * Zero imports on purpose: kept loadable by the node test runner
 * (tests/*.test.ts) exactly like lib/operations-alerts.ts. The string unions
 * below mirror the source enums; callers pass the real values straight through
 * (they ARE these exact strings).
 */

/** Mirrors OperationsAlertLevel (lib/operations-alerts.ts). */
export type SevAlertLevel =
  | "ok"
  | "awaiting_deposit"
  | "completion_approaching"
  | "overdue"
  | "delayed"
  | "balance_due"
  | null;

/** Mirrors OrderStageTone (lib/lifecycle.ts). */
export type SevStageTone =
  | "neutral"
  | "sky"
  | "amber"
  | "violet"
  | "emerald"
  | "red";

/** Mirrors OrderPillTone (lib/order-pills.ts). */
export type SevPillTone = "danger" | "warn" | "info" | "success" | "default";

export type SeverityTier = "blocked" | "action_required" | "at_risk" | "on_track";

export type OrderSeverityInput = {
  /** The order's operational alert level, or null when it has no production order yet. */
  alertLevel?: SevAlertLevel;
  /** The lifecycle stage tone (red = late/needs revision, amber = attention). */
  stageTone?: SevStageTone;
  /** The tones of the order's visible pills. */
  pillTones?: SevPillTone[];
  /**
   * The dashboard CATEGORIES of the signals attached to this order — resolved
   * from the rulebook (lib/dashboard-operations-config), not from raw sections.
   * Only the 3 actionable tiers occur here (never "on_track").
   */
  actionCategories?: SeverityTier[];
};

export type OrderSeverity = {
  tier: SeverityTier;
  /** Higher = more urgent. Drives the descending sort. */
  rank: number;
};

const TIER_RANK: Record<SeverityTier, number> = {
  blocked: 400,
  action_required: 300,
  at_risk: 200,
  on_track: 100,
};

/** Alert levels that mean "something is actively wrong / stuck" → blocked. */
const BLOCKING_ALERTS = new Set<SevAlertLevel>([
  "overdue",
  "delayed",
  "balance_due",
]);

/** Alert levels that mean "a timer is running / will become a problem" → at risk. */
const AT_RISK_ALERTS = new Set<SevAlertLevel>([
  "awaiting_deposit",
  "completion_approaching",
]);

/**
 * Collapse all of an order's existing signals into a single severity tier + a
 * sort rank. Precedence: blocked > action required > at risk > on track.
 *
 *   blocked          something is actively wrong / production is stuck
 *                    (overdue, factory slip, balance overdue, task list rejected)
 *   action_required  a concrete to-do is on someone now to move it forward
 *                    (task list to validate, missing deadline, missing shipping info)
 *   at_risk          a timer is running — watch & nudge (awaiting deposit, ETA close)
 *   on_track         nothing flagged
 */
export function deriveOrderSeverity(input: OrderSeverityInput): OrderSeverity {
  const {
    alertLevel = null,
    stageTone,
    pillTones = [],
    actionCategories = [],
  } = input;

  const blocked =
    BLOCKING_ALERTS.has(alertLevel) ||
    stageTone === "red" ||
    pillTones.includes("danger") ||
    actionCategories.includes("blocked");

  // A clear, actionable to-do attached to the order (validate task list, set
  // deadline, fill shipping info) — category resolved from the rulebook.
  const actionRequired = actionCategories.includes("action_required");

  const atRisk =
    AT_RISK_ALERTS.has(alertLevel) ||
    stageTone === "amber" ||
    pillTones.includes("warn") ||
    actionCategories.includes("at_risk");

  const tier: SeverityTier = blocked
    ? "blocked"
    : actionRequired
    ? "action_required"
    : atRisk
    ? "at_risk"
    : "on_track";

  // Within a tier, an order with more alarming signals sorts above one with a
  // single signal — so the worst deal of a band is always on top.
  const signalBoost =
    (BLOCKING_ALERTS.has(alertLevel) ? 1 : 0) +
    pillTones.filter((p) => p === "danger").length +
    actionCategories.filter((c) => c === "blocked").length +
    actionCategories.filter((c) => c === "action_required").length;

  return { tier, rank: TIER_RANK[tier] + Math.min(signalBoost, 50) };
}
