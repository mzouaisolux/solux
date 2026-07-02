/**
 * Historical Invoice Import — PURE product matching core.
 *
 * Given an invoice line and the catalog (+ remembered mappings), decide how to
 * link it. Precedence mirrors the codebase's layered resolvers
 * (resolveFactoryInstruction): remembered mapping > exact SKU > exact name >
 * fuzzy > unmatched. The DB fetch lives in a thin server wrapper; this fn is
 * pure so it is unit-testable and reusable.
 */

import { normalizeBasic, productNameKey, similarityRatio } from "./normalize.ts";

export type ProductCandidate = {
  id: string;
  name: string;
  sku: string | null;
  categoryId: string | null;
  categoryName: string | null;
  isLegacy?: boolean;
};

export type MappingEntry = {
  action: "map" | "legacy" | "ignore";
  productId: string | null;
};

export type MatchMethod =
  | "exact_sku"
  | "exact_name"
  | "fuzzy"
  | "manual"
  | "legacy"
  | "ignored"
  | "unmatched";

export type LineMatch = {
  productId: string | null;
  matchedName: string | null;
  method: MatchMethod;
  score: number; // 0..1
  needsReview: boolean;
  /** Best suggestion to surface in the "Unknown product" resolver, if any. */
  suggestion: { id: string; name: string; score: number } | null;
};

/** Auto-link a fuzzy match at/above this score; below it, ask the user. */
export const FUZZY_AUTOLINK = 0.9;
/** Only surface a suggestion in the resolver above this floor. */
export const SUGGESTION_FLOOR = 0.55;

export function matchProductLine(
  description: string,
  code: string | null,
  candidates: ProductCandidate[],
  mappings: Map<string, MappingEntry>
): LineMatch {
  const key = productNameKey(description);

  // 1. Remembered mapping (already resolved by a human on a prior import).
  const mapped = mappings.get(key);
  if (mapped) {
    if (mapped.action === "ignore") {
      return { productId: null, matchedName: null, method: "ignored", score: 1, needsReview: false, suggestion: null };
    }
    if (mapped.action === "legacy") {
      const p = mapped.productId ? candidates.find((c) => c.id === mapped.productId) : null;
      return {
        productId: mapped.productId,
        matchedName: p?.name ?? null,
        method: "legacy",
        score: 1,
        needsReview: false,
        suggestion: null,
      };
    }
    // action === "map"
    const p = mapped.productId ? candidates.find((c) => c.id === mapped.productId) : null;
    return {
      productId: mapped.productId,
      matchedName: p?.name ?? null,
      method: "manual",
      score: 1,
      needsReview: false,
      suggestion: null,
    };
  }

  // 2. Exact SKU (case-insensitive) — strongest catalog signal.
  const codeKey = code ? normalizeBasic(code) : "";
  if (codeKey) {
    const bySku = candidates.find(
      (c) => c.sku && normalizeBasic(c.sku) === codeKey && !c.isLegacy
    );
    if (bySku) {
      return { productId: bySku.id, matchedName: bySku.name, method: "exact_sku", score: 1, needsReview: false, suggestion: null };
    }
  }
  // ...also try the description itself as a SKU (invoices often print the code
  // inside the description string).
  const bySkuInDesc = candidates.find(
    (c) => c.sku && normalizeBasic(c.sku) === key && !c.isLegacy
  );
  if (bySkuInDesc) {
    return { productId: bySkuInDesc.id, matchedName: bySkuInDesc.name, method: "exact_sku", score: 1, needsReview: false, suggestion: null };
  }

  // 3. Exact normalized name.
  const byName = candidates.find((c) => productNameKey(c.name) === key && !c.isLegacy);
  if (byName) {
    return { productId: byName.id, matchedName: byName.name, method: "exact_name", score: 1, needsReview: false, suggestion: null };
  }

  // 4. Fuzzy — best similarity over active catalog names.
  let best: { id: string; name: string; score: number } | null = null;
  for (const c of candidates) {
    if (c.isLegacy) continue;
    const s = similarityRatio(description, c.name);
    if (!best || s > best.score) best = { id: c.id, name: c.name, score: s };
  }

  if (best && best.score >= FUZZY_AUTOLINK) {
    return { productId: best.id, matchedName: best.name, method: "fuzzy", score: best.score, needsReview: false, suggestion: best };
  }

  // 5. Unmatched → the user resolves (match / legacy / ignore).
  return {
    productId: null,
    matchedName: null,
    method: "unmatched",
    score: best ? best.score : 0,
    needsReview: true,
    suggestion: best && best.score >= SUGGESTION_FLOOR ? best : null,
  };
}
