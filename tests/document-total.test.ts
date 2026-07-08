/**
 * Tests for lib/document-total.ts — the document grand-total math shared by
 * the builder (saveDocument) and server-side recomputes (m149 shipping-update
 * completion).
 *
 * Run with:  npm test
 *
 * Pure (no DB / no server imports). The assertions pin the builder formula:
 * total = items + freight + commission(items+freight) + extras, extras
 * excluded from the commission base (m146 owner decision).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { documentGrandTotal } from "../lib/document-total.ts";

const near = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test("no commission, no extras — total = items + freight", () => {
  const t = documentGrandTotal({
    itemsTotal: 10_000,
    freightTotal: 1_500,
    commission: { enabled: false, percentage: 0 },
  });
  near(t.subtotal, 11_500);
  assert.equal(t.commission_amount, 0);
  assert.equal(t.shipping_extras, 0);
  near(t.grand_total, 11_500);
});

test("commission applies on items + freight", () => {
  const t = documentGrandTotal({
    itemsTotal: 10_000,
    freightTotal: 1_500,
    commission: { enabled: true, percentage: 5 },
  });
  near(t.commission_amount, 575);
  near(t.grand_total, 12_075);
});

test("extras add to the total but NOT to the commission base (m146)", () => {
  const t = documentGrandTotal({
    itemsTotal: 10_000,
    freightTotal: 1_500,
    commission: { enabled: true, percentage: 5 },
    insuranceCost: 110,
    additionalCharges: [
      { label: "ECTN", amount: 280 },
      { label: "BESC", amount: 150 },
    ],
  });
  near(t.commission_amount, 575); // unchanged by the extras
  near(t.shipping_extras, 540);
  near(t.grand_total, 12_615);
});

test("m149 completion — a freight change moves total AND commission", () => {
  const parts = {
    itemsTotal: 20_000,
    commission: { enabled: true, percentage: 10 },
    insuranceCost: 220,
    additionalCharges: [{ label: "FERI", amount: 300 }],
  };
  const before = documentGrandTotal({ ...parts, freightTotal: 500 });
  const after = documentGrandTotal({ ...parts, freightTotal: 800 });
  near(before.grand_total, 20_500 + 2_050 + 520); // 23 070
  near(after.grand_total, 20_800 + 2_080 + 520); // 23 400
  near(after.grand_total - before.grand_total, 330); // +300 freight, +30 commission
});

test("raw charge rows are normalized like the builder", () => {
  const t = documentGrandTotal({
    itemsTotal: 1_000,
    freightTotal: 0,
    commission: { enabled: false, percentage: 0 },
    insuranceCost: "55",
    additionalCharges: [
      { label: "ECTN", amount: "280" }, // string amount → 280
      { label: "", amount: 0 }, // fully empty row → dropped
      { label: "Bad", amount: -50 }, // negative → 0
    ],
  });
  near(t.shipping_extras, 335);
  near(t.grand_total, 1_335);
});

test("null / missing extras degrade to 0 (pre-m146 documents)", () => {
  const t = documentGrandTotal({
    itemsTotal: 5_000,
    freightTotal: 700,
    commission: { enabled: true, percentage: 0 },
    insuranceCost: null,
    additionalCharges: null,
  });
  assert.equal(t.commission_amount, 0);
  assert.equal(t.shipping_extras, 0);
  near(t.grand_total, 5_700);
});
