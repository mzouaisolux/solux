/**
 * Tests for the logistics EXTRAS helpers (lib/logistics.ts): Insurance +
 * repeatable Additional Charges (ECTN / BESC / FERI / inspection…).
 *
 * Run with:  npm test
 *
 * Pure (no DB / no server imports). These feed BOTH the client total and the
 * server-recomputed total, so their arithmetic must be identical.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAdditionalCharges,
  totalAdditionalCharges,
  shippingExtrasTotal,
  insuranceFromRate,
  insuranceRateFromAmount,
} from "../lib/logistics.ts";

const near = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test("insuranceFromRate — Product Value × 1.10 × rate‰ (owner formula 2026-07-07)", () => {
  const pv = 100_000; // PRODUCTS ONLY (freight excluded)
  near(insuranceFromRate(pv, 1), 110); // 1‰   → 100000 × 1.1 × 0.001
  near(insuranceFromRate(pv, 0.5), 55); // 0.5‰ → 55
  near(insuranceFromRate(pv, 2), 220); // 2‰   → 220
});

test("insuranceFromRate — 0 / missing product value or rate → 0 (no insurance)", () => {
  assert.equal(insuranceFromRate(0, 1), 0);
  assert.equal(insuranceFromRate(100_000, 0), 0);
  assert.equal(insuranceFromRate(null, 1), 0);
  assert.equal(insuranceFromRate(100_000, undefined), 0);
  near(insuranceFromRate("50000", "1"), 55); // 50000 × 1.1 × 0.001 = 55 (strings)
});

test("insuranceRateFromAmount round-trips insuranceFromRate (incl. the 1.10 factor)", () => {
  const pv = 184_500;
  for (const rate of [1, 0.5, 2, 1.75]) {
    const amount = insuranceFromRate(pv, rate);
    near(insuranceRateFromAmount(amount, pv), rate);
  }
  assert.equal(insuranceRateFromAmount(100, 0), 0); // unknown product value → 0
  assert.equal(insuranceRateFromAmount(0, 100_000), 0); // no insurance → 0
});

test("spec example — ECTN / BESC / Inspection sum", () => {
  const charges = [
    { label: "ECTN", amount: 280 },
    { label: "BESC", amount: 190 },
    { label: "Inspection", amount: 75 },
  ];
  assert.equal(totalAdditionalCharges(charges), 545);
});

test("normalize trims labels, coerces amounts, drops fully-empty rows, keeps order", () => {
  const out = normalizeAdditionalCharges([
    { label: "  ECTN ", amount: "280" },
    { label: "", amount: "" }, // fully empty → dropped
    { label: "BESC", amount: 190 },
    { label: "FERI", amount: 0 }, // labelled, no amount yet → kept (amount 0)
  ]);
  assert.deepEqual(out, [
    { label: "ECTN", amount: 280 },
    { label: "BESC", amount: 190 },
    { label: "FERI", amount: 0 },
  ]);
});

test("normalize clamps negatives/NaN to 0", () => {
  const out = normalizeAdditionalCharges([
    { label: "Bad", amount: -50 },
    { label: "Junk", amount: "abc" },
  ]);
  assert.deepEqual(out, [
    { label: "Bad", amount: 0 },
    { label: "Junk", amount: 0 },
  ]);
});

test("shippingExtrasTotal = insurance + all charges", () => {
  const charges = [
    { label: "ECTN", amount: 280 },
    { label: "BESC", amount: 190 },
  ];
  assert.equal(shippingExtrasTotal(150, charges), 150 + 470);
  assert.equal(shippingExtrasTotal(0, charges), 470);
  assert.equal(shippingExtrasTotal(150, []), 150);
});

test("null / undefined inputs are safe (empty document)", () => {
  assert.equal(totalAdditionalCharges(null), 0);
  assert.equal(totalAdditionalCharges(undefined), 0);
  assert.deepEqual(normalizeAdditionalCharges(null), []);
  assert.equal(shippingExtrasTotal(null, null), 0);
  assert.equal(shippingExtrasTotal(undefined, undefined), 0);
});

test("decimals are preserved (USD 280.50) — unrounded, like totalFreight", () => {
  // The helper sums without rounding (display uses toFixed(2) / roundMoney),
  // so compare with a float tolerance rather than exact equality.
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);
  near(totalAdditionalCharges([{ amount: 280.5 }, { amount: 19.49 }]), 299.99);
  near(shippingExtrasTotal(0.01, [{ amount: 280.5 }]), 280.51);
});
