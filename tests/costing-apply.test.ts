/**
 * Tests for the selective "apply newer costing" math (m140).
 * (lib/costing-apply.ts)
 *
 * Run with:  npm test
 *
 * Pure (no DB / no server imports). These lock the safety rules of the
 * Keep/Apply flow (Lot R4/2D): NEVER guess which approved price a line takes
 * (refuse on ambiguity), re-apply each line's own discount on the new
 * approved unit price, and recompute the document money columns with the
 * exact saveDocument formula (items + freight incl. LCL wooden box +
 * commission on items+freight + m146 extras AFTER commission), via
 * documentGrandTotal — the canonical builder mirror.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applySelectionsToLines,
  recomputeDocTotals,
  resolveLineComponent,
  versionContainers,
  type ApplyLine,
  type ApplyVersion,
} from "../lib/costing-apply.ts";

const near = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

const VERSION: ApplyVersion = {
  id: "v2",
  product_unit_price: 500,
  pole_unit_price: 200,
  previous_product_unit_price: 571.25,
  previous_pole_unit_price: 220.51,
  approved_by: "director-1",
  approved_at: "2026-08-18T10:00:00Z",
  containers: [
    { container_type: "40ft HC", quantity: 2, unit_price: 4100, wooden_box_cost: 0 },
  ],
};

const srLine = (over: Partial<ApplyLine>): ApplyLine => ({
  id: "l1",
  pricing_source: "approved_service_request",
  source_project_request_id: "sr-1",
  category_id: null,
  quantity: 10,
  original_unit_price: 571.25,
  discount_type: null,
  discount_value: 0,
  ...over,
});

// --- component resolution ----------------------------------------------------

test("resolveLineComponent: source_component wins; category means product", () => {
  assert.equal(
    resolveLineComponent(srLine({ source_component: "pole" }), VERSION),
    "pole"
  );
  assert.equal(
    resolveLineComponent(srLine({ category_id: "cat" }), VERSION),
    "product"
  );
});

test("resolveLineComponent: category-null resolved by PREVIOUS-approved price match", () => {
  assert.equal(
    resolveLineComponent(srLine({ original_unit_price: 571.25 }), VERSION),
    "product"
  );
  assert.equal(
    resolveLineComponent(srLine({ original_unit_price: 220.51 }), VERSION),
    "pole"
  );
});

test("resolveLineComponent: ambiguity is refused, never guessed", () => {
  // Matches neither previous price…
  assert.equal(
    resolveLineComponent(srLine({ original_unit_price: 123.45 }), VERSION),
    "ambiguous"
  );
  // …or matches BOTH (previous prices equal): still ambiguous.
  const twin: ApplyVersion = {
    ...VERSION,
    previous_product_unit_price: 100,
    previous_pole_unit_price: 100,
  };
  assert.equal(
    resolveLineComponent(srLine({ original_unit_price: 100 }), twin),
    "ambiguous"
  );
});

// --- selective apply ------------------------------------------------------------

test("applySelectionsToLines: only SELECTED components move; discounts re-applied", () => {
  const product = srLine({ id: "p", category_id: "cat", discount_type: "percentage", discount_value: 10 });
  const pole = srLine({ id: "m", original_unit_price: 220.51, quantity: 10 });
  const r = applySelectionsToLines([product, pole], VERSION, { product: true });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.updates.length, 1); // pole untouched (not selected)
  const u = r.updates[0];
  assert.equal(u.id, "p");
  assert.equal(u.original_unit_price, 500);
  assert.equal(u.unit_price, 450); // 10% discount re-applied on the NEW price
  assert.equal(u.total_price, 4500);
  assert.equal(u.approved_by, "director-1");
});

test("applySelectionsToLines: ambiguous line aborts the WHOLE apply", () => {
  const fine = srLine({ id: "ok", category_id: "cat" });
  const ambiguous = srLine({ id: "bad", original_unit_price: 999 });
  const r = applySelectionsToLines([fine, ambiguous], VERSION, {
    product: true,
    pole: true,
  });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /ambiguous|manually/i);
});

test("applySelectionsToLines: selected component with no new price refuses", () => {
  const pole = srLine({ id: "m", original_unit_price: 220.51 });
  const noPole: ApplyVersion = { ...VERSION, pole_unit_price: null };
  const r = applySelectionsToLines([pole], noPole, { pole: true });
  assert.equal(r.ok, false);
});

test("applySelectionsToLines: non-locked and SR-less lines are never touched", () => {
  const catalogue = srLine({ id: "c", pricing_source: "catalogue", category_id: "cat" });
  const orphan = srLine({ id: "o", source_project_request_id: null, category_id: "cat" });
  const r = applySelectionsToLines([catalogue, orphan], VERSION, { product: true });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.updates.length, 0);
});

// --- freight snapshot + totals -----------------------------------------------------

test("versionContainers: parses the stored document-shape snapshot, drops junk", () => {
  const rows = versionContainers(VERSION);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quantity, 2);
  assert.deepEqual(versionContainers({ ...VERSION, containers: "junk" }), []);
});

test("recomputeDocTotals: exact saveDocument formula (LCL box + m146 extras after commission)", () => {
  const t = recomputeDocTotals({
    lineTotals: [4500, 2205.1],
    containers: [
      { container_type: "LCL", quantity: 1, unit_price: 850, wooden_box_cost: 120 } as any,
    ],
    commission_enabled: true,
    commission_percentage: 5,
    insurance_cost: 180.5,
    additional_charges: [
      { label: "ECTN", amount: 250 },
      { label: "BESC", amount: "75" }, // string amount → coerced like the builder
      { label: "", amount: 0 }, // fully-empty row → dropped
    ],
  });
  near(t.items_total, 6705.1);
  assert.equal(t.freight_total, 970); // 850 + 120 wooden box
  near(t.commission_amount, 383.755); // 5% of items+freight ONLY — extras excluded
  near(t.shipping_extras, 505.5); // 180.5 insurance + 250 + 75 charges
  // Unrounded — the exact figure a builder re-save would store.
  near(t.total_price, 6705.1 + 970 + 383.755 + 505.5);
});

test("recomputeDocTotals: legacy scalar freight fallback when no containers", () => {
  const t = recomputeDocTotals({
    lineTotals: [1000],
    containers: [],
    legacyFreightCost: 300,
    commission_enabled: false,
    commission_percentage: 0,
  });
  assert.equal(t.freight_total, 300);
  assert.equal(t.shipping_extras, 0); // pre-m146 docs: no extras columns → 0
  assert.equal(t.total_price, 1300);
});
