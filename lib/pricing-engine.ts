/**
 * Pricing engine v4 — pure, deterministic, zero side-effects.
 *
 * MODEL (v4): target-margin back-calculation.
 *   Each price list defines three AFTER-TAX target gross margins (one per
 *   volume tier). The selling price is back-calculated so the realised
 *   after-tax margin equals the target — the export tax rebate counts toward
 *   the target, so a higher rebate yields a LOWER price for the same target.
 *
 *     usdCost              = costRmb / exchangeRate
 *     rebate               = usdCost * taxRebate
 *     price                = usdCost * (1 - taxRebate) / (1 - m)
 *     marginValueAfterTax  = price - usdCost + rebate
 *     marginPctAfterTax    = m                       (exact, by construction)
 *     marginValueBeforeTax = price - usdCost         (derived / secondary)
 *     marginPctBeforeTax   = marginValueBeforeTax / price
 *
 *   Lower target margin → lower price, so tier 3 (e.g. 25%) is the cheapest
 *   (the volume discount).
 *
 * SEAM: computePricing only receives `costRmb`. A future BOM phase passes
 *   SUM(component.qty * component.unitPrice) here with zero downstream change.
 *
 * Acceptance (see tests/pricing-engine.test.ts):
 *   Global exchangeRate 6.85, taxRebate 0.10; margins 0.38/0.36/0.25.
 *   SSLXPRO 30, cost 1439.88 → usdCost 210.20, rebate 21.02
 *     tier1 38%: price 305.13, marginAfterTax$ 115.95, beforeTax ≈ 94.93 (≈31.1%)
 *     tier2 36%: price 295.60, beforeTax$ ≈ 85.40
 *     tier3 25%: price 252.24, marginAfterTax$ 63.06
 *   Cross-check: m=0.40 → 210.20 * 0.90 / 0.60 = 315.30 (old sheet's 40% price).
 */

export type PricingSettings = {
  exchangeRate: number; // RMB → USD
  taxRebate: number; // export rebate as a fraction of usdCost
};

export const DEFAULT_SETTINGS: PricingSettings = {
  exchangeRate: 6.85,
  taxRebate: 0.1,
};

/** Three AFTER-TAX target gross margins, one per volume tier, per price list. */
export type TargetMargins = {
  targetMargin1: number; // tier 1 — under 50 pcs
  targetMargin2: number; // tier 2 — 50–150 pcs
  targetMargin3: number; // tier 3 — over 150 pcs
};

export const DEFAULT_MARGINS: TargetMargins = {
  targetMargin1: 0.38,
  targetMargin2: 0.36,
  targetMargin3: 0.25,
};

/** Quantity tiers map to the existing prices_version tiers (high/medium/low). */
export type Tier = "tier1" | "tier2" | "tier3";
export const TIER_TO_PRICING_TIER: Record<Tier, "high" | "medium" | "low"> = {
  tier1: "high",
  tier2: "medium",
  tier3: "low",
};
export const TIER_LABEL: Record<Tier, string> = {
  tier1: "Tier 1 · under 50 pcs",
  tier2: "Tier 2 · 50–150 pcs",
  tier3: "Tier 3 · over 150 pcs",
};

export type TierResult = {
  price: number;
  marginValueAfterTax: number;
  marginPctAfterTax: number; // 0–1 fraction; equals the target margin m
  marginValueBeforeTax: number;
  marginPctBeforeTax: number; // 0–1 fraction
};

export type PricingResult = {
  costRmb: number;
  usdCost: number;
  rebate: number;
  tier1: TierResult;
  tier2: TierResult;
  tier3: TierResult;
};

function tierResult(usdCost: number, taxRebate: number, m: number): TierResult {
  const denom = 1 - m;
  const price = denom > 0 ? (usdCost * (1 - taxRebate)) / denom : 0;
  const rebate = usdCost * taxRebate;
  const marginValueAfterTax = price - usdCost + rebate;
  const marginValueBeforeTax = price - usdCost;
  return {
    price,
    marginValueAfterTax,
    // Exact by construction: (price - usdCost(1-taxRebate)) / price = m.
    marginPctAfterTax: price > 0 ? marginValueAfterTax / price : 0,
    marginValueBeforeTax,
    marginPctBeforeTax: price > 0 ? marginValueBeforeTax / price : 0,
  };
}

export function computePricing(
  costRmb: number,
  settings: PricingSettings,
  margins: TargetMargins
): PricingResult {
  const usdCost = costRmb / settings.exchangeRate;
  const rebate = usdCost * settings.taxRebate;
  return {
    costRmb,
    usdCost,
    rebate,
    tier1: tierResult(usdCost, settings.taxRebate, margins.targetMargin1),
    tier2: tierResult(usdCost, settings.taxRebate, margins.targetMargin2),
    tier3: tierResult(usdCost, settings.taxRebate, margins.targetMargin3),
  };
}

