/**
 * Cash-collection tests (audit Phase 0 + Phase 1 — m114).
 *
 * Run with:  npm test   (Node ≥ 22.6, built-in runner + native TS stripping)
 *
 * Locks in:
 *   - computeEffectiveBalanceDueDate derivation rules
 *     (manual → deadline → ETA+LC days → ETA → null)
 *   - computeOperationsAlert money alerts: balance overdue by date,
 *     LC expiry warnings, the Phase-0 unpaid-deposit-override alert,
 *     and the legacy "Balance due" behavior staying intact.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeEffectiveBalanceDueDate,
  type PaymentMode,
  type PaymentTerms,
} from "../lib/types.ts";
import {
  computeOperationsAlert,
  DEPOSIT_OVERRIDE_UNPAID_DAYS,
  LC_EXPIRY_WARNING_DAYS,
} from "../lib/operations-alerts.ts";

/* ------------------------------------------------------------------ */
/* computeEffectiveBalanceDueDate                                      */
/* ------------------------------------------------------------------ */

const DB_BEFORE_SHIPMENT: PaymentTerms = {
  deposit_percent: 30,
  balance_condition: "before_shipment",
};
const DB_AGAINST_DOCS: PaymentTerms = {
  deposit_percent: 30,
  balance_condition: "against_documents",
};

test("due date: manual override always wins", () => {
  const r = computeEffectiveBalanceDueDate({
    balanceDueDate: "2026-07-01",
    paymentMode: "deposit_balance",
    paymentTerms: DB_BEFORE_SHIPMENT,
    currentProductionDeadline: "2026-09-09",
    eta: "2026-10-10",
  });
  assert.deepEqual(r, { date: "2026-07-01", source: "manual" });
});

test("due date: before_shipment derives from the production deadline", () => {
  const r = computeEffectiveBalanceDueDate({
    balanceDueDate: null,
    paymentMode: "deposit_balance",
    paymentTerms: DB_BEFORE_SHIPMENT,
    currentProductionDeadline: "2026-07-10",
    eta: "2026-08-01",
  });
  assert.deepEqual(r, { date: "2026-07-10", source: "deadline" });
});

test("due date: against_documents derives from ETA", () => {
  const r = computeEffectiveBalanceDueDate({
    balanceDueDate: null,
    paymentMode: "deposit_balance",
    paymentTerms: DB_AGAINST_DOCS,
    currentProductionDeadline: "2026-07-10",
    eta: "2026-08-01",
  });
  assert.deepEqual(r, { date: "2026-08-01", source: "eta" });
});

test("due date: LC usance derives ETA + lc_days", () => {
  const r = computeEffectiveBalanceDueDate({
    balanceDueDate: null,
    paymentMode: "lc",
    paymentTerms: { lc_type: "usance", lc_days: 60 },
    currentProductionDeadline: null,
    eta: "2026-08-01",
  });
  // 2026-08-01 + 60 calendar days = 2026-09-30
  assert.deepEqual(r, { date: "2026-09-30", source: "eta_lc" });
});

test("due date: hybrid derives ETA + lc_days", () => {
  const r = computeEffectiveBalanceDueDate({
    balanceDueDate: null,
    paymentMode: "hybrid",
    paymentTerms: { deposit_percent: 30, lc_days: 30 },
    currentProductionDeadline: null,
    eta: "2026-08-01",
  });
  assert.deepEqual(r, { date: "2026-08-31", source: "eta_lc" });
});

test("due date: LC at sight falls back to ETA", () => {
  const r = computeEffectiveBalanceDueDate({
    balanceDueDate: null,
    paymentMode: "lc",
    paymentTerms: { lc_type: "at_sight" },
    currentProductionDeadline: null,
    eta: "2026-08-01",
  });
  assert.deepEqual(r, { date: "2026-08-01", source: "eta" });
});

test("due date: honest null when no anchor exists", () => {
  const noDeadline = computeEffectiveBalanceDueDate({
    balanceDueDate: null,
    paymentMode: "deposit_balance",
    paymentTerms: DB_BEFORE_SHIPMENT,
    currentProductionDeadline: null,
    eta: null,
  });
  assert.deepEqual(noDeadline, { date: null, source: null });

  const noTerms = computeEffectiveBalanceDueDate({
    balanceDueDate: null,
    paymentMode: null,
    paymentTerms: null,
    currentProductionDeadline: "2026-07-10",
    eta: "2026-08-01",
  });
  assert.deepEqual(noTerms, { date: null, source: null });
});

