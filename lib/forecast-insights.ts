/**
 * Forecast behavior analytics — pure functions (m158).
 *
 * Turns the immutable audit trail (forecast_audit_events) + the
 * current book (active forecasted deals, closed won/lost deals) into
 * the management views: probability reliability, close-date slippage,
 * per-rep behavior (optimism / conservatism), volatility.
 *
 * Everything here is pure — no DB access — so it unit-tests cleanly
 * and both the /forecast/insights page and any future export share the
 * exact same math.
 *
 * Probabilities are CONTROLLED values (10…90, 95, 100), so reliability
 * is computed per EXACT value — no ranges, no buckets.
 */

import { ALLOWED_PROBABILITIES, isForecastStale } from "./forecast.ts";
import type { ForecastDeal } from "./forecast.ts";
import type {
  ForecastAuditEvent,
  ClosedForecastDeal,
} from "./forecast-audit.ts";

/* ============================================================
   Probability at close
   ============================================================ */

/**
 * The probability a deal held WHEN it closed — the number the rep is
 * accountable for. Preferred source: the status-change audit event to
 * won/lost (its old_probability snapshot). Fallback: the probability
 * still stored on the closed document (pre-m158 history has no event).
 */
export function probabilityAtClose(
  deal: ClosedForecastDeal,
  events: ForecastAuditEvent[]
): number | null {
  // Events arrive newest-first; take the most recent close transition.
  const closeEvent = events.find(
    (e) =>
      e.documentId === deal.id &&
      e.field === "status" &&
      (e.newStatus === "won" || e.newStatus === "lost")
  );
  return closeEvent?.oldProbability ?? deal.probability;
}

/* ============================================================
   Probability reliability — win rate per exact value
   ============================================================ */

export type ProbabilityReliabilityRow = {
  probability: number;
  won: number;
  lost: number;
  closed: number;
  /** Actual win rate among closed deals marked at this value (0–1),
   *  null when nothing closed at this value yet. */
  winRate: number | null;
};

/**
 * "How many deals at 50% were actually won?" — one row per allowed
 * probability value, computed over closed deals using the probability
 * they held at close.
 */
export function probabilityReliability(
  closedDeals: ClosedForecastDeal[],
  events: ForecastAuditEvent[]
): ProbabilityReliabilityRow[] {
  const byValue = new Map<number, { won: number; lost: number }>();
  for (const p of ALLOWED_PROBABILITIES) byValue.set(p, { won: 0, lost: 0 });

  for (const d of closedDeals) {
    const p = probabilityAtClose(d, events);
    if (p == null) continue;
    const row = byValue.get(p);
    if (!row) continue; // legacy value that never got remapped — skip
    if (d.status === "won") row.won++;
    else row.lost++;
  }

  return Array.from(byValue.entries()).map(([probability, { won, lost }]) => ({
    probability,
    won,
    lost,
    closed: won + lost,
    winRate: won + lost > 0 ? won / (won + lost) : null,
  }));
}

/* ============================================================
   Close-date slippage
   ============================================================ */

export type SlippageStats = {
  /** Total number of "pushed later" close-date changes. */
  pushedLater: number;
  /** Number of "pulled earlier" changes (for context). */
  pulledEarlier: number;
  /** Deals with at least one push. */
  dealsWithSlippage: number;
};

/** A close-date change counts as slippage when the new date is LATER
 *  than the old one (the classic "next quarter, promise" pattern). */
export function computeSlippage(events: ForecastAuditEvent[]): SlippageStats {
  let pushedLater = 0;
  let pulledEarlier = 0;
  const slippedDocs = new Set<string>();
  for (const e of events) {
    if (e.field !== "expected_close_period") continue;
    if (!e.oldExpectedCloseDate || !e.newExpectedCloseDate) continue;
    if (e.newExpectedCloseDate > e.oldExpectedCloseDate) {
      pushedLater++;
      if (e.documentId) slippedDocs.add(e.documentId);
    } else if (e.newExpectedCloseDate < e.oldExpectedCloseDate) {
      pulledEarlier++;
    }
  }
  return {
    pushedLater,
    pulledEarlier,
    dealsWithSlippage: slippedDocs.size,
  };
}

/* ============================================================
   Per-rep behavior
   ============================================================ */

