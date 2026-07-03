/**
 * Quick Update workspace — pure metadata + filter tests.
 *
 * Locks in the two things that must not silently drift:
 *   1. The granular-save whitelist (EDITABLE_FIELDS) — only neutral,
 *      side-effect-free fields; NEVER status/deposit/balance/shipment_booked
 *      (those must go through their bundle actions with their side effects).
 *   2. The smart-filter predicates — the exact "who shows up in this pill"
 *      logic operations relies on.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  QUICK_UPDATE_COLUMNS,
  DEFAULT_VISIBLE_KEYS,
  EDITABLE_FIELDS,
  isEditableField,
  daysBetweenISO,
  SMART_FILTERS,
  getSmartFilter,
  matchesSearch,
  facetValues,
  type QuickUpdateRow,
} from "../lib/quick-update-columns.ts";

function makeRow(overrides: Partial<QuickUpdateRow> = {}): QuickUpdateRow {
  const base: QuickUpdateRow = {
    id: "o1",
    number: "PO-SLX-ZEA-26-002",
    detailHref: "/production/orders/o1",
    clientName: "Acme Co",
    clientCode: "ZEA",
    country: "Benin",
    clientId: "c1",
    salesLabel: "Sam Sales",
    salesOwnerId: "u-sam",
    status: "in_production",
    archived: false,
    currency: "USD",
    paymentState: "deposit_received",
    expectedDeposit: 10000,
    depositReceived: 10000,
    expectedBalance: 90000,
    balanceReceived: 0,
    balanceRemaining: 90000,
    depositReceivedAt: "2026-06-01",
    balanceReceivedAt: null,
    balanceDueDate: null,
    lcExpiryDate: null,
    paymentNotes: null,
    initialDeadline: "2026-07-01",
    currentEta: "2026-07-10",
    factoryDelayDays: 0,
    externalDelayDays: 0,
    shipmentBooked: false,
    etd: null,
    eta: null,
    carrier: null,
    bookingNumber: null,
    containerNumber: null,
    trackingUrl: null,
    blNumber: null,
    blStatus: "missing",
    ciNumber: null,
    docsReady: 0,
    docsTotal: 3,
    notes: null,
    alertLevel: "ok",
    alertLabel: "On track",
    updatedAt: "2026-06-20T10:00:00Z",
  };
  return { ...base, ...overrides };
}

/* -------- column catalogue -------- */

test("column keys are unique and PO Number is the sticky first column", () => {
  const keys = QUICK_UPDATE_COLUMNS.map((c) => c.key);
  assert.equal(new Set(keys).size, keys.length, "duplicate column key");
  assert.equal(QUICK_UPDATE_COLUMNS[0].key, "number");
  assert.equal(QUICK_UPDATE_COLUMNS[0].sticky, true);
});

test("DEFAULT_VISIBLE_KEYS excludes columns marked defaultVisible:false", () => {
  assert.ok(DEFAULT_VISIBLE_KEYS.includes("status"));
  assert.ok(DEFAULT_VISIBLE_KEYS.includes("carrier"));
  assert.ok(!DEFAULT_VISIBLE_KEYS.includes("booking")); // opt-in column
  assert.ok(!DEFAULT_VISIBLE_KEYS.includes("production_deadline"));
});

test("every text/date column edits a whitelisted field", () => {
  for (const col of QUICK_UPDATE_COLUMNS) {
    if (col.kind === "text" || col.kind === "date" || col.kind === "number") {
      assert.ok(col.field, `${col.key} must name a field`);
      assert.ok(
        isEditableField(col.field!),
        `${col.key} → ${col.field} must be in EDITABLE_FIELDS`
      );
    }
  }
});

/* -------- editable-field whitelist -------- */

test("EDITABLE_FIELDS holds only neutral shipment fields, never workflow fields", () => {
  // neutral, granular-safe
  assert.ok(isEditableField("etd"));
  assert.ok(isEditableField("eta"));
  assert.ok(isEditableField("forwarder"));
  assert.ok(isEditableField("booking_number"));
  assert.ok(isEditableField("container_number"));
  assert.ok(isEditableField("tracking_url"));
  assert.ok(isEditableField("shipping_notes"));
  // side-effect fields must NOT be granular-editable
  assert.ok(!isEditableField("status"));
  assert.ok(!isEditableField("deposit_received_amount"));
  assert.ok(!isEditableField("balance_received_amount"));
  assert.ok(!isEditableField("shipment_booked"));
  assert.ok(!isEditableField("balance_due_date"));
  // every whitelisted field carries a capability
  for (const [f, meta] of Object.entries(EDITABLE_FIELDS)) {
    assert.ok(meta.capability.startsWith("production_order."), `${f} capability`);
  }
});

/* -------- date helper -------- */

test("daysBetweenISO computes signed calendar days and tolerates timestamps", () => {
  assert.equal(daysBetweenISO("2026-07-01", "2026-07-10"), 9);
  assert.equal(daysBetweenISO("2026-07-10", "2026-07-01"), -9);
  assert.equal(daysBetweenISO("2026-07-01T12:00:00Z", "2026-07-08"), 7);
  assert.equal(daysBetweenISO(null, "2026-07-10"), null);
  assert.equal(daysBetweenISO("nope", "2026-07-10"), null);
});

