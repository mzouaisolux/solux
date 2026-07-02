/**
 * production-next-action tests — lock the "one primary action + ranked queue"
 * ladder for the Production Order redesign prototype.
 *
 * computeNextAction only RANKS signals already derived by the page. These tests
 * pin the precedence (cash blockers outrank logistics steps), the stage-driven
 * primary at each lifecycle point, and the terminal-state short-circuits — so
 * the "what do I do next?" answer never silently inverts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeNextAction,
  type NextActionInput,
} from "../lib/production-next-action.ts";

/** A calm, mid-lifecycle order: in production, deposit in, nothing wrong. */
function base(over: Partial<NextActionInput> = {}): NextActionInput {
  return {
    status: "in_production",
    paymentState: "deposit_received",
    productionCanStart: true,
    shipmentBooked: false,
    depositOverrideActive: false,
    blStatus: "complete",
    docsAllRequiredReady: true,
    docsRequiredReady: 3,
    docsRequiredTotal: 3,
    ciGenerated: true,
    balanceOutstanding: false,
    balanceRemainingLabel: "USD 0",
    balanceDueLabel: null,
    balanceDueDaysLate: null,
    daysToEta: 40,
    balanceReminderDaysBeforeEta: null,
    lcCritical: false,
    lcDaysToExpiry: null,
    archived: false,
    ...over,
  };
}

test("awaiting deposit → primary is 'record the deposit'", () => {
  const r = computeNextAction(
    base({ status: "awaiting_deposit", paymentState: "awaiting_deposit" })
  );
  assert.equal(r.primary?.key, "deposit");
  assert.equal(r.primary?.tone, "blocked");
  assert.equal(r.closed, false);
});

test("deposit cleared, scheduled → primary is 'start production'", () => {
  const r = computeNextAction(
    base({ status: "production_scheduled", paymentState: "deposit_received" })
  );
  assert.equal(r.primary?.key, "start");
});

test("production complete + BL ready + not booked → primary is 'book shipment'", () => {
  const r = computeNextAction(
    base({ status: "production_completed", blStatus: "complete" })
  );
  assert.equal(r.primary?.key, "book");
});

test("production complete + BL missing → primary is 'complete BL profile'", () => {
  const r = computeNextAction(
    base({ status: "production_completed", blStatus: "missing" })
  );
  assert.equal(r.primary?.key, "bl");
});

test("booked but required docs missing → primary is 'generate CI'", () => {
  const r = computeNextAction(
    base({
      status: "production_completed",
      shipmentBooked: true,
      docsAllRequiredReady: false,
      docsRequiredReady: 1,
      docsRequiredTotal: 3,
      ciGenerated: false,
    })
  );
  assert.equal(r.primary?.key, "docs");
  assert.match(r.primary?.title ?? "", /commercial invoice/i);
});

test("cash outranks logistics: overdue balance beats 'book shipment'", () => {
  const r = computeNextAction(
    base({
      status: "production_completed",
      blStatus: "complete",
      balanceOutstanding: true,
      balanceRemainingLabel: "USD 92,250",
      balanceDueDaysLate: 4,
    })
  );
  assert.equal(r.primary?.key, "balance-overdue");
  // The logistics step is not lost — it drops into the queue.
  assert.ok(r.queue.some((q) => q.key === "book"));
});

test("LC expiry is the top cash blocker", () => {
  const r = computeNextAction(
    base({
      status: "production_completed",
      blStatus: "complete",
      lcCritical: true,
      lcDaysToExpiry: 2,
      balanceOutstanding: true,
      balanceDueDaysLate: 1,
    })
  );
  assert.equal(r.primary?.key, "lc");
});

test("balance due soon (inside reminder window) is at-risk, not overdue", () => {
  const r = computeNextAction(
    base({
      status: "in_production",
      balanceOutstanding: true,
      balanceRemainingLabel: "USD 50,000",
      balanceDueDaysLate: -3,
      daysToEta: 8,
      balanceReminderDaysBeforeEta: 10,
    })
  );
  assert.equal(r.primary?.key, "balance-due");
  assert.equal(r.primary?.tone, "at_risk");
});

test("nothing outstanding → clear, no primary, on-track line", () => {
  const r = computeNextAction(base());
  assert.equal(r.primary, null);
  assert.equal(r.clear, true);
  assert.equal(r.queue[0]?.key, "in-production");
});

test("deposit override is informational, never primary", () => {
  const r = computeNextAction(
    base({
      status: "awaiting_deposit",
      paymentState: "awaiting_deposit",
      depositOverrideActive: true,
    })
  );
  // Override suppresses the deposit gate → nothing actionable, override in queue.
  assert.notEqual(r.primary?.key, "override");
  assert.ok(r.queue.some((q) => q.key === "override" && q.tone === "info"));
});

test("cancelled → closed, no actions", () => {
  const r = computeNextAction(base({ status: "cancelled" }));
  assert.equal(r.closed, true);
  assert.equal(r.primary, null);
  assert.deepEqual(r.queue, []);
});

test("delivered → closed and clear", () => {
  const r = computeNextAction(base({ status: "delivered" }));
  assert.equal(r.closed, true);
  assert.equal(r.clear, true);
});

test("archived short-circuits before any signal", () => {
  const r = computeNextAction(
    base({ status: "production_delayed", archived: true })
  );
  assert.equal(r.closed, true);
  assert.equal(r.primary, null);
});