export type RepBehavior = {
  ownerId: string;
  /** Active forecasted deals right now. */
  activeDeals: number;
  /** Average probability across the rep's current active forecasts. */
  avgProbability: number | null;
  /** Average probability the rep's deals ENTERED the forecast at. */
  avgProbabilityAtCreation: number | null;
  /** Average probability the rep's deals held when they closed. */
  avgProbabilityBeforeClose: number | null;
  /** Probability edits per audited deal — forecast volatility. */
  probabilityChangesPerDeal: number | null;
  /** Close-date pushes (later) across the rep's deals. */
  slippageCount: number;
  /** Active forecasts not touched in 30+ days. */
  staleCount: number;
  wonCount: number;
  lostCount: number;
  /** Actual win rate over closed deals (0–1). */
  winRate: number | null;
  /**
   * Marked-vs-actual gap in probability points:
   * avgProbabilityBeforeClose − winRate×100. Positive = the rep marks
   * higher than they win (optimistic); negative = conservative.
   * Null until the rep has ≥ MIN_CLOSED_FOR_BIAS closed deals.
   */
  biasPoints: number | null;
  bias: "optimistic" | "conservative" | "balanced" | null;
};

export const MIN_CLOSED_FOR_BIAS = 3;
export const BIAS_THRESHOLD_POINTS = 15;

export function computeRepBehavior(
  activeDeals: ForecastDeal[],
  closedDeals: ClosedForecastDeal[],
  events: ForecastAuditEvent[]
): RepBehavior[] {
  const reps = new Set<string>();
  for (const d of activeDeals) if (d.ownerId) reps.add(d.ownerId);
  for (const d of closedDeals) if (d.ownerId) reps.add(d.ownerId);
  for (const e of events) if (e.ownerId) reps.add(e.ownerId);

  const out: RepBehavior[] = [];
  for (const ownerId of reps) {
    const active = activeDeals.filter(
      (d) => d.ownerId === ownerId && d.probability != null
    );
    const closed = closedDeals.filter((d) => d.ownerId === ownerId);
    const repEvents = events.filter((e) => e.ownerId === ownerId);

    const avgProbability = avg(active.map((d) => d.probability!));

    const creations = repEvents.filter(
      (e) => e.field === "created" && e.newProbability != null
    );
    const avgAtCreation = avg(creations.map((e) => e.newProbability!));

    const atClose = closed
      .map((d) => probabilityAtClose(d, events))
      .filter((p): p is number => p != null);
    const avgBeforeClose = avg(atClose);

    const probChanges = repEvents.filter((e) => e.field === "probability");
    const auditedDocs = new Set(
      repEvents.map((e) => e.documentId).filter(Boolean)
    );
    const changesPerDeal =
      auditedDocs.size > 0 ? probChanges.length / auditedDocs.size : null;

    const slippage = computeSlippage(repEvents).pushedLater;

    const staleCount = active.filter((d) =>
      isForecastStale(d.updatedAt, true)
    ).length;

    const wonCount = closed.filter((d) => d.status === "won").length;
    const lostCount = closed.length - wonCount;
    const winRate = closed.length > 0 ? wonCount / closed.length : null;

    let biasPoints: number | null = null;
    let bias: RepBehavior["bias"] = null;
    if (
      closed.length >= MIN_CLOSED_FOR_BIAS &&
      avgBeforeClose != null &&
      winRate != null
    ) {
      biasPoints = avgBeforeClose - winRate * 100;
      bias =
        biasPoints > BIAS_THRESHOLD_POINTS
          ? "optimistic"
          : biasPoints < -BIAS_THRESHOLD_POINTS
          ? "conservative"
          : "balanced";
    }

    out.push({
      ownerId,
      activeDeals: active.length,
      avgProbability,
      avgProbabilityAtCreation: avgAtCreation,
      avgProbabilityBeforeClose: avgBeforeClose,
      probabilityChangesPerDeal: changesPerDeal,
      slippageCount: slippage,
      staleCount,
      wonCount,
      lostCount,
      winRate,
      biasPoints,
      bias,
    });
  }

  // Most active books first.
  out.sort((a, b) => b.activeDeals - a.activeDeals);
  return out;
}

/* ============================================================
   Amount variation
   ============================================================ */

export type AmountVariationStats = {
  /** Number of amount-change events on audited deals. */
  changes: number;
  /** Sum of |new − old| across amount changes (face value, mixed
   *  currencies summed as-is — indicative, annotated in the UI). */
  totalAbsoluteChange: number;
};

export function computeAmountVariation(
  events: ForecastAuditEvent[]
): AmountVariationStats {
  let changes = 0;
  let totalAbsoluteChange = 0;
  for (const e of events) {
    if (e.field !== "amount") continue;
    if (e.oldAmount == null || e.newAmount == null) continue;
    changes++;
    totalAbsoluteChange += Math.abs(e.newAmount - e.oldAmount);
  }
  return { changes, totalAbsoluteChange };
}

/* ============================================================
   Helpers
   ============================================================ */

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}