/** Round to N decimal places (for display / CSV export). */
export function round(n: number, decimals = 2): number {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

/** Format a fraction as a % string, e.g. 0.3111 → "31.11%". */
export function fmtPct(frac: number, decimals = 2): string {
  return `${(frac * 100).toFixed(decimals)}%`;
}

// --- thin-margin flagging (admin dashboard) ---------------------------------

/** Default after-tax margin below which an item is flagged thin (configurable). */
export const DEFAULT_THIN_MARGIN_THRESHOLD = 0.2;

export function isThinMargin(
  marginPctAfterTax: number,
  threshold = DEFAULT_THIN_MARGIN_THRESHOLD
): boolean {
  return marginPctAfterTax < threshold;
}

// --- publish-review helpers (diff vs currently live prices) ------------------

export const LARGE_CHANGE_THRESHOLD = 0.1;

/** Signed relative change oldPrice→newPrice; null when no comparable price. */
export function priceChangePct(
  oldPrice: number | null | undefined,
  newPrice: number
): number | null {
  if (oldPrice == null || oldPrice === 0) return null;
  return (newPrice - oldPrice) / oldPrice;
}

/** True when a change is large enough to flag (brand-new prices always flag). */
export function isLargeChange(
  oldPrice: number | null | undefined,
  newPrice: number,
  threshold = LARGE_CHANGE_THRESHOLD
): boolean {
  const pct = priceChangePct(oldPrice, newPrice);
  if (pct === null) return true;
  return Math.abs(pct) >= threshold;
}

// --- CSV export (backward-compat with the old upload format) -----------------

/**
 * Per-price-list CSV in the SAME format importPrices expects:
 *   sku, pricing_tier, price, valid_from
 * (pricing_tier is high/medium/low, mapped from tier1/2/3.)
 */
export function toPriceCsvRows(
  products: Array<{ sku: string; costRmb: number }>,
  settings: PricingSettings,
  margins: TargetMargins,
  validFrom: string // YYYY-MM-DD
): string {
  const header = "sku,pricing_tier,price,valid_from";
  const rows: string[] = [header];
  for (const p of products) {
    if (!p.sku || !p.costRmb) continue;
    const r = computePricing(p.costRmb, settings, margins);
    rows.push(`${p.sku},high,${round(r.tier1.price)},${validFrom}`);
    rows.push(`${p.sku},medium,${round(r.tier2.price)},${validFrom}`);
    rows.push(`${p.sku},low,${round(r.tier3.price)},${validFrom}`);
  }
  return rows.join("\n");
}

// =========================================================================
// Self-test — validates against the v4 acceptance numbers in the spec.
// =========================================================================

export function runSelfTest(
  settings = DEFAULT_SETTINGS,
  margins = DEFAULT_MARGINS
): string {
  const lines: string[] = [];
  let passed = 0;
  let failed = 0;

  const check = (label: string, ok: boolean, detail = "") => {
    if (ok) {
      passed++;
      lines.push(`✓ ${label}`);
    } else {
      failed++;
      lines.push(`✗ ${label}${detail ? ` — ${detail}` : ""}`);
    }
  };

  const r = computePricing(1439.88, settings, margins);
  check("SSLXPRO 30 usdCost 210.20", round(r.usdCost) === 210.2, `got ${round(r.usdCost)}`);
  check("SSLXPRO 30 rebate 21.02", round(r.rebate) === 21.02, `got ${round(r.rebate)}`);
  check("tier1 price 305.13", round(r.tier1.price) === 305.13, `got ${round(r.tier1.price)}`);
  check("tier2 price 295.60", round(r.tier2.price) === 295.6, `got ${round(r.tier2.price)}`);
  check("tier3 price 252.24", round(r.tier3.price) === 252.24, `got ${round(r.tier3.price)}`);
  check(
    "tier1 after-tax margin$ 115.95",
    round(r.tier1.marginValueAfterTax) === 115.95,
    `got ${round(r.tier1.marginValueAfterTax)}`
  );
  check(
    "tier3 after-tax margin$ 63.06",
    round(r.tier3.marginValueAfterTax) === 63.06,
    `got ${round(r.tier3.marginValueAfterTax)}`
  );

  // Cross-check vs the old spreadsheet: m=0.40 → 315.30.
  const x = computePricing(1439.88, settings, {
    targetMargin1: 0.4,
    targetMargin2: 0.4,
    targetMargin3: 0.4,
  });
  check("cross-check m=0.40 → 315.30", round(x.tier1.price) === 315.3, `got ${round(x.tier1.price)}`);

  const report = lines.join("\n") + `\n\nResults: ${passed} passed, ${failed} failed`;
  if (failed > 0) throw new Error(`Pricing engine self-test FAILED:\n${report}`);
  return report;
}
