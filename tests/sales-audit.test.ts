/**
 * Sales & Analytics — audit diff (§5). One row per changed field, no phantom
 * diffs from blank↔null or number↔string.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { diffFields, markerEntry } from "../lib/sales/audit.ts";

test("emits one entry per changed field only", () => {
  const before = { sales_amount: 100, country: "USA", pi_no: "SLX1" };
  const after = { sales_amount: 200, country: "USA", pi_no: "SLX1" };
  const entries = diffFields("sales_order", "o1", before, after, ["sales_amount", "country", "pi_no"], "u1");
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0], {
    entity_type: "sales_order",
    entity_id: "o1",
    action: "update",
    field: "sales_amount",
    old_value: "100",
    new_value: "200",
    user_id: "u1",
  });
});

test("blank↔null and number↔string do not produce phantom diffs", () => {
  const entries = diffFields(
    "sales_order",
    "o1",
    { name: "", amount: 100 },
    { name: null, amount: "100" },
    ["name", "amount"],
    "u1",
  );
  assert.deepEqual(entries, []);
});

test("setting a value from empty records old_value null", () => {
  const entries = diffFields("sales_client", "c1", { main_country: "" }, { main_country: "France" }, ["main_country"], null);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].old_value, null);
  assert.equal(entries[0].new_value, "France");
});

test("marker entry for create/delete/merge", () => {
  const e = markerEntry("sales_order", "o1", "create", "u1");
  assert.equal(e.action, "create");
  assert.equal(e.field, null);
});
