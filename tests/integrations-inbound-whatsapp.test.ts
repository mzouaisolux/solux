/**
 * Integrations area A — WhatsApp inbound receiver pure logic.
 *
 * The route itself does service-role DB work (covered by the matching precedent
 * + the unmatched tests); here we lock the two pure pieces it depends on: the
 * Meta X-Hub-Signature-256 verifier and the WhatsApp webhook parser (which must
 * ignore status callbacks and survive shape drift).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyMetaSignature, signPayload } from "../features/Intergration/lib/webhook-crypto.ts";
import { parseWhatsAppInbound } from "../features/Intergration/lib/integrations.ts";
import {
  NOTIFICATION_CATALOG,
  resolveEventNotification,
} from "../lib/notification-catalog.ts";

const APP_SECRET = "test_app_secret";
const sign = (body: string) => "sha256=" + createHmac("sha256", APP_SECRET).update(body, "utf8").digest("hex");

test("verifyMetaSignature accepts a correctly-signed body", () => {
  const raw = JSON.stringify({ hello: "world" });
  assert.ok(verifyMetaSignature(APP_SECRET, raw, sign(raw)));
});

test("verifyMetaSignature rejects wrong secret, tampered body, and malformed headers", () => {
  const raw = JSON.stringify({ a: 1 });
  const good = sign(raw);
  assert.ok(!verifyMetaSignature("other_secret", raw, good), "wrong secret");
  assert.ok(!verifyMetaSignature(APP_SECRET, raw + " ", good), "tampered body");
  assert.ok(!verifyMetaSignature(APP_SECRET, raw, "sha256=deadbeef"), "wrong digest");
  assert.ok(!verifyMetaSignature(APP_SECRET, raw, signPayload(APP_SECRET, raw)), "missing sha256= prefix");
  assert.ok(!verifyMetaSignature(APP_SECRET, raw, null), "no header");
  assert.ok(!verifyMetaSignature(undefined, raw, good), "no configured secret");
  assert.ok(!verifyMetaSignature(APP_SECRET, raw, "sha256="), "empty digest");
});

function waEnvelope(messages: any[], contacts?: any[]) {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "WABA", changes: [{ field: "messages", value: { messaging_product: "whatsapp", contacts, messages } }] }],
  };
}

test("parseWhatsAppInbound extracts a text message with the profile name", () => {
  const body = waEnvelope(
    [{ from: "84901234567", id: "wamid.1", timestamp: "1700000000", type: "text", text: { body: "Hi there" } }],
    [{ wa_id: "84901234567", profile: { name: "Minh Tran" } }]
  );
  const msgs = parseWhatsAppInbound(body);
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].from, "84901234567");
  assert.equal(msgs[0].name, "Minh Tran");
  assert.equal(msgs[0].text, "Hi there");
  assert.equal(msgs[0].messageId, "wamid.1");
  assert.equal(msgs[0].timestamp, 1700000000);
  assert.equal(msgs[0].type, "text");
});

test("parseWhatsAppInbound IGNORES status callbacks (delivered/read)", () => {
  const body = {
    object: "whatsapp_business_account",
    entry: [{ changes: [{ field: "messages", value: { statuses: [{ id: "wamid.x", status: "delivered" }] } }] }],
  };
  assert.deepEqual(parseWhatsAppInbound(body), []);
});

test("parseWhatsAppInbound placeholders non-text and reads button/interactive replies", () => {
  const body = waEnvelope([
    { from: "111", id: "m1", type: "image", image: { id: "media1" } },
    { from: "222", id: "m2", type: "button", button: { text: "Yes" } },
    { from: "333", id: "m3", type: "interactive", interactive: { button_reply: { title: "Confirm" } } },
  ]);
  const msgs = parseWhatsAppInbound(body);
  assert.equal(msgs[0].text, "[image]");
  assert.equal(msgs[1].text, "Yes");
  assert.equal(msgs[2].text, "Confirm");
});

test("client.message_received rings the bell when enabled (owner notify contract)", () => {
  const entry = NOTIFICATION_CATALOG["client.message_received"];
  assert.equal(entry.severity, "high", "must be high so it defaults to the bell");
  assert.equal(entry.entity, "client", "must be a client event so RLS routes it to the owner");
  // Opt-in OFF → silent; opt-in ON → bell (no per-role override).
  assert.equal(
    resolveEventNotification({ eventKey: "client.message_received", severity: "high", notifyEnabled: false }),
    "off"
  );
  assert.equal(
    resolveEventNotification({ eventKey: "client.message_received", severity: "high", notifyEnabled: true }),
    "bell"
  );
});

test("parseWhatsAppInbound tolerates junk / empty shapes without throwing", () => {
  assert.deepEqual(parseWhatsAppInbound(null), []);
  assert.deepEqual(parseWhatsAppInbound({}), []);
  assert.deepEqual(parseWhatsAppInbound({ entry: "nope" }), []);
  assert.deepEqual(parseWhatsAppInbound(waEnvelope([{ id: "x", type: "text", text: { body: "no from" } }])), []);
});
