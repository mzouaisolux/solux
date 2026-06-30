/**
 * Tests for manual production items — poles / masts / non-catalog lines (m135).
 * (lib/manual-items.ts)
 *
 * Run with:  npm test
 *
 * Pure (no DB / no server imports). These lock the business rule that "Launch
 * Production" applies when copying a quotation/proforma line into a production
 * task list line:
 *   - isManualLine: a line is manual iff it has NO product AND NO category.
 *   - buildTaskListLineFromQuotationLine: the exact insert row the conversion
 *     produces — manual items snapshot the free-text name + carry the quoted
 *     unit price (read-only ref); catalog + Service-Request lines do not.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isManualLine,
  buildTaskListLineFromQuotationLine,
  MANUAL_ITEM_FALLBACK_NAME,
} from "../lib/manual-items.ts";

// --- isManualLine ----------------------------------------------------------

test("isManualLine: catalog product line is NOT manual", () => {
  assert.equal(isManualLine("prod-123", null), false);
  assert.equal(isManualLine("prod-123", "cat-1"), false);
});

test("isManualLine: Service-Request family line (category, no product) is NOT manual", () => {
  // These keep the category-driven configurator + factory mapping.
  assert.equal(isManualLine(null, "cat-1"), false);
  assert.equal(isManualLine(undefined, "cat-1"), false);
});

test("isManualLine: pole/mast/custom line (no product, no category) IS manual", () => {
  assert.equal(isManualLine(null, null), true);
  assert.equal(isManualLine(undefined, undefined), true);
  assert.equal(isManualLine("", ""), true); // empty strings are falsy
});

// --- buildTaskListLineFromQuotationLine ------------------------------------

test("conversion: a pole becomes a manual item with name + reference price", () => {
  const row = buildTaskListLineFromQuotationLine(
    {
      product_id: null,
      category_id: null,
      client_product_name: "Pole 8m, hot-dip galvanized, arm 1.5m",
      unit_price: 1250,
      quantity: 4,
      selected_options: {},
      config_values: {},
    },
    "tl-1",
    0
  );
  assert.equal(row.is_manual, true);
  assert.equal(row.product_id, null);
  assert.equal(row.category_id, null);
  assert.equal(row.product_name, "Pole 8m, hot-dip galvanized, arm 1.5m");
  assert.equal(row.unit_price, 1250); // read-only reference, copied from quote
  assert.equal(row.quantity, 4);
  assert.equal(row.task_list_id, "tl-1");
  assert.equal(row.position, 0);
});

test("conversion: a manual line with no name falls back to the generic label", () => {
  const row = buildTaskListLineFromQuotationLine(
    { product_id: null, category_id: null, client_product_name: "  " },
    "tl-1",
    2
  );
  assert.equal(row.is_manual, true);
  assert.equal(row.product_name, MANUAL_ITEM_FALLBACK_NAME);
});

test("conversion: a catalog product line is NOT manual and snapshots nothing", () => {
  const row = buildTaskListLineFromQuotationLine(
    {
      product_id: "prod-9",
      category_id: "cat-3",
      client_product_name: "Client alias",
      unit_price: 999,
      quantity: 2,
    },
    "tl-1",
    1
  );
  assert.equal(row.is_manual, false);
  assert.equal(row.product_id, "prod-9");
  assert.equal(row.category_id, "cat-3");
  // No name/price snapshot: the page uses the live products join; price lives
  // on the proforma, not the task list.
  assert.equal(row.product_name, null);
  assert.equal(row.unit_price, null);
});

test("conversion: a Service-Request family line (category, no product) is NOT manual", () => {
  const row = buildTaskListLineFromQuotationLine(
    {
      product_id: null,
      category_id: "cat-aospro",
      client_product_name: "AOSPRO + (no model picked)",
      unit_price: 500,
      quantity: 1,
    },
    "tl-1",
    0
  );
  assert.equal(row.is_manual, false);
  assert.equal(row.category_id, "cat-aospro");
  assert.equal(row.product_name, null); // category name drives the display
  assert.equal(row.unit_price, null);
});

test("conversion: legacy selected_options merge under config_values (config wins)", () => {
  const row = buildTaskListLineFromQuotationLine(
    {
      product_id: "prod-1",
      category_id: "cat-1",
      selected_options: { CCT: "3000K", Optic: "Wide" },
      config_values: { CCT: "4000K" },
    },
    "tl-1",
    0
  );
  assert.deepEqual(row.config_values, { CCT: "4000K", Optic: "Wide" });
});
