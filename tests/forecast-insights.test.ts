/**
 * Forecast standardized probabilities + behavior analytics (m158).
 *
 * Covers the controlled-values model (10…90, 95, 100 — nothing else),
 * the weighted math from the spec, and the pure analytics that power
 * /forecast/insights (reliability, slippage, per-rep behavior).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED_PROBABILITIES,
  isAllowedProbability,
  weightedValue,
  forecastByProbability,
  type ForecastDeal,
} from "../lib/forecast.ts";
import {
  probabilityAtClose,
  probabilityReliability,
  computeSlippage,
  computeRepBehavior,
  computeAmountVariation,
} from "../lib/forecast-insights.ts";
import type {
  ForecastAuditEvent,
  ClosedForecastDeal,
} from "../lib/forecast-audit.ts";

/* ---------- factories ---------- */

const deal = (p: Partial<ForecastDeal>): ForecastDeal => ({
  id: "d1",
  number: "Q-1",
  clientName: "ACME",
  status: "sent",
  total: 100_000,
  currency: "USD",
  probability: 50,
  expectedCloseDate: null,
  updatedAt: new Date().toISOString(),
  ownerId: "rep1",
  country: "Benin",
  productFamily: null,
  version: 1,
  rootId: null,
  ...p,
});

const closed = (p: Partial<ClosedForecastDeal>): ClosedForecastDeal => ({
  id: "c1",
  number: "Q-9",
  status: "won",
  total: 50_000,
  currency: "USD",
  probability: 90,
  ownerId: "rep1",
  expectedCloseDate: null,
  ...p,
});

const event = (p: Partial<ForecastAuditEvent>): ForecastAuditEvent => ({
  id: Math.random().toString(36).slice(2),
  createdAt: "2026-07-01T00:00:00Z",
  documentId: "d1",
  quotationNumber: "Q-1",
  affairId: null,
  projectName: null,
  clientId: null,
  clientName: "ACME",
  country: "Benin",
  currency: "USD",
  ownerId: "rep1",
  changedBy: "rep1",
  changedByRole: "sales",
  changeSource: "manual_edit",
  field: "probability",
  oldValue: null,
  newValue: null,
  oldProbability: null,
  newProbability: null,
  oldExpectedCloseDate: null,
  newExpectedCloseDate: null,
  oldAmount: null,
  newAmount: null,
  oldWeighted: null,
  newWeighted: null,
  oldStatus: null,
  newStatus: null,
  ...p,
});

/* ---------- controlled probability values ---------- */

test("only the 11 standard probability values are allowed", () => {
  assert.deepEqual(
    [...ALLOWED_PROBABILITIES],
    [10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100]
  );
  for (const p of ALLOWED_PROBABILITIES) assert.ok(isAllowedProbability(p));
  // The old ladder values 25/75 and free values are rejected.
  for (const bad of [0, 5, 25, 33, 45, 67, 75, 99, 101]) {
    assert.equal(isAllowedProbability(bad), false, `${bad} must be rejected`);
  }
});

test("weighted amount = estimated amount × probability (spec examples)", () => {
  assert.equal(weightedValue(100_000, 50), 50_000);
  assert.equal(weightedValue(100_000, 90), 90_000);
  assert.equal(weightedValue(100_000, 95), 95_000);
  assert.equal(weightedValue(100_000, null), 0);
});

test("forecastByProbability groups by exact value, ascending (95 before 100)", () => {
  const buckets = forecastByProbability([
    deal({ id: "a", probability: 100, total: 10 }),
    deal({ id: "b", probability: 10, total: 20 }),
    deal({ id: "c", probability: 95, total: 30 }),
    deal({ id: "d", probability: 10, total: 40 }),
    deal({ id: "e", probability: null }),
  ]);
  assert.deepEqual(
    buckets.map((b) => b.label),
    ["10%", "95%", "100%"]
  );
  const at10 = buckets[0];
  assert.equal(at10.count, 2);
  assert.equal(at10.raw, 60);
  assert.equal(at10.weighted, 6); // 20×10% + 40×10%
});

/* ---------- probability at close & reliability ---------- */

test("probabilityAtClose prefers the status-event snapshot over the stored value", () => {
  const d = closed({ id: "x", probability: 50 });
  const evts = [
    event({
      documentId: "x",
      field: "status",
      newStatus: "won",
      oldProbability: 80,
    }),
  ];
  assert.equal(probabilityAtClose(d, evts), 80);
  // No event → fall back to the value still on the document.
  assert.equal(probabilityAtClose(d, []), 50);
});

