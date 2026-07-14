import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSectionPrice, sellingPriceToMarginPct } from "../lib/project-pricing.ts";

const ENV = { exchangeRate: 7, taxRebate: 0.13 };

test("round-trip: margin → price → margin (no commission)", () => {
  const p = computeSectionPrice({ costRmb: 4480, marginPct: 30, commissionPct: 0, ...ENV });
  const back = sellingPriceToMarginPct({ costRmb: 4480, sellingUnitPrice: p.finalUnitPrice, commissionPct: 0, ...ENV });
  assert.ok(Math.abs(back - 30) < 0.01, `expected ~30, got ${back}`);
});

test("round-trip with commission", () => {
  const p = computeSectionPrice({ costRmb: 4480, marginPct: 25, commissionPct: 8, ...ENV });
  const back = sellingPriceToMarginPct({ costRmb: 4480, sellingUnitPrice: p.finalUnitPrice, commissionPct: 8, ...ENV });
  assert.ok(Math.abs(back - 25) < 0.01, `expected ~25, got ${back}`);
});

test("typing a selling price yields a price that reproduces it", () => {
  // Director wants to sell at $800/unit; convert to margin, recompute → ~800.
  const m = sellingPriceToMarginPct({ costRmb: 4480, sellingUnitPrice: 800, commissionPct: 0, ...ENV });
  const p = computeSectionPrice({ costRmb: 4480, marginPct: m, commissionPct: 0, ...ENV });
  assert.ok(Math.abs(p.finalUnitPrice - 800) < 0.5, `expected ~800, got ${p.finalUnitPrice}`);
});

test("selling at/below cost floors margin at 0 (never negative)", () => {
  const usdCost = 4480 / 7; // 640
  const m = sellingPriceToMarginPct({ costRmb: 4480, sellingUnitPrice: usdCost * 0.5, commissionPct: 0, ...ENV });
  assert.equal(m, 0);
});

test("zero / missing inputs are safe (no NaN)", () => {
  assert.equal(sellingPriceToMarginPct({ costRmb: 0, sellingUnitPrice: 800, ...ENV }), 0);
  assert.equal(sellingPriceToMarginPct({ costRmb: 4480, sellingUnitPrice: 0, ...ENV }), 0);
  assert.equal(sellingPriceToMarginPct({ costRmb: 4480, sellingUnitPrice: 800, exchangeRate: 0, taxRebate: 0.13 }), 0);
});
