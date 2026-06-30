/**
 * Operations V2 — 7-phase execution timeline (the cockpit's lifecycle strip).
 *
 * The production dashboard uses the 6-phase ORDER_FLIGHT_PHASES (lib/lifecycle).
 * V2's cockpit splits two of those out so an operator sees the full execution
 * path of a COMMAND (proforma), from quote to delivery:
 *
 *   0 Quote · 1 Task list · 2 Validation · 3 Deposit · 4 Production · 5 Shipping · 6 Delivered
 *
 * ZERO-IMPACT: this does NOT modify lib/lifecycle. It REUSES the canonical
 * computeOrderFlightStage (the single source of truth for "where is this
 * order, really?") and only re-buckets its fine LABEL onto the 7-phase strip.
 * Pure + zero imports → loadable by the node test runner.
 */

export const ORDER_FLIGHT_PHASES_V2 = [
  "Quote",
  "Task list",
  "Validation",
  "Deposit",
  "Production",
  "Shipping",
  "Delivered",
] as const;

/**
 * Map a canonical fine-stage label (returned by computeOrderFlightStage) onto
 * the 0..6 index of the 7-phase V2 strip. Every label that function can emit is
 * covered; unknown labels default to 1 (Task list) — the earliest post-quote
 * phase, so a new stage never reads as "delivered" by accident.
 */
const LABEL_TO_PHASE7: Record<string, number> = {
  // 6 — delivered
  Delivered: 6,
  // 5 — shipping
  "In transit": 5,
  "Shipment booked": 5,
  "Production complete": 5,
  // 4 — production
  "Production delayed": 4,
  "In production": 4,
  "Production approved": 4,
  "Deposit received": 4,
  // 3 — deposit
  "Awaiting deposit": 3,
  "Production ready": 3,
  // 2 — validation
  "Task list validated": 2,
  "Under task list review": 2,
  "Needs revision": 2,
  // 1 — task list
  "Task list draft": 1,
  "Task list cancelled": 1,
  "Awaiting task list": 1,
};

/** Resolve the 0..6 phase index for the V2 strip from a fine-stage label. */
export function phase7Index(stageLabel: string): number {
  return LABEL_TO_PHASE7[stageLabel] ?? 1;
}