test("probabilityReliability counts won/lost per exact value", () => {
  const deals = [
    closed({ id: "a", status: "won", probability: 80 }),
    closed({ id: "b", status: "lost", probability: 80 }),
    closed({ id: "c", status: "lost", probability: 80 }),
    closed({ id: "d", status: "won", probability: 95 }),
  ];
  const rows = probabilityReliability(deals, []);
  const at80 = rows.find((r) => r.probability === 80)!;
  assert.equal(at80.won, 1);
  assert.equal(at80.lost, 2);
  assert.ok(Math.abs(at80.winRate! - 1 / 3) < 1e-9);
  const at95 = rows.find((r) => r.probability === 95)!;
  assert.equal(at95.winRate, 1);
  // Values nothing closed at yet stay null (not 0%).
  const at10 = rows.find((r) => r.probability === 10)!;
  assert.equal(at10.winRate, null);
});

/* ---------- slippage ---------- */

test("computeSlippage counts pushes later vs pulls earlier, per deal", () => {
  const evts = [
    event({
      documentId: "d1",
      field: "expected_close_period",
      oldExpectedCloseDate: "2026-06-30",
      newExpectedCloseDate: "2026-09-30", // pushed later
    }),
    event({
      documentId: "d1",
      field: "expected_close_period",
      oldExpectedCloseDate: "2026-09-30",
      newExpectedCloseDate: "2026-12-31", // pushed again
    }),
    event({
      documentId: "d2",
      field: "expected_close_period",
      oldExpectedCloseDate: "2026-06-30",
      newExpectedCloseDate: "2026-05-31", // pulled earlier
    }),
    event({ documentId: "d3", field: "probability" }), // unrelated
  ];
  const s = computeSlippage(evts);
  assert.equal(s.pushedLater, 2);
  assert.equal(s.pulledEarlier, 1);
  assert.equal(s.dealsWithSlippage, 1); // both pushes on the same deal
});

/* ---------- per-rep behavior ---------- */

test("optimistic rep: marks 90 but wins 1 of 4 → flagged optimistic", () => {
  const closedDeals = [
    closed({ id: "w1", ownerId: "opt", status: "won", probability: 90 }),
    closed({ id: "l1", ownerId: "opt", status: "lost", probability: 90 }),
    closed({ id: "l2", ownerId: "opt", status: "lost", probability: 90 }),
    closed({ id: "l3", ownerId: "opt", status: "lost", probability: 90 }),
  ];
  const reps = computeRepBehavior([], closedDeals, []);
  const rep = reps.find((r) => r.ownerId === "opt")!;
  assert.equal(rep.winRate, 0.25);
  assert.equal(rep.avgProbabilityBeforeClose, 90);
  // 90 marked − 25 actual = +65 pts → optimistic
  assert.equal(rep.bias, "optimistic");
  assert.ok(rep.biasPoints! > 15);
});

test("conservative rep: marks 40 but wins everything → flagged conservative", () => {
  const closedDeals = [
    closed({ id: "w1", ownerId: "cons", status: "won", probability: 40 }),
    closed({ id: "w2", ownerId: "cons", status: "won", probability: 40 }),
    closed({ id: "w3", ownerId: "cons", status: "won", probability: 40 }),
  ];
  const reps = computeRepBehavior([], closedDeals, []);
  const rep = reps.find((r) => r.ownerId === "cons")!;
  assert.equal(rep.winRate, 1);
  // 40 marked − 100 actual = −60 pts → conservative
  assert.equal(rep.bias, "conservative");
});

test("bias needs 3+ closed deals; volatility and stale are computed", () => {
  const active = [
    deal({ id: "a1", ownerId: "rep1", probability: 50 }),
    deal({
      id: "a2",
      ownerId: "rep1",
      probability: 60,
      updatedAt: "2020-01-01T00:00:00Z", // ancient → stale
    }),
  ];
  const closedDeals = [
    closed({ id: "c9", ownerId: "rep1", status: "won", probability: 50 }),
  ];
  const evts = [
    event({ documentId: "a1", ownerId: "rep1", field: "probability" }),
    event({ documentId: "a1", ownerId: "rep1", field: "probability" }),
    event({ documentId: "a2", ownerId: "rep1", field: "probability" }),
    event({
      documentId: "a1",
      ownerId: "rep1",
      field: "created",
      newProbability: 30,
    }),
  ];
  const rep = computeRepBehavior(active, closedDeals, evts).find(
    (r) => r.ownerId === "rep1"
  )!;
  assert.equal(rep.bias, null); // only 1 closed deal
  assert.equal(rep.activeDeals, 2);
  assert.equal(rep.avgProbability, 55);
  assert.equal(rep.avgProbabilityAtCreation, 30);
  assert.equal(rep.staleCount, 1);
  // 3 probability changes over 2 audited docs = 1.5
  assert.equal(rep.probabilityChangesPerDeal, 1.5);
});

/* ---------- amount variation ---------- */

test("computeAmountVariation sums absolute deltas", () => {
  const evts = [
    event({ field: "amount", oldAmount: 100_000, newAmount: 80_000 }),
    event({ field: "amount", oldAmount: 80_000, newAmount: 90_000 }),
    event({ field: "probability" }),
  ];
  const v = computeAmountVariation(evts);
  assert.equal(v.changes, 2);
  assert.equal(v.totalAbsoluteChange, 30_000);
});
