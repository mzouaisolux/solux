/**
 * Bank-charges tolerance tests (m175).
 *
 * Run with:  npm test   (Node ≥ 22.6, built-in runner + native TS stripping)
 *
 * Locks in the business rule: an incoming customer wire short by ≤ USD 45 is
 * treated as fully paid, the gap absorbed as BANK CHARGES (our expense), never
 * left as an outstanding customer receivable. A shortfall above 45 stays
 * outstanding and production stays gated.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  reconcilePaymentTranche,
  BANK_CHARGES_TOLERANCE,
  computeProductionPaymentState,
  type PaymentMode,
  type PaymentTerms,
} from "../lib/types.ts";

const MODE: PaymentMode = "deposit_balance";
const terms = (pct: number): PaymentTerms => ({
  deposit_percent: pct,
  balance_condition: "before_shipment",
});

/* ------------------------------------------------------------------ */
/* reconcilePaymentTranche                                             */
/* ------------------------------------------------------------------ */

test("tolerance constant is 45", () => {
  assert.equal(BANK_CHARGES_TOLERANCE, 45);
});

test("exact payment → covered, no charge, no debt", () => {
  const r = reconcilePaymentTranche(3000, 3000);
  assert.equal(r.covered, true);
  assert.equal(r.bankCharges, 0);
  assert.equal(r.outstanding, 0);
  assert.equal(r.shortfall, 0);
});

test("over-payment → covered, no charge, no debt", () => {
  const r = reconcilePaymentTranche(3000, 3050);
  assert.equal(r.covered, true);
  assert.equal(r.bankCharges, 0);
  assert.equal(r.outstanding, 0);
});

test("spec example: expected 3000, received 2985 (gap 15) → paid, 15 bank charges, 0 outstanding", () => {
  const r = reconcilePaymentTranche(3000, 2985);
  assert.equal(r.covered, true);
  assert.equal(r.bankCharges, 15);
  assert.equal(r.outstanding, 0);
  assert.equal(r.shortfall, 15);
});

test("boundary: gap of exactly 45 is still absorbed", () => {
  const r = reconcilePaymentTranche(3000, 2955);
  assert.equal(r.covered, true);
  assert.equal(r.bankCharges, 45);
  assert.equal(r.outstanding, 0);
});

test("just over: gap of 46 is outstanding, not a bank charge", () => {
  const r = reconcilePaymentTranche(3000, 2954);
  assert.equal(r.covered, false);
  assert.equal(r.bankCharges, 0);
  assert.equal(r.outstanding, 46);
});

test("spec example: expected 3000, received 2930 (gap 70) → not covered, 70 outstanding", () => {
  const r = reconcilePaymentTranche(3000, 2930);
  assert.equal(r.covered, false);
  assert.equal(r.bankCharges, 0);
  assert.equal(r.outstanding, 70);
});

test("unpaid tranche → not covered, full amount outstanding", () => {
  const r = reconcilePaymentTranche(3000, 0);
  assert.equal(r.covered, false);
  assert.equal(r.outstanding, 3000);
  assert.equal(r.bankCharges, 0);
});

test("expected 0 (no deposit / no balance) → trivially covered", () => {
  const r = reconcilePaymentTranche(0, 0);
  assert.equal(r.covered, true);
  assert.equal(r.bankCharges, 0);
  assert.equal(r.outstanding, 0);
});

test("sub-cent rounding grace: 0.0025 gap is not a bank charge", () => {
  // real order: balance 75% of 128510.39 = 96382.7925, received 96382.79
  const r = reconcilePaymentTranche(96382.7925, 96382.79);
  assert.equal(r.covered, true);
  assert.equal(r.bankCharges, 0);
  assert.equal(r.outstanding, 0);
});

test("real fractional shortfall rounds to 2dp", () => {
  const r = reconcilePaymentTranche(96382.7925, 96350);
  assert.equal(r.covered, true);
  assert.equal(r.bankCharges, 32.79);
  assert.equal(r.outstanding, 0);
});

/* ------------------------------------------------------------------ */
/* computeProductionPaymentState — tolerance propagation              */
/* ------------------------------------------------------------------ */

// total 4000, 25% terms → expected deposit 1000, expected balance 3000.
const state = (deposit: number, balance: number) =>
  computeProductionPaymentState({
    totalPrice: 4000,
    paymentMode: MODE,
    paymentTerms: terms(25),
    depositReceived: deposit,
    balanceReceived: balance,
  });

test("deposit short by ≤45 counts as received → deposit_received (production can start)", () => {
  assert.equal(state(985, 0), "deposit_received"); // gap 15
  assert.equal(state(955, 0), "deposit_received"); // gap 45 (boundary)
});

test("deposit short by >45 stays awaiting_deposit (production gated)", () => {
  assert.equal(state(950, 0), "awaiting_deposit"); // gap 50
});

test("balance short by ≤45 completes the order → paid_in_full", () => {
  assert.equal(state(1000, 2960), "paid_in_full"); // balance gap 40
  assert.equal(state(1000, 2955), "paid_in_full"); // balance gap 45
});

test("balance short by >45 with something received → partial_balance", () => {
  assert.equal(state(1000, 2930), "partial_balance"); // balance gap 70
});

test("both tranches fully paid → paid_in_full", () => {
  assert.equal(state(1000, 3000), "paid_in_full");
});