/* -------- smart filters -------- */

const CTX = { today: "2026-07-05", currentUserId: "u-sam" };

test("waiting_deposit matches only awaiting_deposit orders", () => {
  const f = getSmartFilter("waiting_deposit")!;
  assert.ok(f.test(makeRow({ status: "awaiting_deposit" }), CTX));
  assert.ok(!f.test(makeRow({ status: "in_production" }), CTX));
});

test("waiting_shipment = produced but not yet booked", () => {
  const f = getSmartFilter("waiting_shipment")!;
  assert.ok(
    f.test(makeRow({ status: "production_completed", shipmentBooked: false }), CTX)
  );
  assert.ok(
    !f.test(makeRow({ status: "production_completed", shipmentBooked: true }), CTX)
  );
  assert.ok(!f.test(makeRow({ status: "in_production" }), CTX));
});

test("bl_missing fires in shipping phase with no BL number, not on early/terminal orders", () => {
  const f = getSmartFilter("bl_missing")!;
  assert.ok(
    f.test(makeRow({ status: "production_completed", blNumber: null }), CTX)
  );
  assert.ok(
    f.test(makeRow({ shipmentBooked: true, blNumber: null }), CTX)
  );
  assert.ok(
    !f.test(makeRow({ status: "production_completed", blNumber: "BL-1" }), CTX)
  );
  assert.ok(!f.test(makeRow({ status: "in_production", blNumber: null }), CTX));
  assert.ok(!f.test(makeRow({ status: "delivered", blNumber: null }), CTX));
});

test("eta_this_week is the [today, today+7] window on currentEta", () => {
  const f = getSmartFilter("eta_this_week")!;
  assert.ok(f.test(makeRow({ currentEta: "2026-07-05" }), CTX)); // today
  assert.ok(f.test(makeRow({ currentEta: "2026-07-12" }), CTX)); // +7
  assert.ok(!f.test(makeRow({ currentEta: "2026-07-13" }), CTX)); // +8
  assert.ok(!f.test(makeRow({ currentEta: "2026-07-04" }), CTX)); // yesterday
  assert.ok(!f.test(makeRow({ currentEta: null }), CTX));
});

test("late = overdue alert OR a positive factory delay", () => {
  const f = getSmartFilter("late")!;
  assert.ok(f.test(makeRow({ alertLevel: "overdue" }), CTX));
  assert.ok(f.test(makeRow({ factoryDelayDays: 3 }), CTX));
  assert.ok(!f.test(makeRow({ alertLevel: "ok", factoryDelayDays: 0 }), CTX));
  assert.ok(!f.test(makeRow({ externalDelayDays: 5 }), CTX)); // external ≠ late
});

test("waiting_documents = required docs incomplete on non-terminal orders", () => {
  const f = getSmartFilter("waiting_documents")!;
  assert.ok(f.test(makeRow({ docsReady: 1, docsTotal: 3 }), CTX));
  assert.ok(!f.test(makeRow({ docsReady: 3, docsTotal: 3 }), CTX));
  assert.ok(!f.test(makeRow({ docsReady: 0, docsTotal: 0 }), CTX));
  assert.ok(
    !f.test(makeRow({ status: "delivered", docsReady: 0, docsTotal: 3 }), CTX)
  );
});

test("my_orders keys off the sales owner and needs a current user", () => {
  const f = getSmartFilter("my_orders")!;
  assert.ok(f.test(makeRow({ salesOwnerId: "u-sam" }), CTX));
  assert.ok(!f.test(makeRow({ salesOwnerId: "u-other" }), CTX));
  assert.ok(
    !f.test(makeRow({ salesOwnerId: "u-sam" }), { today: CTX.today, currentUserId: null })
  );
});

test("all SMART_FILTERS are addressable by id", () => {
  for (const f of SMART_FILTERS) {
    assert.equal(getSmartFilter(f.id)?.id, f.id);
  }
});

/* -------- search + facets -------- */

test("matchesSearch spans number, client, code, carrier, BL and container", () => {
  const row = makeRow({
    carrier: "MSC",
    blNumber: "MSCU-44",
    containerNumber: "MSCU456987",
  });
  assert.ok(matchesSearch(row, "")); // empty = all
  assert.ok(matchesSearch(row, "zea")); // client code, case-insensitive
  assert.ok(matchesSearch(row, "acme")); // client name
  assert.ok(matchesSearch(row, "msc")); // carrier
  assert.ok(matchesSearch(row, "456987")); // container
  assert.ok(!matchesSearch(row, "zzzzz"));
});

test("facetValues returns distinct sorted non-null values", () => {
  const rows = [
    makeRow({ country: "Benin" }),
    makeRow({ country: "Togo" }),
    makeRow({ country: "Benin" }),
    makeRow({ country: null }),
  ];
  assert.deepEqual(
    facetValues(rows, (r) => r.country),
    ["Benin", "Togo"]
  );
});