/* ------------------------------------------------------------------ */
/* computeOperationsAlert — money alerts                                */
/* ------------------------------------------------------------------ */

type AlertOrder = Parameters<typeof computeOperationsAlert>[0]["order"];

function order(over: Partial<AlertOrder> = {}): AlertOrder {
  return {
    status: "production_completed" as any,
    initial_production_deadline: null,
    current_production_deadline: null,
    deposit_received_amount: 300,
    balance_received_amount: 0,
    actual_completion_date: "2026-06-01",
    ...over,
  };
}

const TODAY = "2026-06-11";

function classify(
  o: AlertOrder,
  mode: PaymentMode | null = "deposit_balance",
  terms: PaymentTerms | null = DB_AGAINST_DOCS
) {
  return computeOperationsAlert({
    order: o,
    totalPrice: 1000,
    paymentMode: mode,
    paymentTerms: terms,
    today: TODAY,
  });
}

test("alert: balance overdue by explicit due date", () => {
  const a = classify(order({ balance_due_date: "2026-06-01" }));
  assert.equal(a.level, "balance_due");
  assert.equal(a.label, "Balance overdue 10d");
  assert.equal(a.highPriority, true);
});

test("alert: balance overdue by derived ETA due date (shipped, docs terms)", () => {
  const a = classify(order({ status: "shipped" as any, eta: "2026-06-01" }));
  assert.equal(a.level, "balance_due");
  assert.equal(a.label, "Balance overdue 10d");
});

test("alert: legacy 'Balance due' preserved when no due date is derivable", () => {
  const a = classify(order()); // completed, no eta, no override date
  assert.equal(a.level, "balance_due");
  assert.equal(a.label, "Balance due");
});

test("alert: future due date keeps the classic 'Balance due' (not overdue)", () => {
  const a = classify(order({ balance_due_date: "2026-12-31" }));
  assert.equal(a.label, "Balance due");
});

test("alert: LC expiring soon outranks generic balance due", () => {
  const a = classify(
    order({ lc_expiry_date: "2026-06-20" }),
    "lc",
    { lc_type: "at_sight" }
  );
  assert.equal(a.level, "balance_due");
  assert.equal(a.label, "LC expires in 9d");
  assert.equal(a.highPriority, true);
  assert.ok(9 <= LC_EXPIRY_WARNING_DAYS);
});

test("alert: expired LC", () => {
  const a = classify(
    order({ lc_expiry_date: "2026-06-01" }),
    "lc",
    { lc_type: "at_sight" }
  );
  assert.equal(a.level, "balance_due");
  assert.equal(a.label, "LC expired 10d");
});

test("alert: LC silent while balance fully received", () => {
  const a = classify(
    order({ lc_expiry_date: "2026-06-01", balance_received_amount: 1000 }),
    "lc",
    { lc_type: "at_sight" }
  );
  assert.equal(a.level, "ok");
});

test("alert: awaiting_deposit stays the truth before the deposit gate", () => {
  const a = classify(
    order({
      status: "awaiting_deposit" as any,
      deposit_received_amount: 0,
      balance_due_date: "2026-06-01",
    }),
    "deposit_balance",
    DB_BEFORE_SHIPMENT
  );
  assert.equal(a.level, "awaiting_deposit");
  assert.equal(a.label, "Awaiting deposit");
});

test("alert (Phase 0 regression): unpaid deposit override after 14d", () => {
  const a = classify(
    order({
      status: "in_production" as any,
      deposit_received_amount: 0,
      deposit_override_at: "2026-05-01T10:00:00Z",
    }),
    "deposit_balance",
    DB_BEFORE_SHIPMENT
  );
  assert.equal(a.level, "awaiting_deposit");
  assert.equal(a.label, "Deposit missing 41d");
  assert.equal(a.highPriority, true);
  assert.ok(41 >= DEPOSIT_OVERRIDE_UNPAID_DAYS);
});

test("alert: terminal orders never alert", () => {
  const a = classify(
    order({ status: "delivered" as any, balance_due_date: "2026-06-01" })
  );
  assert.equal(a.level, "ok");
});
