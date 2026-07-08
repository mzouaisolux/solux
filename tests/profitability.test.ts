/**
 * Tests for the Project Profitability engine.
 * (lib/profitability.ts)
 *
 * Run with:  npm test
 *
 * Pure (no DB / no server imports). These lock the management-widget math:
 *   - READ-BACK PROOF: a quotation generated from a priced SR reads back the
 *     Director's EXACT typed margin — which requires stripping the SR agent
 *     commission (folded into line unit prices) and crediting the export tax
 *     rebate, exactly like lib/project-pricing computeSectionPrice.
 *   - won-first leading doc ("latest quotation always wins", but a WON doc is
 *     the contract and beats later drafts).
 *   - Safe line classification (custom poles, category-null SR lines resolved
 *     by locked-price match, never guessed).
 *   - Honest partial results when a cost is unknown (cost_rmb=0 trap).
 *   - Health thresholds 🟢 ≥30 · 🟡 20–29 · 🔴 <20.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyLine,
  componentMargin,
  computeAffairProfitability,
  healthFor,
  pickLeadingDoc,
  soleSr,
  stripCommission,
  type ComputeInput,
  type SrPricingInfo,
} from "../lib/profitability.ts";
import { computeSectionPrice } from "../lib/project-pricing.ts";

// ---------------------------------------------------------------------------
// Shared fixture: an SR priced by the Director at 32% product / 18% pole,
// with a 5% product commission — the exact engine the app uses.
// ---------------------------------------------------------------------------

const SETTINGS = { exchangeRate: 6.85, taxRebate: 0.1 };
const productPricing = computeSectionPrice({
  costRmb: 1000,
  exchangeRate: SETTINGS.exchangeRate,
  taxRebate: SETTINGS.taxRebate,
  marginPct: 32,
  commissionPct: 5,
});
const polePricing = computeSectionPrice({
  costRmb: 400,
  exchangeRate: SETTINGS.exchangeRate,
  taxRebate: SETTINGS.taxRebate,
  marginPct: 18,
  commissionPct: 0,
});

const SR: SrPricingInfo = {
  productCostRmb: 1000,
  poleCostRmb: 400,
  productCommissionPct: 5,
  poleCommissionPct: 0,
  productUnitPrice: productPricing.finalUnitPrice,
  poleUnitPrice: polePricing.finalUnitPrice,
  estimatedTotalFreight: 800,
};

const baseDoc = {
  id: "doc-1",
  status: "draft",
  version: 1,
  date: "2026-07-01T00:00:00Z",
  currency: "USD",
  commission_amount: 0,
  insurance_cost: 0,
  additional_charges: [] as Array<{ amount?: unknown }>,
  freight_cost: 0,
};

function srInput(overrides: Partial<ComputeInput> = {}): ComputeInput {
  return {
    docs: [baseDoc],
    lines: [
      {
        pricing_source: "approved_service_request",
        source_project_request_id: "sr-1",
        category_id: "cat-1",
        quantity: 10,
        total_price: productPricing.finalUnitPrice * 10,
        original_unit_price: productPricing.finalUnitPrice,
      },
      {
        pricing_source: "approved_service_request",
        source_project_request_id: "sr-1",
        category_id: null,
        client_product_name: "Pole — 8 · arm 1,5",
        quantity: 10,
        total_price: polePricing.finalUnitPrice * 10,
        original_unit_price: polePricing.finalUnitPrice,
      },
    ],
    containers: [
      { container_type: "40ft HC", quantity: 1, unit_price: 800 } as any,
    ],
    srById: new Map([["sr-1", SR]]),
    catalogueCostRmb: new Map(),
    settings: SETTINGS,
    ...overrides,
  };
}

// --- THE READ-BACK PROOF -----------------------------------------------------

test("Director's typed margins read back exactly (commission stripped, rebate credited)", () => {
  const r = computeAffairProfitability(srInput());
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const product = r.components.find((c) => c.key === "product")!;
  const pole = r.components.find((c) => c.key === "pole")!;
  // 32% / 18% within a cent of rounding.
  assert.ok(Math.abs(product.marginPct! - 32) < 0.01, `product ${product.marginPct}`);
  assert.ok(Math.abs(pole.marginPct! - 18) < 0.01, `pole ${pole.marginPct}`);
  assert.equal(product.health, "green");
  assert.equal(pole.health, "red"); // 18 < 20 with the owner thresholds
  assert.equal(r.partial, false);
});

test("commission is NOT profit: 5% commission line does not inflate the margin", () => {
  // Same fixture but pretend commission was NOT stripped: naive margin on the
  // client price would exceed the typed 32%.
  const naive = componentMargin(
    productPricing.finalUnitPrice * 10, // client-facing (commission included)
    (1000 / SETTINGS.exchangeRate) * 10,
    SETTINGS.taxRebate
  );
  assert.ok(naive.marginPct > 32.5, "sanity: naive read-back is inflated");
  // The engine's stripped read-back stays at 32 (previous test).
});

test("a customer discount on V2 reads back LOWER than the typed margin", () => {
  const discounted = productPricing.finalUnitPrice * 0.9; // 10% negotiated off
  const r = computeAffairProfitability(
    srInput({
      lines: [
        {
          pricing_source: "approved_service_request",
          source_project_request_id: "sr-1",
          category_id: "cat-1",
          quantity: 10,
          total_price: discounted * 10,
          original_unit_price: productPricing.finalUnitPrice,
        },
      ],
    })
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const product = r.components.find((c) => c.key === "product")!;
  assert.ok(product.marginPct! < 32, `expected <32, got ${product.marginPct}`);
});

// --- leading doc ---------------------------------------------------------------

test("pickLeadingDoc: WON beats a later draft revision", () => {
  const won = { id: "a", status: "won", version: 1, date: "2026-06-01" };
  const laterDraft = { id: "b", status: "draft", version: 3, date: "2026-07-01" };
  assert.equal(pickLeadingDoc([laterDraft, won])!.id, "a");
});

test("pickLeadingDoc: else highest version wins, date tiebreak", () => {
  const v1 = { id: "a", status: "sent", version: 1, date: "2026-06-01" };
  const v2 = { id: "b", status: "draft", version: 2, date: "2026-06-10" };
  assert.equal(pickLeadingDoc([v1, v2])!.id, "b");
  const same1 = { id: "c", status: "sent", version: 1, date: "2026-06-20" };
  assert.equal(pickLeadingDoc([v1, same1])!.id, "c");
});

test("pickLeadingDoc: archived docs are skipped; lost only leads when alone", () => {
  const archivedWon = { id: "a", status: "won", version: 2, date: "2026-06-01", archived_at: "2026-06-02" };
  const sent = { id: "b", status: "sent", version: 1, date: "2026-05-01" };
  assert.equal(pickLeadingDoc([archivedWon, sent])!.id, "b");
  const lost = { id: "c", status: "lost", version: 1, date: "2026-05-01" };
  assert.equal(pickLeadingDoc([lost])!.id, "c");
});

// --- classification --------------------------------------------------------------

test("classifyLine: category ⇒ product; category-null resolved by locked-price match", () => {
  assert.equal(
    classifyLine(
      { pricing_source: "approved_service_request", category_id: "cat", quantity: 1, total_price: 0 },
      SR
    ),
    "product"
  );
  // Uncategorized SR product line (the m133 trap): price-match rescues it.
  assert.equal(
    classifyLine(
      {
        pricing_source: "approved_service_request",
        category_id: null,
        quantity: 1,
        total_price: 0,
        original_unit_price: SR.productUnitPrice!,
      },
      SR
    ),
    "product"
  );
  // Pole by price match.
  assert.equal(
    classifyLine(
      {
        pricing_source: "approved_service_request",
        category_id: null,
        quantity: 1,
        total_price: 0,
        original_unit_price: SR.poleUnitPrice!,
      },
      SR
    ),
    "pole"
  );
});

test("classifyLine: custom pole discriminator wins; m140 source_component honoured first", () => {
  assert.equal(
    classifyLine(
      { config_values: { line_type: "custom_pole" }, quantity: 1, total_price: 0 },
      null
    ),
    "pole"
  );
  assert.equal(
    classifyLine(
      { source_component: "pole", category_id: "cat", quantity: 1, total_price: 0 },
      null
    ),
    "pole"
  );
});

test("classifyLine: ambiguous SR line is UNCLASSIFIED (never guessed)", () => {
  const ambiguous = classifyLine(
    {
      pricing_source: "approved_service_request",
      category_id: null,
      client_product_name: "Special item",
      quantity: 1,
      total_price: 0,
      original_unit_price: 123.45, // matches neither snapshot price
    },
    SR
  );
  assert.equal(ambiguous, "unclassified");
});

// --- honesty: partial results -----------------------------------------------------

test("catalogue cost_rmb=0 ⇒ cost missing ⇒ overall partial (no fake 100% margins)", () => {
  const r = computeAffairProfitability(
    srInput({
      lines: [
        { product_id: "p1", quantity: 2, total_price: 500 },
      ],
      containers: [],
      srById: new Map(),
      catalogueCostRmb: new Map([["p1", 0]]), // the m084 default trap
    })
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const product = r.components.find((c) => c.key === "product")!;
  assert.equal(product.costMissing, true);
  assert.equal(product.marginPct, null);
  assert.equal(r.partial, true);
  assert.equal(r.overallPct, null); // nothing known ⇒ no fake overall
});

test("unclassified revenue keeps the grand total honest and flags partial", () => {
  const r = computeAffairProfitability(
    srInput({
      lines: [
        ...srInput().lines,
        {
          pricing_source: "approved_service_request",
          source_project_request_id: "sr-1",
          category_id: null,
          client_product_name: "Mystery",
          quantity: 1,
          total_price: 1000,
          original_unit_price: 999,
        },
      ],
    })
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.partial, true);
  // grand total includes the mystery line's revenue
  const expectedGT =
    productPricing.finalUnitPrice * 10 + polePricing.finalUnitPrice * 10 + 1000 + 800;
  assert.ok(Math.abs(r.grandTotal - expectedGT) < 0.02);
});

// --- multi-SR guard -----------------------------------------------------------------

test("soleSr: fallback only with exactly one costed SR", () => {
  const one = new Map([["a", SR]]);
  assert.equal(soleSr(one)!.id, "a");
  const two = new Map([
    ["a", SR],
    ["b", { ...SR }],
  ]);
  assert.equal(soleSr(two), null);
});

// --- grand total & freight ------------------------------------------------------------

test("grand total is recomputed from parts (stale documents.total_price is never an input)", () => {
  const r = computeAffairProfitability(
    srInput({
      docs: [{ ...baseDoc, insurance_cost: 120, additional_charges: [{ amount: 80 }] }],
    })
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const expected =
    productPricing.finalUnitPrice * 10 +
    polePricing.finalUnitPrice * 10 +
    800 + // freight containers
    120 +
    80;
  assert.ok(Math.abs(r.grandTotal - expected) < 0.02, `${r.grandTotal} vs ${expected}`);
});

test("BUSINESS RULE: transport NEVER generates margin — pure pass-through even when billed ≠ cost", () => {
  // The client is billed 800 of freight; whatever the real carrier cost is,
  // the freight component must contribute ZERO margin (owner rule 2026-07-08)
  // and the overall must equal the goods margin over the grand total.
  const r = computeAffairProfitability(srInput());
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const freight = r.components.find((c) => c.key === "freight")!;
  assert.equal(freight.revenue, 800);
  assert.equal(freight.cost, 800); // pass-through: cost ≡ billed
  assert.equal(freight.marginValue, null);
  assert.equal(freight.marginPct, null);
  const product = r.components.find((c) => c.key === "product")!;
  const pole = r.components.find((c) => c.key === "pole")!;
  const goodsMargin = (product.marginValue ?? 0) + (pole.marginValue ?? 0);
  assert.ok(Math.abs((r.grossProfit ?? 0) - goodsMargin) < 0.02);
  assert.ok(
    Math.abs((r.overallPct ?? 0) - (goodsMargin / r.grandTotal) * 100) < 0.01
  );
});

// --- thresholds ------------------------------------------------------------------------

test("healthFor boundaries: 30 green · 20-29 yellow · <20 red (owner defaults)", () => {
  assert.equal(healthFor(30), "green");
  assert.equal(healthFor(29.99), "yellow");
  assert.equal(healthFor(20), "yellow");
  assert.equal(healthFor(19.99), "red");
});

test("healthFor: inverted thresholds are normalized, never explosive", () => {
  assert.equal(healthFor(25, { greenMin: 20, yellowMin: 30 }), "green");
});

// --- currency guard ----------------------------------------------------------------------

test("non-USD leading doc ⇒ unavailable (v1 owner decision)", () => {
  const r = computeAffairProfitability(
    srInput({ docs: [{ ...baseDoc, currency: "EUR" }] })
  );
  assert.deepEqual(r, { ok: false, reason: "non_usd" });
});

// --- stripCommission unit ------------------------------------------------------------------

test("stripCommission: exact inverse of the engine's fold", () => {
  const engine = 100;
  const client = engine * 1.05;
  assert.ok(Math.abs(stripCommission(client, 5) - engine) < 1e-9);
  assert.equal(stripCommission(100, 0), 100);
  assert.equal(stripCommission(100, null), 100);
});
