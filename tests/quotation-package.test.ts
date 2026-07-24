/**
 * Quotation package coverage plan (PRD-006, P0-1 + P0-4). Pure logic, node
 * test runner, no @/ alias.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPackagePlan,
  includedDatasheets,
  coverageLabel,
  datasheetKey,
  type PackageLineInput,
  type DatasheetRef,
} from "../lib/quotation-package.ts";

const ds = (path: string, name?: string): DatasheetRef => ({
  storage_path: path,
  storage_name: name ?? null,
});
const k = datasheetKey;

/* ---- the PRD P0-4 acceptance example ---- */

test("3 of 4 catalogue lines resolve; the unpublished one is named missing", () => {
  const lines: PackageLineInput[] = [
    { id: "l1", product_id: "p1", spec_version_id: "v1", product_name: "SLK Pro 15" },
    { id: "l2", product_id: "p2", spec_version_id: "v2", product_name: "ADA B80" },
    { id: "l3", product_id: "p3", spec_version_id: "v3", product_name: "Colarsun 42" },
    { id: "l4", product_id: "p4", spec_version_id: null, product_name: "New model" }, // no published spec → unpinned
  ];
  const sheets = new Map<string, DatasheetRef>([
    [k("p1", "v1"), ds("spec-sheets/p1/v1.pdf")],
    [k("p2", "v2"), ds("spec-sheets/p2/v2.pdf")],
    [k("p3", "v3"), ds("spec-sheets/p3/v3.pdf")],
  ]);

  const plan = buildPackagePlan(lines, sheets);
  assert.equal(plan.includedCount, 3);
  assert.equal(plan.missingCount, 1);
  assert.equal(coverageLabel(plan), "3 of 4 datasheets included");

  const missed = plan.items.find((i) => !i.included);
  assert.equal(missed?.line_id, "l4");
  assert.equal(missed?.reason, "no_pin");
});

/* ---- m182: per-line include_datasheet (Change 1) ---- */

test("an un-ticked line is 'excluded' — not included, and NOT counted missing", () => {
  const lines: PackageLineInput[] = [
    { id: "l1", product_id: "p1", spec_version_id: "v1", product_name: "ADA B80" },
    { id: "l2", product_id: "p2", spec_version_id: "v2", product_name: "ADA M45", include_datasheet: false },
  ];
  const sheets = new Map<string, DatasheetRef>([
    [k("p1", "v1"), ds("spec-sheets/p1/v1.pdf")],
    [k("p2", "v2"), ds("spec-sheets/p2/v2.pdf")],
  ]);

  const plan = buildPackagePlan(lines, sheets);
  assert.equal(plan.includedCount, 1, "only the ticked line attaches");
  assert.equal(plan.missingCount, 0, "an excluded line is a choice, not a gap");

  const excluded = plan.items.find((i) => i.line_id === "l2");
  assert.equal(excluded?.included, false);
  assert.equal(excluded?.reason, "excluded");

  assert.deepEqual(
    includedDatasheets(plan).map((i) => i.line_id),
    ["l1"]
  );
});

test("include_datasheet undefined or true both attach (back-compat)", () => {
  const lines: PackageLineInput[] = [
    { id: "l1", product_id: "p1", spec_version_id: "v1", product_name: "A" },
    { id: "l2", product_id: "p2", spec_version_id: "v2", product_name: "B", include_datasheet: true },
  ];
  const sheets = new Map<string, DatasheetRef>([
    [k("p1", "v1"), ds("a.pdf")],
    [k("p2", "v2"), ds("b.pdf")],
  ]);
  const plan = buildPackagePlan(lines, sheets);
  assert.equal(plan.includedCount, 2);
  assert.equal(plan.missingCount, 0);
});

/* ---- reasons ---- */

test("a free-text / custom line (no product) is no_product and NOT counted missing", () => {
  const plan = buildPackagePlan(
    [{ id: "pole", product_id: null, spec_version_id: null, product_name: "Custom pole 8m" }],
    new Map()
  );
  assert.equal(plan.items[0].reason, "no_product");
  assert.equal(plan.items[0].included, false);
  assert.equal(plan.includedCount, 0);
  assert.equal(plan.missingCount, 0); // N/A, not a gap
  assert.equal(coverageLabel(plan), "no catalogue datasheets");
});

test("a pinned line with no datasheet in the map is no_datasheet and counts missing", () => {
  const plan = buildPackagePlan(
    [{ id: "l1", product_id: "p1", spec_version_id: "v1" }],
    new Map() // no datasheet resolved
  );
  assert.equal(plan.items[0].reason, "no_datasheet");
  assert.equal(plan.missingCount, 1);
  assert.equal(plan.includedCount, 0);
});

test("an included line carries the datasheet storage path + name", () => {
  const plan = buildPackagePlan(
    [{ id: "l1", product_id: "p1", spec_version_id: "v1" }],
    new Map([[k("p1", "v1"), ds("spec-sheets/p1/v1.pdf", "SLK_Pro_15_v1.pdf")]])
  );
  const it = plan.items[0];
  assert.equal(it.included, true);
  assert.equal(it.reason, null);
  assert.equal(it.storage_path, "spec-sheets/p1/v1.pdf");
  assert.equal(it.storage_name, "SLK_Pro_15_v1.pdf");
});

/* ---- labels + included set ---- */

test("spec labels are attached from the label map when provided", () => {
  const plan = buildPackagePlan(
    [{ id: "l1", product_id: "p1", spec_version_id: "v1" }],
    new Map([[k("p1", "v1"), ds("a.pdf")]]),
    new Map([["v1", "2604"]])
  );
  assert.equal(plan.items[0].spec_label, "2604");
});

test("includedDatasheets returns only the merge-ready lines, in order", () => {
  const lines: PackageLineInput[] = [
    { id: "l1", product_id: "p1", spec_version_id: "v1" },
    { id: "l2", product_id: null, spec_version_id: null },
    { id: "l3", product_id: "p3", spec_version_id: "v3" },
  ];
  const sheets = new Map<string, DatasheetRef>([
    [k("p1", "v1"), ds("1.pdf")],
    [k("p3", "v3"), ds("3.pdf")],
  ]);
  const inc = includedDatasheets(buildPackagePlan(lines, sheets));
  assert.deepEqual(inc.map((i) => i.line_id), ["l1", "l3"]);
});

test("empty quotation → empty plan, safe counts", () => {
  const plan = buildPackagePlan([], new Map());
  assert.deepEqual(plan.items, []);
  assert.equal(plan.includedCount, 0);
  assert.equal(plan.missingCount, 0);
});
