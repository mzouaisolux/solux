/**
 * Step 4b — pure decision logic behind the webhook fan-out, the retry
 * scheduler and the inbound phone→client match. Pure imports only (no DB /
 * no @/ alias) so they run under the node test runner with type-stripping.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  webhookEventForEmit,
  phonesMatch,
  applyTemplate,
  WEBHOOK_EVENTS,
} from "../features/Intergration/lib/integrations.ts";
import {
  isDeliveryDue,
  backoffDelayMs,
  nextDeliveryStatus,
  deliveryIdempotencyKey,
  MAX_DELIVERY_ATTEMPTS,
} from "../features/Intergration/lib/webhook-crypto.ts";

/* ---- event → logical webhook mapping ---- */

test("webhookEventForEmit maps the quotation lifecycle, order/shipment + spec events", () => {
  assert.equal(webhookEventForEmit("doc.created"), "quotation.created");
  assert.equal(webhookEventForEmit("doc.status_changed", { to: "sent" }), "quotation.sent");
  assert.equal(webhookEventForEmit("doc.won"), "quotation.won");
  assert.equal(webhookEventForEmit("doc.lost"), "quotation.lost");
  assert.equal(webhookEventForEmit("doc.cancelled"), "quotation.cancelled");
  assert.equal(webhookEventForEmit("po.created"), "order.confirmed");
  assert.equal(webhookEventForEmit("po.shipment_updated"), "shipment.updated");
  assert.equal(webhookEventForEmit("spec.published"), "spec.published");
  assert.equal(webhookEventForEmit("spec_sheet.sent"), "spec_sheet.sent");
});

test("doc.status_changed only maps when status became 'sent'", () => {
  assert.equal(webhookEventForEmit("doc.status_changed", { to: "negotiating" }), null);
  assert.equal(webhookEventForEmit("doc.status_changed", {}), null);
  assert.equal(webhookEventForEmit("doc.status_changed"), null);
});

test("unmapped events return null (no accidental fan-out)", () => {
  for (const e of ["doc.updated", "client.updated", "po.deposit_received", "tl.validated"]) {
    assert.equal(webhookEventForEmit(e), null, `${e} must not fan out`);
  }
});

test("every mapping target is a declared WEBHOOK_EVENT", () => {
  for (const [type, payload] of [
    ["doc.created", undefined],
    ["doc.status_changed", { to: "sent" }],
    ["doc.won", undefined],
    ["doc.lost", undefined],
    ["doc.cancelled", undefined],
    ["po.created", undefined],
    ["po.shipment_updated", undefined],
    ["spec.published", undefined],
    ["spec_sheet.sent", undefined],
  ] as const) {
    const mapped = webhookEventForEmit(type, payload as any);
    assert.ok(mapped && (WEBHOOK_EVENTS as readonly string[]).includes(mapped));
  }
});

/* ---- retry scheduling ---- */

test("a never-tried delivery is always due", () => {
  assert.equal(isDeliveryDue(Date.now(), null, 0), true);
});

test("a delivery is due only after its backoff window elapses", () => {
  const now = 1_000_000_000_000;
  const last = now - backoffDelayMs(1); // exactly one window ago
  assert.equal(isDeliveryDue(now, last, 1), true);
  assert.equal(isDeliveryDue(now, last + 1, 1), false, "1ms short of the window is not due");
});

test("backoff grows exponentially from 30s", () => {
  assert.equal(backoffDelayMs(0), 30_000);
  assert.equal(backoffDelayMs(1), 60_000);
  assert.equal(backoffDelayMs(2), 120_000);
});

test("status requeues until attempts exhausted, then fails", () => {
  assert.equal(nextDeliveryStatus(true, 1), "delivered");
  assert.equal(nextDeliveryStatus(false, 1), "pending");
  assert.equal(nextDeliveryStatus(false, MAX_DELIVERY_ATTEMPTS), "failed");
});

/* ---- delivery idempotency key (dedupe on event_id) ---- */

test("idempotency key is the event_id when present (stable across retries)", () => {
  assert.equal(deliveryIdempotencyKey("evt-123", "row-abc"), "evt-123");
  // Same event re-emitted → different delivery row, SAME key → receiver dedupes.
  assert.equal(deliveryIdempotencyKey("evt-123", "row-xyz"), "evt-123");
});

test("idempotency key falls back to the delivery id when event_id is missing", () => {
  assert.equal(deliveryIdempotencyKey(null, "row-abc"), "row-abc");
  assert.equal(deliveryIdempotencyKey(undefined, "row-abc"), "row-abc");
  assert.equal(deliveryIdempotencyKey("   ", "row-abc"), "row-abc", "blank event_id is not a usable key");
});

/* ---- inbound phone → client match ---- */

test("phonesMatch tolerates country code + separators", () => {
  assert.equal(phonesMatch("+84 922 550 812", "0922550812"), true);
  assert.equal(phonesMatch("922550812", "+84922550812"), true);
});

test("phonesMatch rejects different numbers and too-short inputs", () => {
  assert.equal(phonesMatch("+84922550812", "+84900000000"), false);
  assert.equal(phonesMatch("1234", "1234"), false, "too few digits to be confident");
  assert.equal(phonesMatch(null, "0922550812"), false);
});

/* ---- template token substitution ---- */

test("applyTemplate fills known tokens, tolerating case + whitespace", () => {
  const body = "Hi {{contact}}, here is the {{ Product }} sheet ({{version}}) from {{company}}.";
  const out = applyTemplate(body, { contact: "Mai", product: "SSLXPRO 60", version: "v1.1", company: "Solux" });
  assert.equal(out, "Hi Mai, here is the SSLXPRO 60 sheet (v1.1) from Solux.");
});

test("applyTemplate leaves unknown/empty tokens intact for manual editing", () => {
  assert.equal(applyTemplate("Dear {{contact}}", {}), "Dear {{contact}}");
  assert.equal(applyTemplate("Dear {{contact}}", { contact: "" }), "Dear {{contact}}");
  assert.equal(applyTemplate("no tokens here", { a: "b" }), "no tokens here");
});
