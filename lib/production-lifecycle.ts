/**
 * Production lifecycle helpers — the canonical interpretation of a
 * production_order's state for the Solux operational workflow.
 *
 * The DB carries the raw fields (validation_date, working_days,
 * deposit_received_at, deposit_override_at, current_deadline, etc.).
 * This module turns those raw fields into the meaningful operational
 * concepts the new UI needs:
 *
 *   - Production Baseline      : the original, locked factory
 *                                commitment. Set at TL validation,
 *                                never changes (except via admin
 *                                unlock, capability-gated).
 *
 *   - Production Start Date    : when production ACTUALLY started.
 *                                Derived: deposit_received_at OR
 *                                deposit_override_at. NULL while
 *                                still waiting for deposit.
 *
 *   - Is Production Active?    : true once a start date exists, false
 *                                otherwise. Drives the UI between
 *                                "Awaiting deposit" neutral state
 *                                vs. "Live tracking" red/green badges.
 *
 *   - Active Projected
 *     Completion              : production_start_date + working_days
 *                               (in working days, weekends excluded).
 *                               Computed when production starts;
 *                               drifts only via deadline edits.
 *
 *   - Baseline Delay          : current_deadline − baseline_completion.
 *                               How far the LIVE deadline has drifted
 *                               from the ORIGINAL promise. NULL while
 *                               production hasn't started.
 *
 * All functions here are pure — no Supabase, no `next/headers`. Safe
 * to import from client AND server.
 */

import type { ProductionOrder } from "./types";
import { PRODUCTION_COMPLETED_STATUSES } from "./types";
import { addWorkingDays } from "./working-days";

/* ===========================================================================
   Production start
   =========================================================================== */

/**
 * Resolve when production ACTUALLY started, regardless of which trigger
 * fired (normal deposit vs. admin override).
 *
 * Returns a YYYY-MM-DD string (or null if production hasn't started).
 *
 * Precedence: deposit_received_at wins over deposit_override_at when
 * BOTH are set (e.g. admin started without deposit, then deposit
 * landed afterwards — the deposit_received is the cleaner anchor).
 */
export function getProductionStartDate(
  po: Pick<ProductionOrder, "deposit_received_at" | "deposit_override_at">
): string | null {
  if (po.deposit_received_at) return po.deposit_received_at;
  if (po.deposit_override_at) {
    // override is timestamptz; we keep just the date portion
    return po.deposit_override_at.slice(0, 10);
  }
  return null;
}

/**
 * True when production has materially started. Drives the UI between
 * the pre-start "Awaiting deposit" neutral state and the live tracking
 * panel.
 */
export function isProductionActive(
  po: Pick<ProductionOrder, "deposit_received_at" | "deposit_override_at">
): boolean {
  return getProductionStartDate(po) !== null;
}

/**
 * True when production was started via the admin override (not by a
 * received deposit). The UI shows a "Started without deposit" badge
 * when this is the case and the deposit still hasn't landed.
 */
export function isStartedWithoutDeposit(
  po: Pick<ProductionOrder, "deposit_received_at" | "deposit_override_at">
): boolean {
  return !po.deposit_received_at && !!po.deposit_override_at;
}

/* ===========================================================================
   Baseline
   =========================================================================== */

/**
 * Has the production baseline been LOCKED?
 *
 * Revised semantics (May 2026 — per Solux ops correction):
 *
 *   The baseline is locked when PRODUCTION HAS ACTIVATED, not when
 *   working_days was first saved. Before activation, ops still needs
 *   to revise working_days for commercial communication / planning,
 *   so the field stays editable.
 *
 *   Activation = deposit fully received OR start-without-deposit
 *   override fired. At that moment, Initial Project Completion gets
 *   stamped (= start_date + working_days) and any further edit to
 *   working_days would invalidate that frozen commitment. So we lock
 *   it.
 *
 * Locked once a COMMITTED FINISH (`initial_production_deadline`) has been
 * stamped — that frozen value is exactly what the lock protects. Production
 * can be active WITHOUT a committed finish (the deposit landed before working
 * days were set); until one exists there is nothing to protect, so working
 * days must stay EDITABLE and the ETA can still be computed.
 *
 * (We deliberately no longer lock on mere `isProductionActive`: that stranded
 * "started without working days" orders as In production with no ETA and no
 * way to set one — working days were hidden because the baseline read locked.)
 */
export function isBaselineLocked(
  po: Pick<ProductionOrder, "initial_production_deadline">
): boolean {
  return !!po.initial_production_deadline;
}

