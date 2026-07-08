/**
 * Tests for the profitability waterfall replay.
 * (lib/profitability-history.ts)
 *
 * Run with:  npm test
 *
 * Pure. Locks the backward-replay mechanism: starting from the CURRENT state,
 * each dated old→new record is undone newest→oldest, margins recomputed at
 * every step, list reversed — reproducing the owner's mockup
 * (27% ↓ 24% Customer Discount ↓ 21% Transport Updated …).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildWaterfall,
  editPoint,
  factoryCostPoint,
  overallPctOf,
  shippingUpdatePoint,
  versionPoint,
  type MoneyState,
} from "../lib/profitability-history.ts";

/** A healthy current state: goods 10k engine-revenue, 6k cost, rebate 10%. */
const CURRENT: MoneyState = {
  productEngineRevenue: 10000,
  poleEngineRevenue: 0,
  productUsdCost: 6000,
  poleUsdCost: null,
  freightRevenue: 800, // pass-through by company rule (never margin)
  insurance: 0,
  charges: 0,
  commission: 0,
  unclassifiedRevenue: 0,
  taxRebate: 0.1,
};
// margin = 10000 − 6000·0.9 = 4600 ; GT = 10800 → 42.59%

test("overallPctOf: algebra matches the engine (rebate credited, pass-through dilutes)", () => {
  const pct = overallPctOf(CURRENT)!;
  assert.ok(Math.abs(pct - (4600 / 10800) * 100) < 1e-9);
});

test("waterfall: mockup shape — discount then transport increase, chronological with deltas", () => {
  // History (oldest→newest):
  //   V1 initial → revised V2 (customer discount: engine revenue 12k → 10k)
  //   → shipping update (freight 500 → 800, pass-through revenue+cost)
  const points = [
    versionPoint({
      at: "2026-07-01T10:00:00Z",
      version: 2,
      previousSelling: {
        productEngineRevenue: 12000,
        poleEngineRevenue: 0,
        freightRevenue: 500,
        insurance: 0,
        charges: 0,
        commission: 0,
        unclassifiedRevenue: 0,
      },
    }),
    shippingUpdatePoint({
      completed_at: "2026-07-05T09:00:00Z",
      previous_freight_cost: 500,
      new_freight_cost: 800,
      previous_insurance_cost: 0,
      new_insurance_cost: 0,
      reason: "rate season",
    }),
  ];
  const steps = buildWaterfall(CURRENT, points);
  assert.equal(steps.length, 3); // initial + 2 points
  assert.equal(steps[0].cause, "initial");
  assert.equal(steps[1].cause, "revised");
  assert.equal(steps[2].cause, "shipping_update");
  assert.match(steps[2].detail, /rate season/);

  // Initial state: engine 12k, cost 6000, freight 500 pass-through:
  //   margin 12000−5400=6600 ; GT 12500 → 52.8%
  assert.ok(Math.abs(steps[0].overallPct! - 52.8) < 0.01);
  // After discount (V2): engine 10k, freight still 500:
  //   4600/10500 → 43.81%
  assert.ok(Math.abs(steps[1].overallPct! - (4600 / 10500) * 100) < 0.01);
  // After transport update: current → 42.59%
  assert.ok(Math.abs(steps[2].overallPct! - (4600 / 10800) * 100) < 0.01);

  // Deltas are negative on both drops, null on the first step.
  assert.equal(steps[0].deltaPct, null);
  assert.ok(steps[1].deltaPct! < 0);
  assert.ok(steps[2].deltaPct! < 0);
});

test("factory cost change replays through the rebate-adjusted margin", () => {
  const points = [
    factoryCostPoint({
      changed_at: "2026-07-02T00:00:00Z",
      field: "product_cost_rmb",
      oldUsdAggregate: 5000, // cost used to be lower → margin used to be higher
      reason: "director override",
    }),
  ];
  const steps = buildWaterfall(CURRENT, points);
  // Before the change: margin 10000−4500=5500 / 10800 → 50.93%
  assert.ok(Math.abs(steps[0].overallPct! - (5500 / 10800) * 100) < 0.01);
  assert.ok(steps[1].deltaPct! < 0);
  assert.match(steps[1].detail, /director override/);
});

test("edit point scales goods proportionally, pass-throughs untouched", () => {
  const points = [
    editPoint({
      at: "2026-07-03T00:00:00Z",
      oldGrandTotal: 12800, // goods were 12000 (freight 800 constant)
      newGrandTotal: 10800,
    }),
  ];
  const steps = buildWaterfall(CURRENT, points);
  // Undone state: engine 12000, cost unchanged 6000 → 6600/12800 = 51.56%
  assert.ok(Math.abs(steps[0].overallPct! - (6600 / 12800) * 100) < 0.01);
});

test("cap keeps the newest points; older history collapses into the initial step", () => {
  const mk = (i: number) =>
    editPoint({
      at: `2026-06-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      oldGrandTotal: 10800 + (i + 1) * 100,
      newGrandTotal: 10800 + i * 100,
    });
  const points = Array.from({ length: 40 }, (_, i) => mk(i));
  const steps = buildWaterfall(CURRENT, points, 30);
  assert.equal(steps.length, 31); // initial + 30 kept
});

test("unknown costs stay honest: pct is null at every step", () => {
  const noCost: MoneyState = { ...CURRENT, productUsdCost: null };
  const steps = buildWaterfall(noCost, [
    shippingUpdatePoint({
      completed_at: "2026-07-05T00:00:00Z",
      previous_freight_cost: 500,
      new_freight_cost: 800,
      previous_insurance_cost: null,
      new_insurance_cost: null,
    }),
  ]);
  assert.equal(steps[0].overallPct, null);
  assert.equal(steps[1].overallPct, null);
  assert.equal(steps[1].deltaPct, null);
});
