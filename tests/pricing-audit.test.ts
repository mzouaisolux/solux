import { test } from "node:test";
import assert from "node:assert/strict";
import {
  diffApprovedPricing,
  summarizePricingChanges,
  coalescePricingNotification,
  PRICING_NOTIF_COALESCE_MINUTES,
} from "../lib/pricing-audit.ts";

const approvedLine = (over: Record<string, unknown> = {}) => ({
  unit_price: 520,
  discount_value: 0,
  pricing_source: "approved_service_request",
  source_project_request_id: "sr-1",
  source_component: "product",
  client_product_name: "Product A",
  approved_by: "dir-1",
  ...over,
});

test("no approved lines → no audit (catalogue docs are out of scope)", () => {
  const rows = diffApprovedPricing({
    oldLines: [{ unit_price: 100, pricing_source: "catalogue" }],
    newLines: [{ unit_price: 50, pricing_source: "catalogue" }],
    oldFreight: 780,
    newFreight: 920,
  });
  assert.equal(rows.length, 0);
});

test("unchanged approved pricing → no audit rows", () => {
  const rows = diffApprovedPricing({
    oldLines: [approvedLine()],
    newLines: [approvedLine()],
    oldFreight: 780,
    newFreight: 780,
  });
  assert.equal(rows.length, 0);
});

test("product price change on an approved line is audited", () => {
  const rows = diffApprovedPricing({
    oldLines: [approvedLine()],
    newLines: [approvedLine({ unit_price: 495 })],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].field, "product_unit_price");
  assert.equal(rows[0].old_value, 520);
  assert.equal(rows[0].new_value, 495);
  assert.equal(rows[0].approved_by, "dir-1");
});

test("pole price + discount + freight changes are each audited", () => {
  const rows = diffApprovedPricing({
    oldLines: [
      approvedLine(),
      approvedLine({ source_component: "pole", client_product_name: "Pole 8m", unit_price: 117.8 }),
    ],
    newLines: [
      approvedLine({ discount_value: 5 }),
      approvedLine({ source_component: "pole", client_product_name: "Pole 8m", unit_price: 99 }),
    ],
    oldFreight: 780,
    newFreight: 920,
  });
  const fields = rows.map((r) => r.field).sort();
  assert.deepEqual(fields, ["discount", "freight_cost", "pole_unit_price"]);
  const pole = rows.find((r) => r.field === "pole_unit_price")!;
  assert.equal(pole.old_value, 117.8);
  assert.equal(pole.new_value, 99);
});

test("removing an approved line is audited as line_removed", () => {
  const rows = diffApprovedPricing({ oldLines: [approvedLine()], newLines: [] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].field, "line_removed");
  assert.equal(rows[0].old_value, 520);
});

test("attaching a catalogue model (name reset to null) still matches the SR line", () => {
  // pickModel() clears client_product_name — the pairing must survive on
  // (source_project_request_id, source_component) alone.
  const rows = diffApprovedPricing({
    oldLines: [approvedLine()],
    newLines: [approvedLine({ client_product_name: null, unit_price: 495 })],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].field, "product_unit_price");
  assert.equal(rows[0].old_value, 520);
  assert.equal(rows[0].new_value, 495);
});

test("summary reads old → new", () => {
  const rows = diffApprovedPricing({
    oldLines: [approvedLine()],
    newLines: [approvedLine({ unit_price: 495 })],
    oldFreight: 780,
    newFreight: 920,
  });
  const s = summarizePricingChanges(rows);
  assert.match(s, /Product A: 520 → 495/);
  assert.match(s, /Shipping: 780 → 920/);
});

// --- Notification coalescing (anti-spam digest) -----------------------------

const NOW = "2026-07-15T12:00:00.000Z";

test("coalesce: no recent event → emit (first change on the document)", () => {
  assert.equal(coalescePricingNotification(null, NOW, 60), "emit");
  assert.equal(coalescePricingNotification(undefined, NOW, 60), "emit");
});

test("coalesce: recent event within the window → append (fold into digest)", () => {
  // 30 min ago, window 60 → still the same running digest.
  assert.equal(
    coalescePricingNotification("2026-07-15T11:30:00.000Z", NOW, 60),
    "append"
  );
});

test("coalesce: recent event older than the window → emit (new occasion)", () => {
  // 120 min ago, window 60 → a fresh notification.
  assert.equal(
    coalescePricingNotification("2026-07-15T10:00:00.000Z", NOW, 60),
    "emit"
  );
});

test("coalesce: unparseable timestamp → emit (never silently drop a change)", () => {
  assert.equal(coalescePricingNotification("not-a-date", NOW, 60), "emit");
});

test("coalesce: successive same-day changes fold under the 7-day default window", () => {
  // Two changes 3 hours apart both belong to one running digest.
  assert.equal(
    coalescePricingNotification(
      "2026-07-15T09:00:00.000Z",
      NOW,
      PRICING_NOTIF_COALESCE_MINUTES
    ),
    "append"
  );
  // A change 8 days later starts fresh.
  assert.equal(
    coalescePricingNotification(
      "2026-07-07T09:00:00.000Z",
      NOW,
      PRICING_NOTIF_COALESCE_MINUTES
    ),
    "emit"
  );
});
