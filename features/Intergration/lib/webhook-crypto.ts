/**
 * Integrations Phase 2 — crypto + retry helpers (server-only: imports node:crypto).
 * Used by the api-key / webhook actions, the dispatcher and the inbound API.
 * Pure functions → unit-testable without the app.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** SHA-256 hex of a string (how API keys are stored + compared). */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * A fresh API key: plaintext (shown once), its stored hash, and a display
 * prefix that reveals only the last 4 chars. Plaintext = `sk_live_<48 hex>`.
 */
export function generateApiKey(): { plaintext: string; hash: string; prefix: string } {
  const secret = randomBytes(24).toString("hex"); // 48 hex chars
  const plaintext = `sk_live_${secret}`;
  return { plaintext, hash: sha256Hex(plaintext), prefix: `sk_live_…${secret.slice(-4)}` };
}

/** A fresh HMAC signing secret for a webhook endpoint (`whsec_<64 hex>`). */
export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString("hex")}`;
}

/** HMAC-SHA256 hex signature of a raw body with an endpoint secret. */
export function signPayload(secret: string, rawBody: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

/**
 * Verify a Meta webhook signature (WhatsApp Cloud / Messenger). Meta sends
 * `X-Hub-Signature-256: sha256=<hmac>` where the HMAC is over the RAW request
 * body keyed by the app secret. Timing-safe compare; false on any missing/
 * malformed input rather than throwing, so the route can answer 401 cleanly.
 *
 * IMPORTANT: pass the raw request text exactly as received — re-serializing the
 * parsed JSON changes bytes and breaks the signature.
 */
export function verifyMetaSignature(
  appSecret: string | undefined | null,
  rawBody: string,
  signatureHeader: string | null | undefined
): boolean {
  if (!appSecret || !signatureHeader) return false;
  const m = /^sha256=([0-9a-f]+)$/i.exec(signatureHeader.trim());
  if (!m) return false;
  const expected = signPayload(appSecret, rawBody);
  const a = Buffer.from(m[1], "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

export const MAX_DELIVERY_ATTEMPTS = 5;

/**
 * Exponential backoff (ms) before the next attempt: 30s, 60s, 2m, 4m, 8m …
 * `attempts` = number of attempts already made.
 */
export function backoffDelayMs(attempts: number): number {
  return 30_000 * 2 ** Math.max(0, attempts);
}

/** Whether a delivery with N attempts is still retryable. */
export function isRetryable(attempts: number): boolean {
  return attempts < MAX_DELIVERY_ATTEMPTS;
}

/** Resolve the terminal/next status after an attempt. */
export function nextDeliveryStatus(ok: boolean, attempts: number): "delivered" | "pending" | "failed" {
  if (ok) return "delivered";
  return isRetryable(attempts) ? "pending" : "failed";
}

/**
 * Is a still-pending delivery due for its next attempt? A never-tried row
 * (lastAttemptMs null) is always due; otherwise the exponential backoff for the
 * attempts already made must have elapsed. Pure so the dispatcher and tests
 * agree on scheduling.
 */
export function isDeliveryDue(
  nowMs: number,
  lastAttemptMs: number | null,
  attempts: number
): boolean {
  if (lastAttemptMs === null) return true;
  return nowMs - lastAttemptMs >= backoffDelayMs(attempts);
}

/**
 * The idempotency key a receiver (n8n) should dedupe on. Prefer the logical
 * `event_id` (stable across BOTH a re-emit and a dispatcher retry of the same
 * event); fall back to the per-delivery row id so the key is never empty even
 * for legacy rows whose event_id is null. Pure so the dispatcher and tests
 * agree on what goes on the wire.
 */
export function deliveryIdempotencyKey(
  eventId: string | null | undefined,
  deliveryId: string
): string {
  const id = (eventId ?? "").trim();
  return id.length > 0 ? id : deliveryId;
}
