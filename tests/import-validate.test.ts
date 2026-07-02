/**
 * Data-integrity gate — the deterministic half of "never import uncertain data".
 * A clean invoice reconciles; a broken total, a missing field, or a low-confidence
 * critical field each force needs-attention.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateInvoice } from "../lib/import/validate.ts";
import type { ExtractedInvoice } from "../lib/import/types.ts";

function cleanInvoice(): ExtractedInvoice {
  return {
    number: "INV-2021-143",
    date: "2021-04-12",
    currency: "EUR",
    detected_customer_name: "ARLUX",
    subtotal: 1000,
    discount_total: 0,
    tax_total: 200,
    total_amount: 1200,
    notes: null,
    lines: [
      { description: "Solar Light 60W", quantity: 10, unit_price: 80, discount_amount: null, discount_pct: null, tax_rate: 20, tax_amount: 160, line_total: 800 },
      { description: "Pole 8m", quantity: 2, unit_price: 100, discount_amount: null, discount_pct: null, tax_rate: 20, tax_amount: 40, line_total: 200 },
    ],
  };
}

const HIGH = { number: 0.99, date: 0.98, total_amount: 0.99, currency: 0.98 };

test("a clean, arithmetically-consistent invoice passes", () => {
  const r = validateInvoice(cleanInvoice(), HIGH);
  assert.equal(r.reconciles, true);
  assert.equal(r.ok, true);
  assert.equal(r.issues.length, 0);
});

// Real invoice pattern (SLXINV24001): FOB subtotal (goods only) + a freight
// LINE = CFR total. Sum-of-lines must reconcile against the total, NOT the
// FOB subtotal. Also locks the confidence band (~0.90 correct reads pass).
test("a CFR invoice — FOB subtotal + freight line = CFR total — reconciles", () => {
  const inv: ExtractedInvoice = {
    number: "SLXINV24001",
    date: "2026-06-25",
    currency: "USD",
    detected_customer_name: "PRESTIGE MULTISERVICE SARL",
    subtotal: 61672, // FOB Shanghai (goods only)
    discount_total: null,
    tax_total: null,
    total_amount: 71472, // CFR Ouagadougou (goods + freight)
    notes: null,
    lines: [
      { description: "SSLX PRO DUAL 50", quantity: 50, unit_price: 677, discount_amount: null, discount_pct: null, tax_rate: null, tax_amount: null, line_total: 33850 },
      { description: "SSLX PRO 40", quantity: 20, unit_price: 325.6, discount_amount: null, discount_pct: null, tax_rate: null, tax_amount: null, line_total: 6512 },
      { description: "Mats 6m double crosse", quantity: 50, unit_price: 317, discount_amount: null, discount_pct: null, tax_rate: null, tax_amount: null, line_total: 15850 },
      { description: "Mats 6m simple crosse", quantity: 20, unit_price: 273, discount_amount: null, discount_pct: null, tax_rate: null, tax_amount: null, line_total: 5460 },
      { description: "Transportation 40HQ", quantity: 1, unit_price: 9800, discount_amount: null, discount_pct: null, tax_rate: null, tax_amount: null, line_total: 9800 },
    ],
  };
  const r = validateInvoice(inv, { number: 0.92, date: 0.9, total_amount: 0.93 });
  assert.equal(r.reconciles, true); // 33850+6512+15850+5460+9800 = 71472 = total
  assert.equal(r.ok, true); // confidences ≥ 0.85
});

test("a wrong grand total fails reconciliation", () => {
  const inv = cleanInvoice();
  inv.total_amount = 9999;
  const r = validateInvoice(inv, HIGH);
  assert.equal(r.reconciles, false);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.code === "total_mismatch"));
});

test("a per-line qty×price mismatch is caught", () => {
  const inv = cleanInvoice();
  inv.lines[0].line_total = 777; // 10×80 ≠ 777
  const r = validateInvoice(inv, HIGH);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.code === "line_math"));
});

test("a missing invoice number forces attention even if maths reconcile", () => {
  const inv = cleanInvoice();
  inv.number = "";
  const r = validateInvoice(inv, HIGH);
  assert.equal(r.reconciles, true);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.code === "missing_number"));
});

test("low confidence on a critical field forces attention", () => {
  const r = validateInvoice(cleanInvoice(), { number: 0.5, date: 0.98, total_amount: 0.99 });
  assert.equal(r.ok, false);
  assert.ok(r.minCriticalConfidence < 0.95);
  assert.ok(r.issues.some((i) => i.code === "low_confidence" && i.field === "number"));
});

test("missing confidence for a critical field counts as zero", () => {
  const r = validateInvoice(cleanInvoice(), { date: 0.98, total_amount: 0.99 });
  assert.equal(r.ok, false); // number confidence absent -> 0
});
