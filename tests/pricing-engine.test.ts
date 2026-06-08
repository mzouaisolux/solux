/**
 * Acceptance tests for the pricing engine (v4 — target-margin model).
 *
 * Run with:  npm test   (Node ≥ 22.6, built-in runner + native TS stripping)
 *
 * Locks in the EXACT numbers from the v4 build spec.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computePricing,
  round,
  toPriceCsvRows,
  priceChangePct,
  isLargeChange,
  isThinMargin,
  runSelfTest,
  DEFAULT_SETTINGS,
  DEFAULT_MARGINS,
} from "../lib/pricing-engine.ts";

const MARGINS = { targetMargin1: 0.38, targetMargin2: 0.36, targetMargin3: 0.25 };

test("SSLXPRO 30 — usdCost 210.20 and rebate 21.02", () => {
  const r = computePricing(1439.88, DEFAULT_SETTINGS, MARGINS);
  assert.equal(round(r.usdCost), 210.2);
  assert.equal(round(r.rebate), 21.02);
});

test("SSLXPRO 30 — tier prices 305.13 / 295.60 / 252.24", () => {
  const r = computePricing(1439.88, DEFAULT_SETTINGS, MARGINS);
  assert.equal(round(r.tier1.price), 305.13);
  assert.equal(round(r.tier2.price), 295.6);
  assert.equal(round(r.tier3.price), 252.24);
});

test("SSLXPRO 30 — after-tax margin $ (tier1 115.95, tier3 63.06)", () => {
  const r = computePricing(1439.88, DEFAULT_SETTINGS, MARGINS);
  assert.equal(round(r.tier1.marginValueAfterTax), 115.95);
  assert.equal(round(r.tier3.marginValueAfterTax), 63.06);
});

test("SSLXPRO 30 — after-tax margin % equals the target by construction", () => {
  const r = computePricing(1439.88, DEFAULT_SETTINGS, MARGINS);
  assert.ok(Math.abs(r.tier1.marginPctAfterTax - 0.38) < 1e-9);
  assert.ok(Math.abs(r.tier2.marginPctAfterTax - 0.36) < 1e-9);
  assert.ok(Math.abs(r.tier3.marginPctAfterTax - 0.25) < 1e-9);
});

test("SSLXPRO 30 — before-tax margin (tier1 ≈ 94.93 / 31.1%, tier2 ≈ 85.40)", () => {
  const r = computePricing(1439.88, DEFAULT_SETTINGS, MARGINS);
  assert.equal(round(r.tier1.marginValueBeforeTax), 94.93);
  assert.ok(Math.abs(r.tier1.marginPctBeforeTax - 0.311) < 0.001);
  // Spec states "≈ 85.40"; exact compute is 85.39 — allow the rounding slack.
  assert.ok(Math.abs(r.tier2.marginValueBeforeTax - 85.4) < 0.02);
});

test("cross-check vs old spreadsheet: m=0.40 → 315.30", () => {
  const r = computePricing(1439.88, DEFAULT_SETTINGS, {
    targetMargin1: 0.4,
    targetMargin2: 0.4,
    targetMargin3: 0.4,
  });
  assert.equal(round(r.tier1.price), 315.3);
});

test("lower target margin = lower price (tier3 is the cheapest)", () => {
  const r = computePricing(1439.88, DEFAULT_SETTINGS, MARGINS);
  assert.ok(r.tier1.price > r.tier2.price);
  assert.ok(r.tier2.price > r.tier3.price);
});

test("taxRebate lowers the price for the same target margin", () => {
  const withRebate = computePricing(1439.88, { exchangeRate: 6.85, taxRebate: 0.1 }, MARGINS);
  const noRebate = computePricing(1439.88, { exchangeRate: 6.85, taxRebate: 0 }, MARGINS);
  assert.ok(withRebate.tier1.price < noRebate.tier1.price);
  // No rebate, m=0.40 → 210.20 / 0.60 = 350.34 (vs 315.30 with rebate).
  const x = computePricing(1439.88, { exchangeRate: 6.85, taxRebate: 0 }, {
    targetMargin1: 0.4,
    targetMargin2: 0.4,
    targetMargin3: 0.4,
  });
  assert.equal(round(x.tier1.price), 350.34);
});

test("embedded self-test passes", () => {
  assert.doesNotThrow(() => runSelfTest(DEFAULT_SETTINGS, DEFAULT_MARGINS));
});

test("CSV export keeps the importPrices format (high/medium/low)", () => {
  const csv = toPriceCsvRows([{ sku: "SSLXPRO-30", costRmb: 1439.88 }], DEFAULT_SETTINGS, MARGINS, "2026-06-03");
  const lines = csv.split("\n");
  assert.equal(lines[0], "sku,pricing_tier,price,valid_from");
  assert.equal(lines[1], "SSLXPRO-30,high,305.13,2026-06-03");
  assert.equal(lines[2], "SSLXPRO-30,medium,295.6,2026-06-03");
  assert.equal(lines[3], "SSLXPRO-30,low,252.24,2026-06-03");
});

test("category-level margins produce category-specific prices (COLARSUN 42/38/30)", () => {
  // Same cost, different category margins → different selling prices.
  const colarsun = computePricing(1439.88, DEFAULT_SETTINGS, {
    targetMargin1: 0.42,
    targetMargin2: 0.38,
    targetMargin3: 0.3,
  });
  // 210.20 * 0.90 / (1 - 0.42) = 326.17
  assert.equal(round(colarsun.tier1.price), 326.17);
  assert.ok(Math.abs(colarsun.tier1.marginPctAfterTax - 0.42) < 1e-9);
  // A COLARSUN tier-1 (42%) must be priced higher than SSLX PRO tier-1 (38%).
  const sslx = computePricing(1439.88, DEFAULT_SETTINGS, MARGINS);
  assert.ok(colarsun.tier1.price > sslx.tier1.price);
});

test("bug-report acceptance: headline profit is AFTER-TAX (= typed target), not before-tax", () => {
  // Reproduces the reported screenshot: avg usdCost ≈ 186.14, rebate 0.10,
  // margins 40 / 25. The displayed "Average Profit" must use marginValueAfterTax
  // (price − usdCost + rebate) so profit/price equals the typed target margin.
  const costRmb = round(186.14 * DEFAULT_SETTINGS.exchangeRate, 2); // ≈ 1275.06
  const r = computePricing(costRmb, DEFAULT_SETTINGS, {
    targetMargin1: 0.4,
    targetMargin2: 0.25,
    targetMargin3: 0.25,
  });
  // Tier 1 @ 40% — correct headline figures
  assert.equal(round(r.tier1.price), 279.21);
  assert.equal(round(r.tier1.marginValueAfterTax), 111.68); // headline profit
  assert.ok(Math.abs(r.tier1.marginPctAfterTax - 0.4) < 1e-9); // shown margin == typed 40%
  // Tier 2 @ 25%
  assert.equal(round(r.tier2.price), 223.37);
  assert.equal(round(r.tier2.marginValueAfterTax), 55.84);
  assert.ok(Math.abs(r.tier2.marginPctAfterTax - 0.25) < 1e-9);
  // The OLD buggy (before-tax) figures — documented so the swap is unmistakable.
  assert.equal(round(r.tier1.marginValueBeforeTax), 93.07);
  assert.equal(round(r.tier2.marginValueBeforeTax), 37.23);
});

test("review + dashboard helpers", () => {
  assert.equal(priceChangePct(100, 110), 0.1);
  assert.equal(priceChangePct(null, 110), null);
  assert.equal(isLargeChange(100, 111), true);
  assert.equal(isLargeChange(100, 105), false);
  assert.equal(isThinMargin(0.18, 0.2), true);
  assert.equal(isThinMargin(0.25, 0.2), false);
});
