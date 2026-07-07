/**
 * Shipping Rate Refresh (m149) — pure-helper tests for lib/shipping-update.
 * Locks the delta math (the whole value of the feature is "old vs new"),
 * the snapshot coercion (JSONB from DB is untyped) and the container
 * summary used to prefill the request modal.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSnapshot,
  containerSummary,
  shippingDelta,
  formatDelta,
  quoteAgeDays,
  freshnessLevel,
  FRESHNESS_DEFAULTS,
} from "../lib/shipping-update.ts";

test("normalizeSnapshot keeps trimmed strings, coerces numbers, drops junk", () => {
  const snap = normalizeSnapshot({
    destination_port: "  Mombasa ",
    containers_count: 3,
    incoterm: "",
    estimated_volume: null,
    unknown_key: "ignored",
    customer: "AFRICA ENERGY SARL",
  });
  assert.deepEqual(snap, {
    destination_port: "Mombasa",
    containers_count: "3",
    customer: "AFRICA ENERGY SARL",
  });
});

test("normalizeSnapshot tolerates null / non-object input", () => {
  assert.deepEqual(normalizeSnapshot(null), {});
  assert.deepEqual(normalizeSnapshot("garbage"), {});
  assert.deepEqual(normalizeSnapshot(42), {});
});

test("containerSummary aggregates by type and counts total", () => {
  const s = containerSummary([
    { container_type: "40ft HC", quantity: 2, unit_price: 3400 } as any,
    { container_type: "40ft HC", quantity: 1, unit_price: 3400 } as any,
    { container_type: "LCL", quantity: 1, unit_price: 900 } as any,
    { container_type: "", quantity: 5, unit_price: 0 } as any, // dropped
    { container_type: "20ft", quantity: 0, unit_price: 100 } as any, // dropped
  ]);
  assert.equal(s.container_type, "3× 40ft HC + 1× LCL");
  assert.equal(s.containers_count, "4");
});

test("containerSummary of nothing is empty strings", () => {
  assert.deepEqual(containerSummary([]), { container_type: "", containers_count: "" });
});

test("shippingDelta computes freight / insurance / combined movement", () => {
  const d = shippingDelta({
    previous_freight_cost: 3420,
    new_freight_cost: 3760,
    previous_insurance_cost: 120,
    new_insurance_cost: 110,
  });
  assert.equal(d.freight, 340);
  assert.equal(d.insurance, -10);
  assert.equal(d.total, 330);
});

test("shippingDelta is null-safe per component", () => {
  const d = shippingDelta({ previous_freight_cost: 3420, new_freight_cost: 3510 });
  assert.equal(d.freight, 90);
  assert.equal(d.insurance, null);
  assert.equal(d.total, 90); // missing insurance never poisons the total
  const none = shippingDelta({});
  assert.deepEqual(none, { freight: null, insurance: null, total: null });
});

test("formatDelta signs the movement (− for savings, + for increases)", () => {
  assert.equal(formatDelta(340), "+340.00");
  assert.equal(formatDelta(-10.5), "−10.50");
  assert.equal(formatDelta(0), "0.00");
  assert.equal(formatDelta(null), "—");
});

test("quoteAgeDays counts whole days and never goes negative", () => {
  const now = new Date("2026-07-07T12:00:00Z");
  assert.equal(quoteAgeDays("2026-04-04", now), 94);
  assert.equal(quoteAgeDays("2026-07-07", now), 0);
  assert.equal(quoteAgeDays("2026-08-01", now), 0); // future date clamps to 0
  assert.equal(quoteAgeDays(null, now), null);
  assert.equal(quoteAgeDays("not-a-date", now), null);
});

test("freshnessLevel maps age to the traffic light (default 30/90)", () => {
  assert.equal(freshnessLevel(8).level, "fresh"); // 🟢 example
  assert.equal(freshnessLevel(8).emoji, "🟢");
  assert.equal(freshnessLevel(29).level, "fresh");
  assert.equal(freshnessLevel(30).level, "warn"); // boundary → amber
  assert.equal(freshnessLevel(45).level, "warn"); // 🟡 example
  assert.equal(freshnessLevel(89).level, "warn");
  assert.equal(freshnessLevel(90).level, "stale"); // boundary → red
  assert.equal(freshnessLevel(92).level, "stale"); // 🔴 example
  assert.equal(freshnessLevel(92).emoji, "🔴");
  assert.equal(freshnessLevel(92).label, "Freight quote is 92 days old");
});

test("freshnessLevel is unknown (not green) when the date is missing", () => {
  const f = freshnessLevel(null);
  assert.equal(f.level, "unknown");
  assert.equal(f.emoji, "⚪");
});

test("freshnessLevel honours custom thresholds and guards inversion", () => {
  assert.equal(freshnessLevel(20, { warnDays: 15, criticalDays: 45 }).level, "warn");
  assert.equal(freshnessLevel(50, { warnDays: 15, criticalDays: 45 }).level, "stale");
  // critical <= warn is coerced so 'stale' can still trigger above warn.
  assert.equal(freshnessLevel(40, { warnDays: 30, criticalDays: 10 }).level, "stale");
});

test("FRESHNESS_DEFAULTS are the documented 30 / 90", () => {
  assert.equal(FRESHNESS_DEFAULTS.warnDays, 30);
  assert.equal(FRESHNESS_DEFAULTS.criticalDays, 90);
});
