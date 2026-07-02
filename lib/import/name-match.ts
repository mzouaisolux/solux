/**
 * Historical Invoice Import — PURE customer-name verification.
 *
 * Because the import is launched FROM a specific customer, we never search for
 * the right customer — we only VERIFY that the name detected on the PDF plausibly
 * belongs to the open customer. The spec's examples must all match "ARLUX":
 *   Arlux · ARLUX SAS · Arlux Lighting  → match
 *   a completely different company        → mismatch → "import anyway / skip"
 */

import {
  companyCoreTokens,
  tokenSetDice,
  similarityRatio,
} from "./normalize.ts";

export type NameMatch = {
  /** 0..1 confidence that `detected` is the same company as `expected`. */
  score: number;
  matches: boolean;
  reason: "empty" | "core_equal" | "core_subset" | "fuzzy" | "mismatch";
};

const DEFAULT_THRESHOLD = 0.8;

/**
 * Compare a detected customer name against the expected (open) customer.
 *
 * Strategy (most-confident first):
 *   1. Equal core-token sets (after dropping legal suffixes + generic industry
 *      words) → exact company match. Handles "ARLUX SAS" vs "Arlux Lighting".
 *   2. One core-token set is a non-empty subset of the other → same company
 *      with extra qualifiers ("Arlux" ⊂ "Arlux Benin").
 *   3. Otherwise a blended fuzzy score (token overlap + edit-distance ratio).
 */
export function matchCustomerName(
  detected: string | null | undefined,
  expected: string | null | undefined,
  threshold: number = DEFAULT_THRESHOLD
): NameMatch {
  const d = String(detected ?? "").trim();
  const e = String(expected ?? "").trim();
  if (!d || !e) {
    // No detected name → cannot verify. Treat as needs-attention, not a hard
    // mismatch (the file may simply lack a printed customer name).
    return { score: 0, matches: false, reason: "empty" };
  }

  const dCore = companyCoreTokens(d);
  const eCore = companyCoreTokens(e);

  const dSet = new Set(dCore);
  const eSet = new Set(eCore);

  // 1. Equal core sets → certain match.
  if (dSet.size > 0 && eSet.size > 0 && setsEqual(dSet, eSet)) {
    return { score: 1, matches: true, reason: "core_equal" };
  }

  // 2. Subset relationship → very likely the same company.
  if (dSet.size > 0 && eSet.size > 0 && (isSubset(dSet, eSet) || isSubset(eSet, dSet))) {
    return { score: 0.95, matches: true, reason: "core_subset" };
  }

  // 3. Blended fuzzy score over the CORE tokens (falls back to the full
  //    normalized string ratio so single-token typos still register).
  const dice = tokenSetDice(dCore, eCore);
  const ratio = similarityRatio(dCore.join(" ") || d, eCore.join(" ") || e);
  const score = Math.max(dice, ratio);
  return {
    score,
    matches: score >= threshold,
    reason: score >= threshold ? "fuzzy" : "mismatch",
  };
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function isSubset(small: Set<string>, big: Set<string>): boolean {
  if (small.size === 0 || small.size > big.size) return false;
  for (const x of small) if (!big.has(x)) return false;
  return true;
}
