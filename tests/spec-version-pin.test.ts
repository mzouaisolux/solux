/**
 * m177 — Spec-version PIN + YYMM label (Section 17). Pure logic only (no DB, no
 * @/ alias) so it runs under the node type-stripping test runner.
 *
 *   • versionLabel — the sales-facing YYMM label derived from published_at
 *     (v1.x stays internal), same-month collision suffixes, and the qualifier.
 *   • manual-items — the pin is snapshotted from the quotation line onto the
 *     production task-list line at conversion.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  yymm,
  buildVersionLabels,
  labelFor,
  qualifier,
  latestVersionIdByCategory,
  buildVersionLabelsForCategories,
} from "../features/product-knowledge-hub/lib/versionLabel.ts";
import { buildTaskListLineFromQuotationLine } from "../lib/manual-items.ts";

/* ---- yymm ---- */

test("yymm derives YYMM (UTC) from an ISO date, null when unparseable", () => {
  assert.equal(yymm("2026-04-08T00:00:00.000Z"), "2604");
  assert.equal(yymm("2025-11-03"), "2511");
  assert.equal(yymm("2026-01-31T23:00:00.000Z"), "2601"); // UTC, not local
  assert.equal(yymm(null), null);
  assert.equal(yymm(""), null);
  assert.equal(yymm("not-a-date"), null);
});

/* ---- buildVersionLabels ---- */

test("buildVersionLabels: one label per version, YYMM from publish date", () => {
  const labels = buildVersionLabels([
    { id: "c", version: "v1.2", published_at: "2026-04-08" },
    { id: "b", version: "v1.1", published_at: "2026-01-12" },
    { id: "a", version: "v1.0", published_at: "2025-11-03" },
  ]);
  assert.equal(labels.get("a"), "2511");
  assert.equal(labels.get("b"), "2601");
  assert.equal(labels.get("c"), "2604");
});

test("buildVersionLabels: same-month collisions get -r2/-r3, oldest keeps base", () => {
  const labels = buildVersionLabels([
    { id: "late", version: "v1.2", published_at: "2026-04-20" },
    { id: "mid", version: "v1.1", published_at: "2026-04-10" },
    { id: "early", version: "v1.0", published_at: "2026-04-02" },
  ]);
  assert.equal(labels.get("early"), "2604");
  assert.equal(labels.get("mid"), "2604-r2");
  assert.equal(labels.get("late"), "2604-r3");
});

test("buildVersionLabels: undated version falls back to its internal string", () => {
  const labels = buildVersionLabels([
    { id: "x", version: "v1.0", published_at: null },
  ]);
  assert.equal(labels.get("x"), "v1.0");
});

/* ---- labelFor ---- */

test("labelFor: map hit, then version fallback, then id-slice", () => {
  const labels = new Map([["id-1", "2604"]]);
  assert.equal(labelFor("id-1", labels), "2604");
  assert.equal(labelFor("missing", labels, "v1.1"), "v1.1");
  assert.equal(labelFor("abcdef1234567890", labels), "abcdef12");
  assert.equal(labelFor(null, labels), "—");
});

/* ---- qualifier ---- */

test("qualifier: SKU is never shown without its spec label beside it", () => {
  assert.equal(qualifier("APF-100", "2604"), "APF-100 — Spec 2604");
  assert.equal(qualifier("APF-100", null), "APF-100");
  assert.equal(qualifier(null, "2604"), "Spec 2604");
  assert.equal(qualifier(null, null), "—");
  assert.equal(qualifier("  ", "  "), "—"); // whitespace ignored
});

/* ---- pin snapshot at conversion ---- */

test("conversion snapshots the spec-version pin onto the task-list line", () => {
  const row = buildTaskListLineFromQuotationLine(
    { product_id: "p1", category_id: "cat1", quantity: 120, spec_version_id: "ver-2601" },
    "tl-1",
    0
  );
  assert.equal(row.spec_version_id, "ver-2601");
  assert.equal(row.product_id, "p1");
  assert.equal(row.is_manual, false);
});

test("conversion: a line with no pin snapshots null (unpinned)", () => {
  const row = buildTaskListLineFromQuotationLine(
    { product_id: "p1", category_id: "cat1", quantity: 1 },
    "tl-1",
    0
  );
  assert.equal(row.spec_version_id, null);
});

test("conversion: manual pole line still becomes manual AND carries any pin", () => {
  const row = buildTaskListLineFromQuotationLine(
    {
      product_id: null,
      category_id: null,
      client_product_name: "Pole 8m",
      unit_price: 450,
      quantity: 30,
      spec_version_id: "ver-x",
    },
    "tl-1",
    2
  );
  assert.equal(row.is_manual, true);
  assert.equal(row.product_name, "Pole 8m");
  assert.equal(row.unit_price, 450);
  assert.equal(row.spec_version_id, "ver-x");
});

/* ---- latestVersionIdByCategory (freeze-at-send) ---- */

test("latestVersionIdByCategory picks the newest published id per family", () => {
  const latest = latestVersionIdByCategory([
    { id: "a1", category_id: "catA", version: "v1.0", published_at: "2026-01-10" },
    { id: "a2", category_id: "catA", version: "v1.1", published_at: "2026-04-08" },
    { id: "b1", category_id: "catB", version: "v1.0", published_at: "2026-03-01" },
  ]);
  assert.equal(latest.get("catA"), "a2"); // April beats January
  assert.equal(latest.get("catB"), "b1");
  assert.equal(latest.size, 2);
});

test("latestVersionIdByCategory: a dated version beats an undated one", () => {
  const latest = latestVersionIdByCategory([
    { id: "u", category_id: "catA", version: "v1.0", published_at: null },
    { id: "d", category_id: "catA", version: "v1.1", published_at: "2026-02-01" },
  ]);
  assert.equal(latest.get("catA"), "d");
});

test("latestVersionIdByCategory: undated-only family still resolves; junk skipped", () => {
  const latest = latestVersionIdByCategory([
    { id: "only", category_id: "catA", version: "v1.0", published_at: null },
    { id: "", category_id: "catB", version: "v1.0", published_at: "2026-01-01" },
    { id: "x", category_id: "", version: "v1.0", published_at: "2026-01-01" },
  ]);
  assert.equal(latest.get("catA"), "only");
  assert.equal(latest.has("catB"), false); // empty id skipped
  assert.equal(latest.has(""), false); // empty category skipped
});

/* ---- buildVersionLabelsForCategories (multi-family display) ---- */

test("buildVersionLabelsForCategories merges per-family labels into one id map", () => {
  const labels = buildVersionLabelsForCategories([
    { id: "a1", category_id: "catA", version: "v1.0", published_at: "2026-04-08" },
    { id: "b1", category_id: "catB", version: "v1.0", published_at: "2026-04-20" },
  ]);
  assert.equal(labels.get("a1"), "2604");
  assert.equal(labels.get("b1"), "2604"); // same month, DIFFERENT family — no -r2
});

test("buildVersionLabelsForCategories keeps collision suffixes scoped per family", () => {
  const labels = buildVersionLabelsForCategories([
    { id: "a1", category_id: "catA", version: "v1.0", published_at: "2026-04-08" },
    { id: "a2", category_id: "catA", version: "v1.1", published_at: "2026-04-25" },
    { id: "b1", category_id: "catB", version: "v1.0", published_at: "2026-04-30" },
  ]);
  assert.equal(labels.get("a1"), "2604"); // oldest in month keeps base
  assert.equal(labels.get("a2"), "2604-r2"); // same family + month → suffix
  assert.equal(labels.get("b1"), "2604"); // other family unaffected
});
