/**
 * Tests for the costing validity math (m140).
 * (lib/costing-validity.ts)
 *
 * Run with:  npm test
 *
 * Pure (no DB / no server imports). These lock the business rule that an
 * approved Service-Request costing goes stale by AGE against configurable
 * thresholds — Valid < agingAfterDays <= Aging < expiredAfterDays <= Expired —
 * and that a missing costing yields 'none' (silent, never blocking). Exact
 * boundary behavior matters: the send-gate and the banners branch on it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeCostingStatus,
  COSTING_DEFAULTS,
} from "../lib/costing-validity.ts";

const S = { agingAfterDays: 30, expiredAfterDays: 90 };
const TODAY = "2026-07-03";

/** Helper: an approval `days` days before TODAY (2026-07-03). */
function approvedDaysAgo(days: number): string {
  const base = new Date("2026-07-03T00:00:00Z").getTime();
  return new Date(base - days * 24 * 60 * 60 * 1000).toISOString();
}

// --- boundaries around aging (30) -------------------------------------------

test("age 29 => valid (strictly below the aging threshold)", () => {
  const r = computeCostingStatus(approvedDaysAgo(29), TODAY, S);
  assert.equal(r.status, "valid");
  assert.equal(r.ageDays, 29);
});

test("age 30 => aging (threshold day flips)", () => {
  const r = computeCostingStatus(approvedDaysAgo(30), TODAY, S);
  assert.equal(r.status, "aging");
  assert.equal(r.ageDays, 30);
});

test("age 31 => aging", () => {
  assert.equal(computeCostingStatus(approvedDaysAgo(31), TODAY, S).status, "aging");
});

// --- boundaries around expired (90) ------------------------------------------

test("age 89 => aging (strictly below the expired threshold)", () => {
  assert.equal(computeCostingStatus(approvedDaysAgo(89), TODAY, S).status, "aging");
});

test("age 90 => expired (threshold day flips)", () => {
  const r = computeCostingStatus(approvedDaysAgo(90), TODAY, S);
  assert.equal(r.status, "expired");
  assert.equal(r.ageDays, 90);
});

test("age 91 => expired", () => {
  assert.equal(computeCostingStatus(approvedDaysAgo(91), TODAY, S).status, "expired");
});

// --- degenerate inputs --------------------------------------------------------

test("no approval date => none (feature silent, never blocking)", () => {
  assert.equal(computeCostingStatus(null, TODAY, S).status, "none");
  assert.equal(computeCostingStatus(undefined, TODAY, S).status, "none");
  assert.equal(computeCostingStatus("not-a-date", TODAY, S).status, "none");
});

test("future-dated approval (clock skew) => age 0, valid — never negative", () => {
  const r = computeCostingStatus(approvedDaysAgo(-5), TODAY, S);
  assert.equal(r.status, "valid");
  assert.equal(r.ageDays, 0);
});

test("same-day approval => age 0, valid", () => {
  const r = computeCostingStatus(TODAY, TODAY, S);
  assert.equal(r.status, "valid");
  assert.equal(r.ageDays, 0);
});

test("full ISO timestamps are accepted (sliced to the day)", () => {
  const r = computeCostingStatus("2026-07-03T15:44:09.12+00:00", "2026-07-03", S);
  assert.equal(r.status, "valid");
});

// --- misconfigured thresholds are normalized, never explosive ----------------

test("inverted thresholds (expired < aging) clamp: expired takes aging's value", () => {
  const bad = { agingAfterDays: 60, expiredAfterDays: 10 };
  // age 59 < aging → valid; age 60 hits both (expired clamped up to 60) → expired.
  assert.equal(computeCostingStatus(approvedDaysAgo(59), TODAY, bad).status, "valid");
  assert.equal(computeCostingStatus(approvedDaysAgo(60), TODAY, bad).status, "expired");
});

test("aging=0 => a fresh costing is immediately aging (test/E2E lever)", () => {
  const r = computeCostingStatus(TODAY, TODAY, { agingAfterDays: 0, expiredAfterDays: 90 });
  assert.equal(r.status, "aging");
});

test("expired=0 with aging=0 => immediately expired (test/E2E lever)", () => {
  const r = computeCostingStatus(TODAY, TODAY, { agingAfterDays: 0, expiredAfterDays: 0 });
  assert.equal(r.status, "expired");
});

test("negative thresholds clamp to 0 rather than misbehaving", () => {
  const r = computeCostingStatus(TODAY, TODAY, { agingAfterDays: -5, expiredAfterDays: -1 });
  assert.equal(r.status, "expired"); // both clamp to 0 → age 0 >= 0
});

// --- defaults -----------------------------------------------------------------

test("COSTING_DEFAULTS match the owner's spec (30 / 90 / warning-only)", () => {
  assert.equal(COSTING_DEFAULTS.agingAfterDays, 30);
  assert.equal(COSTING_DEFAULTS.expiredAfterDays, 90);
  assert.equal(COSTING_DEFAULTS.requireRevisionWhenExpired, false);
});

test("label is human and mentions the age", () => {
  const r = computeCostingStatus(approvedDaysAgo(47), TODAY, S);
  assert.match(r.label, /47 days ago/);
});
