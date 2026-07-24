/**
 * Integrations Phase 2 — crypto + retry helpers (webhook-crypto).
 * Locks the security-sensitive bits: key hashing, HMAC signing (tamper-evident),
 * and the delivery backoff/retry state machine used by the dispatcher.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  sha256Hex,
  generateApiKey,
  generateWebhookSecret,
  signPayload,
  backoffDelayMs,
  isRetryable,
  nextDeliveryStatus,
  MAX_DELIVERY_ATTEMPTS,
} from "../features/Intergration/lib/webhook-crypto.ts";

test("sha256Hex matches node crypto and is stable", () => {
  const expected = createHash("sha256").update("hello", "utf8").digest("hex");
  assert.equal(sha256Hex("hello"), expected);
  assert.equal(sha256Hex("hello"), sha256Hex("hello"));
});

test("generateApiKey: plaintext prefixed, hash = sha256(plaintext), prefix reveals last 4", () => {
  const k = generateApiKey();
  assert.match(k.plaintext, /^sk_live_[0-9a-f]{48}$/);
  assert.equal(k.hash, sha256Hex(k.plaintext));
  assert.equal(k.prefix, `sk_live_…${k.plaintext.slice(-4)}`);
  // two keys differ
  assert.notEqual(generateApiKey().plaintext, generateApiKey().plaintext);
});

test("generateWebhookSecret is prefixed and unique", () => {
  assert.match(generateWebhookSecret(), /^whsec_[0-9a-f]{64}$/);
  assert.notEqual(generateWebhookSecret(), generateWebhookSecret());
});

test("signPayload is deterministic and tamper-evident", () => {
  const secret = "whsec_test";
  const body = JSON.stringify({ event: "order.confirmed", id: "O-1" });
  const sig = signPayload(secret, body);
  assert.equal(sig, signPayload(secret, body)); // stable
  assert.notEqual(sig, signPayload(secret, body + " ")); // body tampered
  assert.notEqual(sig, signPayload("whsec_other", body)); // wrong secret
});

test("backoff grows exponentially; retry caps at MAX_DELIVERY_ATTEMPTS", () => {
  assert.equal(backoffDelayMs(0), 30_000);
  assert.equal(backoffDelayMs(1), 60_000);
  assert.equal(backoffDelayMs(2), 120_000);
  assert.ok(backoffDelayMs(3) > backoffDelayMs(2));
  assert.ok(isRetryable(MAX_DELIVERY_ATTEMPTS - 1));
  assert.equal(isRetryable(MAX_DELIVERY_ATTEMPTS), false);
});

test("nextDeliveryStatus: ok→delivered, fail→pending until cap then failed", () => {
  assert.equal(nextDeliveryStatus(true, 0), "delivered");
  assert.equal(nextDeliveryStatus(false, 1), "pending");
  assert.equal(nextDeliveryStatus(false, MAX_DELIVERY_ATTEMPTS), "failed");
});
