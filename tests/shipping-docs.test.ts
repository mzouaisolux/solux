/**
 * Export shipping-documents package tests (m115 — lib/shipping-docs).
 *
 * Run with:  npm test   (Node ≥ 22.6, built-in runner + native TS stripping)
 *
 * Locks in the checklist derivation: the mandatory trio (Commercial
 * Invoice, Packing List, B/L / AWB), the LC package when payment terms
 * involve a Letter of Credit, client-BL-profile-driven requirements,
 * the never-downgrade rule and the level ordering.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  requiredShippingDocs,
  computeShippingDocsReadiness,
} from "../lib/shipping-docs.ts";

test("baseline: mandatory trio + the two always-visible optionals", () => {
  const reqs = requiredShippingDocs({ paymentMode: null, blDocuments: null });
  assert.deepEqual(
    reqs.map((r) => `${r.kind}:${r.level}`),
    [
      // mandatory first (alphabetical by label within a level)
      "bill_of_lading:mandatory",
      "commercial_invoice:mandatory",
      "packing_list:mandatory",
      // optionals last
      "certificate_of_origin:optional",
      "inspection_report:optional",
    ]
  );
});

test("LC payment mode adds the LC documents package as required", () => {
  for (const mode of ["lc", "hybrid"] as const) {
    const reqs = requiredShippingDocs({ paymentMode: mode, blDocuments: null });
    const lc = reqs.find((r) => r.kind === "lc_documents");
    assert.ok(lc, `${mode}: lc_documents row expected`);
    assert.equal(lc!.level, "required");
  }
  const noLc = requiredShippingDocs({
    paymentMode: "deposit_balance",
    blDocuments: null,
  });
  assert.equal(noLc.find((r) => r.kind === "lc_documents"), undefined);
});

test("client BL profile upgrades ticked documents to required", () => {
  const reqs = requiredShippingDocs({
    paymentMode: "deposit_balance",
    blDocuments: [
      { key: "certificate_of_origin", included: true },
      { key: "ectn", included: true },
      { key: "battery_msds", included: false }, // unticked → ignored
    ],
  });
  assert.equal(
    reqs.find((r) => r.kind === "certificate_of_origin")!.level,
    "required"
  );
  assert.equal(reqs.find((r) => r.kind === "ectn")!.level, "required");
  assert.equal(reqs.find((r) => r.kind === "battery_msds"), undefined);
});

test("profile rows never downgrade a mandatory document", () => {
  const reqs = requiredShippingDocs({
    paymentMode: null,
    blDocuments: [{ key: "commercial_invoice", included: true }],
  });
  assert.equal(
    reqs.find((r) => r.kind === "commercial_invoice")!.level,
    "mandatory"
  );
});

test("custom profile rows (unknown keys) are ignored, not crashed on", () => {
  const reqs = requiredShippingDocs({
    paymentMode: null,
    blDocuments: [{ key: "my_custom_local_permit", included: true }],
  });
  assert.equal(
    reqs.some((r) => (r.kind as string) === "my_custom_local_permit"),
    false
  );
});

test("readiness: required docs gate, optional docs never block", () => {
  const reqs = requiredShippingDocs({ paymentMode: null, blDocuments: null });
  // none present
  const empty = computeShippingDocsReadiness(reqs, []);
  assert.equal(empty.requiredTotal, 3);
  assert.equal(empty.requiredReady, 0);
  assert.equal(empty.optionalTotal, 2);
  assert.equal(empty.allRequiredReady, false);
  // 2 of 3 required present
  const partial = computeShippingDocsReadiness(reqs, [
    "commercial_invoice",
    "packing_list",
  ]);
  assert.equal(partial.requiredReady, 2);
  assert.equal(partial.allRequiredReady, false);
  // all required present, zero optionals → READY (optionals don't block)
  const ready = computeShippingDocsReadiness(reqs, [
    "commercial_invoice",
    "packing_list",
    "bill_of_lading",
  ]);
  assert.equal(ready.allRequiredReady, true);
  assert.equal(ready.optionalReady, 0);
});

test("readiness: profile-driven documents count as required", () => {
  const reqs = requiredShippingDocs({
    paymentMode: "lc",
    blDocuments: [{ key: "ectn", included: true }],
  });
  // mandatory trio + lc_documents + ectn = 5 required
  const r = computeShippingDocsReadiness(reqs, [
    "commercial_invoice",
    "packing_list",
    "bill_of_lading",
  ]);
  assert.equal(r.requiredTotal, 5);
  assert.equal(r.requiredReady, 3);
  assert.equal(r.allRequiredReady, false);
});

test("levels are grouped: mandatory → required → optional", () => {
  const reqs = requiredShippingDocs({
    paymentMode: "lc",
    blDocuments: [{ key: "form_e_eur1", included: true }],
  });
  const levels = reqs.map((r) => r.level);
  const firstRequired = levels.indexOf("required");
  const firstOptional = levels.indexOf("optional");
  assert.ok(levels.lastIndexOf("mandatory") < firstRequired);
  assert.ok(levels.lastIndexOf("required") < firstOptional);
});
