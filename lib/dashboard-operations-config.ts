/**
 * Operations dashboard (V2 prototype) — THE RULEBOOK.
 *
 * Owner directive 2026-06-25 (calibration phase): the rules below WILL evolve
 * with real user feedback, so they live HERE as DATA — never hard-coded across
 * the components. This is the single place to tune, per operational signal:
 *   • label       — the human wording shown to the user
 *   • category    — Blocked / Action Required / At Risk
 *   • placement   — Today's Work column, Orders-in-flight card badge, or both
 *   • priority    — ordering within its column / band (higher = on top)
 *
 * Role visibility is the 5th lever; it already lives in the action-center
 * registry (ACTION_TYPES.roles) and is enforced per role by the engine, so we
 * don't duplicate it here — we reference it.
 *
 * Designed to graduate to a DB table + admin screen later WITHOUT touching the
 * components: same shape, just load it from the DB instead of this literal.
 * Pure data + pure helpers, zero server imports → node-testable.
 */

export type DashCategory = "blocked" | "action_required" | "at_risk";
/** Where a signal shows. "off" = hidden everywhere in the toggle. */
export type DashPlacement = "today" | "flight" | "both" | "off";

export type SignalRule = {
  label: string;
  category: DashCategory;
  placement: DashPlacement;
  priority: number;
};

/**
 * Keyed by the action-center `ActionKind` (kept as plain strings so this file
 * stays import-free and node-testable). To recalibrate the dashboard, edit
 * THIS table — nothing else.
 *
 * Placement rationale (first calibration, tune freely):
 *   - Pre-execution prep (validate / clarify / approve / create task list) →
 *     "today" only: it's work to GET a deal into execution, not the state of an
 *     order already in flight.
 *   - Execution exceptions (late / shipment / balance / deadline / BL / deposit)
 *     → "both": they're a to-do up top AND an attribute of the in-flight card.
 */
export const SIGNAL_RULES: Record<string, SignalRule> = {
  // ── Blocked — production is stuck / something is actively wrong ──
  production_late:        { label: "Production late",            category: "blocked",         placement: "both",  priority: 90 },
  shipment_blocked:       { label: "Shipment not booked",        category: "blocked",         placement: "both",  priority: 85 },
  balance_due:            { label: "Balance outstanding",        category: "blocked",         placement: "both",  priority: 80 },
  tl_clarify:             { label: "Task list returned to fix",  category: "blocked",         placement: "today", priority: 75 },

  // ── Action required — a clear to-do moves it forward ──
  tl_validate:            { label: "Task list to validate",      category: "action_required", placement: "today", priority: 70 },
  won_no_tasklist:        { label: "Create the task list",       category: "action_required", placement: "today", priority: 65 },
  missing_deadline:       { label: "Set production deadline",    category: "action_required", placement: "both",  priority: 60 },
  bl_missing_destination: { label: "Add shipping / BL info",     category: "action_required", placement: "both",  priority: 55 },
  doc_validate:           { label: "Quotation to approve",       category: "action_required", placement: "today", priority: 50 },

  // ── At risk — a timer is running, watch & nudge ──
  deposit:                { label: "Deposit follow-up",          category: "at_risk",         placement: "both",  priority: 40 },
  info:                   { label: "Update",                     category: "at_risk",         placement: "today", priority: 10 },

  // ── Disabled (placement "off" → hidden everywhere in the toggle) ──
  // Tenders / Prospects are still being designed and not mature enough; owner
  // asked (2026-06-25) to keep them OUT of the Operations toggle entirely —
  // no Today's Work, no card badge, no severity influence. Re-enable later by
  // giving it a real placement.
  tender_stalled:         { label: "Tender needs a next step",   category: "at_risk",         placement: "off",   priority: 30 },
};

/** Fallback for any unmapped signal — surfaces it rather than dropping it. */
export const DEFAULT_RULE: SignalRule = {
  label: "Action needed",
  category: "action_required",
  placement: "today",
  priority: 20,
};

export function ruleFor(kind: string): SignalRule {
  return SIGNAL_RULES[kind] ?? DEFAULT_RULE;
}

/** Presentation for each category — labels + accents in ONE place too. */
export const CATEGORY_META: Record<
  DashCategory,
  { label: string; help: string; dot: string; head: string; ring: string }
> = {
  blocked: {
    label: "Blocked",
    help: "Stuck or actively wrong — handle now.",
    dot: "bg-rose-500",
    head: "text-rose-700",
    ring: "ring-rose-200",
  },
  action_required: {
    label: "Action required",
    help: "A clear to-do will move it forward.",
    dot: "bg-amber-500",
    head: "text-amber-700",
    ring: "ring-amber-200",
  },
  at_risk: {
    label: "At risk",
    help: "A timer is running — watch & nudge.",
    dot: "bg-sky-500",
    head: "text-sky-700",
    ring: "ring-sky-200",
  },
};

/** Category → the tone used by Orders-in-flight exception badges. */
export function categoryTone(c: DashCategory): "danger" | "warn" | "info" {
  return c === "blocked" ? "danger" : c === "action_required" ? "warn" : "info";
}

/**
 * Orders-in-flight FILTER / GROUPING dimensions. Operations handles orders
 * from many commercials, so v1 ships "owner" (commercial). Team & region are
 * declared but disabled until their data is wired — enabling them later is just
 * `enabled: true` + a value resolver, no structural change. This is the
 * extension point the owner asked us to design in now (2026-06-25).
 */
export type FilterDimension = { key: string; label: string; enabled: boolean };

export const OPS_FILTER_DIMENSIONS: FilterDimension[] = [
  { key: "owner", label: "Commercial", enabled: true },
  { key: "team", label: "Sales team", enabled: false },
  { key: "region", label: "Region", enabled: false },
];
