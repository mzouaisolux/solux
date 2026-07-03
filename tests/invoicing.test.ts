/**
 * Tests for the Deposit & Balance invoicing computation core (m141).
 * (lib/invoicing.ts)
 *
 * Run with:  npm test
 *
 * Pure (no DB / no server imports). These lock the spec's own numbers:
 *   - 30/70 terms on a 100,000 quotation → deposit 30,000, balance 70,000
 *   - multi-deposit 20/30/50 schedules
 *   - the CEILING rule: never invoice above the quotation total
 *     (95,000 already invoiced → max next invoice 5,000)
 *   - credit notes subtract from the invoiced total
 *   - payment status derivation (partially_paid / paid / overdue)
 *   - the Payment Schedule card numbers (paid / outstanding / remaining)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildInvoiceLineDescription,
  buildMilestonesFromTerms,
  computeDepositAmount,
  computeInvoicedTotal,
  computePaidForInvoice,
  computePaymentProgress,
  computeRemainingToInvoice,
  deriveInvoiceStatus,
  formatInvoiceAmount,
  roundMoney,
  signedInvoiceAmount,
  validateNextInvoiceAmount,
  type InvoiceLite,
} from "../lib/invoicing.ts";

const inv = (
  invoice_type: InvoiceLite["invoice_type"],
  amount: number,
  status: InvoiceLite["status"] = "sent",
  id?: string
): InvoiceLite => ({ id, invoice_type, amount, status });

// ---------------------------------------------------------------- deposits

test("spec: 30% deposit on 100,000 → 30,000", () => {
  assert.equal(computeDepositAmount(100_000, 30), 30_000);
});

test("deposit rounding is money-safe (2 decimals)", () => {
  assert.equal(computeDepositAmount(33_333.33, 30), 10_000);
  assert.equal(roundMoney(0.1 + 0.2), 0.3);
});

// ------------------------------------------------------------- milestones

test("spec: 30/70 before-shipment terms → two milestones summing to total", () => {
  const ms = buildMilestonesFromTerms(
    "deposit_balance",
    { deposit_percent: 30, balance_condition: "before_shipment" },
    100_000
  );
  assert.equal(ms.length, 2);
  assert.deepEqual(
    ms.map((m) => [m.key, m.percent, m.amount]),
    [
      ["deposit", 30, 30_000],
      ["balance", 70, 70_000],
    ]
  );
  assert.match(ms[1].label, /before shipment/i);
});

test("milestones always sum exactly to the total (odd amounts)", () => {
  const ms = buildMilestonesFromTerms(
    "deposit_balance",
    { deposit_percent: 33, balance_condition: "against_documents" },
    99_999.99
  );
  assert.equal(roundMoney(ms[0].amount + ms[1].amount), 99_999.99);
});

test("LC-only / no-deposit terms → single 100% milestone", () => {
  for (const [mode, terms] of [
    ["lc", { lc_type: "at_sight" }],
    ["deposit_balance", { deposit_percent: 0, balance_condition: "before_shipment" }],
    ["deposit_balance", { deposit_percent: 100, balance_condition: "before_shipment" }],
    [null, null],
  ] as const) {
    const ms = buildMilestonesFromTerms(mode as any, terms as any, 50_000);
    assert.equal(ms.length, 1);
    assert.equal(ms[0].key, "full");
    assert.equal(ms[0].amount, 50_000);
  }
});

test("hybrid terms label the balance as L/C", () => {
  const ms = buildMilestonesFromTerms("hybrid", { deposit_percent: 30, lc_days: 90 }, 10_000);
  assert.match(ms[1].label, /L\/C/);
});

// -------------------------------------------------- invoiced total & balance

test("spec: balance = total − previous deposits (100k − 30k → 70k)", () => {
  const invoices = [inv("deposit", 30_000)];
  assert.equal(computeInvoicedTotal(invoices), 30_000);
  assert.equal(computeRemainingToInvoice(100_000, invoices), 70_000);
});

test("spec: multi-deposit 20/30 → balance 50,000", () => {
  const invoices = [inv("deposit", 20_000), inv("deposit", 30_000)];
  assert.equal(computeRemainingToInvoice(100_000, invoices), 50_000);
});

test("credit notes subtract; cancelled invoices never count", () => {
  const invoices = [
    inv("deposit", 30_000),
    inv("credit_note", 5_000),
    inv("custom", 10_000, "cancelled"),
  ];
  assert.equal(signedInvoiceAmount(invoices[1]), -5_000);
  assert.equal(computeInvoicedTotal(invoices), 25_000);
  assert.equal(computeRemainingToInvoice(100_000, invoices), 75_000);
});

test("remaining never goes negative and never exceeds the total", () => {
  assert.equal(computeRemainingToInvoice(100_000, [inv("full", 100_000)]), 0);
  assert.equal(
    computeRemainingToInvoice(100_000, [inv("full", 100_000), inv("custom", 1)]),
    0
  );
  // A family that is ONLY credit notes clamps to the ceiling.
  assert.equal(computeRemainingToInvoice(100_000, [inv("credit_note", 5_000)]), 100_000);
});

// -------------------------------------------------------------- the ceiling

test("spec: 95,000 already invoiced → max next invoice is 5,000", () => {
  const remaining = computeRemainingToInvoice(100_000, [inv("custom", 95_000)]);
  assert.equal(remaining, 5_000);
  assert.equal(validateNextInvoiceAmount(5_000, remaining), null);
  const err = validateNextInvoiceAmount(5_000.01, remaining);
  assert.ok(err && /5,?000/.test(err.replace(",", "")), `got: ${err}`);
});

test("zero / negative / NaN amounts are rejected", () => {
  for (const bad of [0, -1, NaN, Infinity]) {
    assert.ok(validateNextInvoiceAmount(bad, 1_000) !== null || bad === Infinity);
  }
  assert.ok(validateNextInvoiceAmount(Infinity, 1_000));
});

// ---------------------------------------------------------- billing line

test("spec: deposit billing line references the quotation and the %", () => {
  assert.equal(
    buildInvoiceLineDescription("deposit", "Q-2026-001", 30),
    "Deposit payment according to Quotation Q-2026-001 — 30% of quotation amount"
  );
  assert.equal(
    buildInvoiceLineDescription("balance", "Q-2026-001"),
    "Balance payment according to Quotation Q-2026-001"
  );
  assert.equal(buildInvoiceLineDescription("full", null), "Payment in full");
});

// --------------------------------------------------------- payment status

test("status derivation: partial → partially_paid, full → paid", () => {
  const base = { status: "sent" as const, amount: 30_000, due_date: null };
  assert.equal(deriveInvoiceStatus(base, 0, "2026-07-03"), "sent");
  assert.equal(deriveInvoiceStatus(base, 10_000, "2026-07-03"), "partially_paid");
  assert.equal(deriveInvoiceStatus(base, 30_000, "2026-07-03"), "paid");
  // rounding tolerance: 29,999.999 counts as paid
  assert.equal(deriveInvoiceStatus(base, 29_999.999, "2026-07-03"), "paid");
});

test("status derivation: overdue only when sent, unpaid, past due date", () => {
  const due = { status: "sent" as const, amount: 1_000, due_date: "2026-07-01" };
  assert.equal(deriveInvoiceStatus(due, 0, "2026-07-03"), "overdue");
  assert.equal(deriveInvoiceStatus({ ...due, status: "draft" }, 0, "2026-07-03"), "draft");
  assert.equal(deriveInvoiceStatus(due, 1_000, "2026-07-03"), "paid");
  assert.equal(
    deriveInvoiceStatus({ ...due, status: "cancelled" }, 0, "2026-07-03"),
    "cancelled"
  );
});

test("computePaidForInvoice sums only that invoice's payments", () => {
  const payments = [
    { invoice_id: "a", amount: 10_000 },
    { invoice_id: "a", amount: 5_000 },
    { invoice_id: "b", amount: 999 },
  ];
  assert.equal(computePaidForInvoice("a", payments), 15_000);
});

// ------------------------------------------------------- progress (the card)

test("spec: Payment Schedule card numbers — 30k paid on 100k", () => {
  const invoices = [inv("deposit", 30_000, "paid", "d1"), inv("balance", 70_000, "sent", "b1")];
  const payments = [{ invoice_id: "d1", amount: 30_000 }];
  const p = computePaymentProgress(100_000, invoices, payments);
  assert.equal(p.invoicedTotal, 100_000);
  assert.equal(p.remainingToInvoice, 0);
  assert.equal(p.paidTotal, 30_000);
  assert.equal(p.outstanding, 70_000);
  assert.equal(p.remainingToPay, 70_000);
  assert.equal(p.paidPercent, 30);
  assert.equal(p.invoicedPercent, 100);
});

test("progress ignores payments on cancelled invoices; zero-total is safe", () => {
  const invoices = [inv("deposit", 30_000, "cancelled", "d1")];
  const payments = [{ invoice_id: "d1", amount: 30_000 }];
  const p = computePaymentProgress(100_000, invoices, payments);
  assert.equal(p.paidTotal, 0);
  assert.equal(p.invoicedTotal, 0);
  const zero = computePaymentProgress(0, [], []);
  assert.equal(zero.paidPercent, 0);
});

// ---------------------------------------------------------------- history

test("invoice history: Created → Sent → payments → Paid in full", async () => {
  const { buildInvoiceHistory } = await import("../lib/invoicing.ts");
  const entries = buildInvoiceHistory(
    {
      amount: 30_000,
      created_at: "2026-06-26T10:00:00Z",
      sent_at: "2026-06-27T09:00:00Z",
    },
    [
      { amount: 10_000, paid_at: "2026-06-28" },
      { amount: 20_000, paid_at: "2026-06-30" },
    ],
    { createdBy: "John" }
  );
  assert.deepEqual(
    entries.map((e) => e.key),
    ["created", "sent", "payment", "payment", "paid"]
  );
  assert.equal(entries[0].detail, "by John");
  assert.equal(entries.at(-1)!.date, "2026-06-30"); // paid on the completing payment
});

test("invoice history: cancelled invoice, no sent_at (pre-m142)", async () => {
  const { buildInvoiceHistory } = await import("../lib/invoicing.ts");
  const entries = buildInvoiceHistory(
    { amount: 5_000, created_at: "2026-06-26T10:00:00Z", cancelled_at: "2026-06-27T10:00:00Z" },
    []
  );
  assert.deepEqual(
    entries.map((e) => e.key),
    ["created", "cancelled"]
  );
});

// ------------------------------------------------------------- formatting

test("formatInvoiceAmount renders '30,000.00 USD'", () => {
  assert.equal(formatInvoiceAmount(30_000, "USD"), "30,000.00 USD");
  assert.equal(formatInvoiceAmount(1234.5), "1,234.50");
});
