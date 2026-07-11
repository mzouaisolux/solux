import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isSolarPanelField,
  mapDocumentLineToRequestLine,
  versionedHistory,
  isTransportTablesMissing,
  transportKindLabel,
  TRANSPORT_KINDS,
} from "../lib/transport-request.ts";

test("isSolarPanelField matches the catalog naming variants", () => {
  assert.equal(isSolarPanelField("SOLAR PANEL"), true);
  assert.equal(isSolarPanelField("Solar panel"), true);
  assert.equal(isSolarPanelField("solarpanel size"), true);
  assert.equal(isSolarPanelField("BATTERY"), false);
  assert.equal(isSolarPanelField("Panel"), false);
});

test("mapDocumentLineToRequestLine keeps product, qty and exact config", () => {
  const mapped = mapDocumentLineToRequestLine(
    {
      product_id: "p1",
      category_id: "c1",
      quantity: "25",
      config_values: { "SOLAR PANEL": "430W", BATTERY: "25.6V 65Ah" },
      client_product_name: "SSLX Pro 60 — project version",
    },
    "SSLX PRO 60"
  );
  assert.ok(mapped);
  assert.equal(mapped.product_id, "p1");
  assert.equal(mapped.product_name, "SSLX PRO 60");
  assert.equal(mapped.quantity, 25);
  assert.equal(mapped.config_values["SOLAR PANEL"], "430W");
});

test("mapDocumentLineToRequestLine keeps free-text lines (custom pole), drops empty rows", () => {
  const pole = mapDocumentLineToRequestLine({
    product_id: null,
    quantity: 4,
    client_product_name: "Custom pole 8m double arm",
    config_values: {},
  });
  assert.ok(pole);
  assert.equal(pole.product_id, null);
  assert.equal(pole.client_product_name, "Custom pole 8m double arm");

  const empty = mapDocumentLineToRequestLine({
    product_id: null,
    client_product_name: "  ",
    quantity: 1,
  });
  assert.equal(empty, null);
});

test("mapDocumentLineToRequestLine normalizes bad quantities to 1", () => {
  const m = mapDocumentLineToRequestLine({
    product_id: "p1",
    quantity: "not-a-number",
  });
  assert.ok(m);
  assert.equal(m.quantity, 1);
});

test("versionedHistory numbers completed price rows oldest-first, ignores packing/cancelled", () => {
  const rows = [
    { id: "d", kind: "price_update", status: "completed", completed_at: "2026-07-18" },
    { id: "a", kind: "price", status: "completed", completed_at: "2026-06-12" },
    { id: "b", kind: "packing_list", status: "completed", completed_at: "2026-06-20" },
    { id: "c", kind: "price", status: "cancelled", completed_at: "2026-06-25" },
    { id: "e", kind: "price_update", status: "completed", completed_at: "2026-07-04" },
  ];
  const versions = versionedHistory(rows);
  assert.deepEqual(
    versions.map((v) => [v.version, v.id]),
    [
      [1, "a"],
      [2, "e"],
      [3, "d"],
    ]
  );
});

test("versionedHistory is deterministic on completed_at ties (id tiebreak)", () => {
  const rows = [
    { id: "z", kind: "price", status: "completed", completed_at: "2026-07-01" },
    { id: "a", kind: "price", status: "completed", completed_at: "2026-07-01" },
  ];
  const versions = versionedHistory(rows);
  assert.deepEqual(versions.map((v) => v.id), ["a", "z"]);
});

test("isTransportTablesMissing classifies dormant-mode errors", () => {
  assert.equal(isTransportTablesMissing({ code: "42P01", message: "x" }), true);
  assert.equal(isTransportTablesMissing({ code: "PGRST205", message: "x" }), true);
  assert.equal(
    isTransportTablesMissing({ message: 'relation "transport_requests" does not exist' }),
    true
  );
  assert.equal(isTransportTablesMissing({ code: "42703", message: "other" }), false);
});

test("kind catalog is complete and labelled", () => {
  assert.equal(TRANSPORT_KINDS.length, 3);
  assert.equal(transportKindLabel("packing_list"), "New Packing List Request");
  assert.equal(transportKindLabel("unknown"), "unknown");
});
