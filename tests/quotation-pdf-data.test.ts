/**
 * buildQuotationPdfData (PRD-006 Phase 2, P2-1) — output-diff guard for the
 * extracted PDF-data builder. Pure, node test runner.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildQuotationPdfData } from "../lib/quotation-pdf-data.ts";

function baseInput(overrides: any = {}) {
  return {
    doc: {
      number: "SLX-SUK-26-034",
      type: "quotation",
      date: "2026-07-18",
      incoterm: "FOB",
      freight_type: "sea",
      total_price: 9153.9,
      show_commission_in_pdf: false,
    },
    lines: [],
    containers: [],
    client: null,
    clientCustomFields: [],
    effectiveFreight: 250,
    productionTime: null,
    currency: "USD",
    bankAccount: null,
    salesConditions: null,
    paymentLabel: "30% deposit, 70% before shipment",
    paymentMode: null,
    paymentTerms: null,
    allowedFieldsByCategory: null,
    specLabelById: new Map<string, string>(),
    ...overrides,
  } as any;
}

test("header fields map straight through, freight uses the effective value", () => {
  const d = buildQuotationPdfData(baseInput());
  assert.equal(d.number, "SLX-SUK-26-034");
  assert.equal(d.type, "quotation");
  assert.equal(d.freight_cost, 250); // effectiveFreight, not doc.freight_cost
  assert.equal(d.total_price, 9153.9);
  assert.equal(d.commission_amount, 0); // hidden → 0
  assert.equal(d.commission_visible, false);
});

test("product name falls back: product → snapshot → client name → dash", () => {
  const d = buildQuotationPdfData(
    baseInput({
      lines: [
        { id: "a", products: { name: "SLK Pro 15" }, quantity: 2, unit_price: 10, total_price: 20 },
        { id: "b", product_name: "Snapshot name", quantity: 1, unit_price: 5, total_price: 5 },
        { id: "c", client_product_name: "  Free text  ", quantity: 1, unit_price: 1, total_price: 1 },
        { id: "d", quantity: 1, unit_price: 0, total_price: 0 },
      ],
    })
  );
  assert.equal(d.lines[0].product_name, "SLK Pro 15");
  assert.equal(d.lines[1].product_name, "Snapshot name");
  assert.equal(d.lines[2].product_name, "Free text");
  assert.equal(d.lines[3].product_name, "—");
});

test("client reference is suppressed for free-text lines", () => {
  const d = buildQuotationPdfData(
    baseInput({
      lines: [
        // catalogue line: client ref kept
        { id: "a", products: { name: "SLK Pro 15" }, client_product_name: "SolarMax 40", quantity: 1, unit_price: 1, total_price: 1 },
        // free-text line: client name IS the primary → ref suppressed
        { id: "b", client_product_name: "Custom thing", quantity: 1, unit_price: 1, total_price: 1 },
      ],
    })
  );
  assert.equal(d.lines[0].client_product_name, "SolarMax 40");
  assert.equal(d.lines[1].client_product_name, null);
});

test("visible config is filtered by the allow-list per category", () => {
  const d = buildQuotationPdfData(
    baseInput({
      allowedFieldsByCategory: new Map([["cat1", new Set(["CCT", "Optic"])]]),
      lines: [
        {
          id: "a",
          products: { category_id: "cat1" },
          config_values: { CCT: "4000K", Optic: "Type II", InternalOnly: "secret" },
          quantity: 1,
          unit_price: 1,
          total_price: 1,
        },
      ],
    })
  );
  const fields = d.lines[0].visible_config_fields!.map((f) => f.field_name);
  assert.deepEqual(fields.sort(), ["CCT", "Optic"]); // InternalOnly dropped
});

test("the frozen spec label is attached from the map (m177)", () => {
  const d = buildQuotationPdfData(
    baseInput({
      specLabelById: new Map([["v1", "2604"]]),
      lines: [{ id: "a", products: { name: "X" }, spec_version_id: "v1", quantity: 1, unit_price: 1, total_price: 1 }],
    })
  );
  assert.equal(d.lines[0].spec_label, "2604");
});

test("sales_conditions is passed through pre-resolved", () => {
  assert.equal(buildQuotationPdfData(baseInput({ salesConditions: null })).sales_conditions, null);
  assert.equal(
    buildQuotationPdfData(baseInput({ salesConditions: "Warranty 2y" })).sales_conditions,
    "Warranty 2y"
  );
});
