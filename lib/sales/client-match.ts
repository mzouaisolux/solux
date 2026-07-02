/**
 * Sales & Analytics — fuzzy client matching for the in-module dedup queue (§4).
 *
 * Reuses the tested, dependency-free similarity primitives already shipped for
 * the historical-invoice import (lib/import/name-match.ts) so there is ONE
 * company-name matcher in the codebase, not two.
 *
 * Bands (NEVER auto-merge — §4 forbids it; the matcher only ROUTES):
 *   "same"     core token sets equal/subset after dropping legal + generic
 *              industry words → confidently the same company
 *              (e.g. "International light factory" ↔ "International Lighting
 *              Factory", both cores = {factory}). Surfaced as a strong merge
 *              suggestion, still never fused automatically.
 *   "similar"  blended fuzzy score ≥ threshold but cores differ → proposed for
 *              human review.
 *   "distinct" below threshold → a separate client
 *              (e.g. "ANL LIGHTING" vs "ANDI LIGHTING, LLC" — different firms).
 *
 * NB: the 6 residual historical suggestions come pre-scored in
 * merge_suggestions.csv and are loaded into the queue verbatim; this matcher is
 * the deliberately-conservative guard for NEW entries / import collisions.
 */

import { matchCustomerName } from "../import/name-match.ts";

export const CLIENT_MATCH_THRESHOLD = 0.86;

export type ClientBand = "same" | "similar" | "distinct";

export type ClientNameComparison = {
  score: number; // 0..1
  band: ClientBand;
};

export function compareClientNames(
  a: string | null | undefined,
  b: string | null | undefined,
  threshold: number = CLIENT_MATCH_THRESHOLD,
): ClientNameComparison {
  const m = matchCustomerName(a, b, threshold);
  if (m.reason === "core_equal" || m.reason === "core_subset") {
    return { score: m.score, band: "same" };
  }
  if (m.score >= threshold) return { score: m.score, band: "similar" };
  return { score: m.score, band: "distinct" };
}

export type ClientCandidate = { id: string; code: string; name: string };
export type BestMatch = {
  candidate: ClientCandidate;
  comparison: ClientNameComparison;
};

/**
 * Best (highest-scoring) candidate for `name` among `candidates`, or null when
 * none is even "similar". NEVER decides a merge — the caller routes a
 * "same"/"similar" result into the human validation queue.
 */
export function bestClientMatch(
  name: string,
  candidates: readonly ClientCandidate[],
  threshold: number = CLIENT_MATCH_THRESHOLD,
): BestMatch | null {
  let best: BestMatch | null = null;
  for (const c of candidates) {
    const comparison = compareClientNames(name, c.name, threshold);
    if (comparison.band === "distinct") continue;
    if (!best || comparison.score > best.comparison.score) {
      best = { candidate: c, comparison };
    }
  }
  return best;
}