/**
 * Return the **Initial Project Completion** — the canonical operational
 * reference for delay tracking.
 *
 * Solux semantics (revised May 2026):
 *
 *   - This is the date stamped at PRODUCTION ACTIVATION
 *     (deposit received OR start-without-deposit override), computed
 *     as `production_start_date + working_days`.
 *   - Before activation, it is NULL — there is NO meaningful projection
 *     of completion yet (the start date is unknown).
 *   - Once stamped, it is FROZEN. It is never recalculated. Any drift
 *     happens via `current_production_deadline`, never here.
 *
 * Implementation: we read the STORED `initial_production_deadline`
 * column rather than computing on the fly, so the frozen-once
 * guarantee holds even if start_date or working_days are edited later.
 *
 * (The OLD `validation_date + working_days` formula proved wrong: it
 * assumed production starts at validation, which is not the Solux
 * workflow — production starts only after deposit / override.)
 */
export function getInitialProjectCompletion(
  po: Pick<ProductionOrder, "initial_production_deadline">
): string | null {
  return po.initial_production_deadline ?? null;
}

/**
 * Hypothetical completion projection — "if production started TODAY
 * (or on the supplied start), when would it finish?". Useful for the
 * pre-activation UI to communicate "what we'd commit to if you started
 * production right now".
 *
 * NOT the same as the Initial Project Completion (which is the FROZEN
 * value stored at activation). This helper computes on the fly and
 * gives no commitment.
 */
export function projectCompletionFrom(
  startDateIso: string | null | undefined,
  workingDays: number | null | undefined
): string | null {
  if (!startDateIso) return null;
  if (workingDays == null || workingDays < 0) return null;
  return addWorkingDays(startDateIso, workingDays);
}

/**
 * Compute "where the Initial Project Completion would land if production
 * activated right now" — used by the activation actions
 * (recordPayments, startWithoutDeposit, setProductionTimeline) to
 * stamp `initial_production_deadline` AT THE MOMENT of activation.
 *
 * This is the WRITE path. Once stamped, callers should NEVER recompute
 * — use `getInitialProjectCompletion()` to read the frozen value.
 */
export function computeInitialProjectCompletionForActivation(
  po: Pick<
    ProductionOrder,
    | "deposit_received_at"
    | "deposit_override_at"
    | "production_working_days"
  >
): string | null {
  const start = getProductionStartDate(po);
  if (!start) return null;
  if (po.production_working_days == null || po.production_working_days < 0) {
    return null;
  }
  return addWorkingDays(start, po.production_working_days);
}

/* ===========================================================================
   Delay
   =========================================================================== */

/**
 * Compute the OPERATIONAL DELAY — how far the live deadline has drifted
 * from the FROZEN Initial Project Completion.
 *
 *   current_production_deadline − initial_production_deadline
 *
 * Positive = late vs. activation promise. Zero = on track. Negative =
 * ahead of schedule.
 *
 * Returns null until production is activated (no initial_production_deadline
 * stamped yet) — pre-activation has no commitment to drift against.
 *
 * NB: This is functionally identical to `computeProductionDelay` in
 * `lib/types.ts`, just exposed from the lifecycle module for clarity.
 * Both read `current − initial` on the production_orders row.
 */
export function computeBaselineDelay(
  po: Pick<
    ProductionOrder,
    "initial_production_deadline" | "current_production_deadline"
  >
): number | null {
  const initial = po.initial_production_deadline;
  const current = po.current_production_deadline;
  if (!initial || !current) return null;
  const initialMs = new Date(initial).getTime();
  const currentMs = new Date(current).getTime();
  if (!Number.isFinite(initialMs) || !Number.isFinite(currentMs)) return null;
  return Math.round((currentMs - initialMs) / (1000 * 60 * 60 * 24));
}

/* ===========================================================================
   State summary — used by the UI to pick which panel to render
   =========================================================================== */

export type ProductionLifecyclePhase =
  /** Baseline set but production hasn't started — waiting for deposit. */
  | "awaiting_start"
  /** Production active — live tracking with delay calc enabled. */
  | "in_production"
  /** Production marked complete — actual_completion_date stamped. */
  | "completed"
  /** Operationally dead (cancelled / archived). */
  | "closed";

/**
 * High-level lifecycle phase for a production order — drives the UI
 * branching between pre-start neutral, in-production live, completed,
 * and closed.
 */
export function getLifecyclePhase(
  po: Pick<
    ProductionOrder,
    | "deposit_received_at"
    | "deposit_override_at"
    | "actual_completion_date"
    | "status"
    | "archived_at"
  >
): ProductionLifecyclePhase {
  if (po.status === "cancelled" || po.archived_at) return "closed";
  // Status-led completion: the stamped date OR any completed-set status
  // (production_completed / shipment_booked / shipped / delivered) means done —
  // so a forward jump to shipped reads "completed" and the PO page stops
  // re-offering "Mark complete" (H5/M5).
  if (
    po.actual_completion_date ||
    (po.status != null && PRODUCTION_COMPLETED_STATUSES.includes(po.status))
  )
    return "completed";
  if (isProductionActive(po)) return "in_production";
  return "awaiting_start";
}
