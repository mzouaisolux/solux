/**
 * Phase 3 — secret encryption round-trip + provider request builders.
 * Pure/server-lib imports (node:crypto only, no @/ alias, no DB).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

// A deterministic 32-byte key for the crypto tests (hex = 64 chars).
process.env.INTEGRATION_ENC_KEY = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

const { encryptSecret, decryptSecret, hasEncryptionKey } = await import(
  "../features/Intergration/lib/connection-crypto.ts"
);
const { buildSendRequest, buildWhatsAppTemplateRequest, isBusinessChannel, BUSINESS_CHANNELS } = await import(
  "../features/Intergration/lib/providers.ts"
);

/* ---- encryption ---- */

test("hasEncryptionKey true with a valid 32-byte key", () => {
  assert.equal(hasEncryptionKey(), true);
});

test("encrypt → decrypt round-trips the plaintext", () => {
  const secret = "EAAG...long-whatsapp-token...xyz";
  const enc = encryptSecret(secret);
  assert.ok(enc.ciphertext && enc.iv && enc.tag, "produces ciphertext/iv/tag");
  assert.notEqual(enc.ciphertext, secret, "ciphertext is not the plaintext");
  assert.equal(decryptSecret(enc), secret);
});

test("each encryption uses a fresh iv (ciphertext differs)", () => {
  const a = encryptSecret("same-token");
  const b = encryptSecret("same-token");
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ciphertext, b.ciphertext);
  assert.equal(decryptSecret(a), decryptSecret(b));
});

test("a tampered tag fails decryption (GCM auth)", () => {
  const enc = encryptSecret("token");
  const bad = { ...enc, tag: Buffer.from("deadbeefdeadbeefdeadbeef", "hex").toString("base64") };
  assert.throws(() => decryptSecret(bad));
});

/* ---- provider request builders ---- */

test("isBusinessChannel guards the three channels", () => {
  assert.deepEqual([...BUSINESS_CHANNELS].sort(), ["telegram", "whatsapp_business", "zalo_oa"]);
  assert.equal(isBusinessChannel("whatsapp_business"), true);
  assert.equal(isBusinessChannel("sms"), false);
});

test("whatsapp request hits the Graph API with a bearer token", () => {
  const r = buildSendRequest(
    "whatsapp_business",
    { phone_number_id: "123456" },
    "TOKEN",
    { to: "+84 922 550 812", text: "hello" }
  );
  assert.match(r.url, /graph\.facebook\.com\/v\d+\.\d+\/123456\/messages$/);
  assert.equal(r.headers.authorization, "Bearer TOKEN");
  const body = JSON.parse(r.body);
  assert.equal(body.messaging_product, "whatsapp");
  assert.equal(body.to, "84922550812", "digits only");
  assert.equal(body.text.body, "hello");
});

test("zalo request targets the OA CS endpoint with access_token header", () => {
  const r = buildSendRequest("zalo_oa", {}, "OA_TOKEN", { to: "user-1", text: "hi" });
  assert.match(r.url, /openapi\.zalo\.me/);
  assert.equal(r.headers.access_token, "OA_TOKEN");
  assert.equal(JSON.parse(r.body).recipient.user_id, "user-1");
});

test("telegram request puts the bot token in the URL", () => {
  const r = buildSendRequest("telegram", {}, "BOT123", { to: "555", text: "yo" });
  assert.match(r.url, /api\.telegram\.org\/botBOT123\/sendMessage$/);
  assert.equal(JSON.parse(r.body).chat_id, "555");
});

test("whatsapp template request builds a type=template payload", () => {
  const r = buildWhatsAppTemplateRequest(
    { phone_number_id: "123456" },
    "TOKEN",
    { to: "+84 922 550 812", templateName: "quote_followup", languageCode: "vi", params: ["Mai", "SSLXPRO 60"] }
  );
  assert.match(r.url, /graph\.facebook\.com\/v\d+\.\d+\/123456\/messages$/);
  assert.equal(r.headers.authorization, "Bearer TOKEN");
  const body = JSON.parse(r.body);
  assert.equal(body.type, "template");
  assert.equal(body.template.name, "quote_followup");
  assert.equal(body.template.language.code, "vi");
  assert.equal(body.to, "84922550812");
  assert.deepEqual(
    body.template.components[0].parameters.map((p: any) => p.text),
    ["Mai", "SSLXPRO 60"]
  );
});

test("whatsapp template defaults language to en and omits components when no params", () => {
  const r = buildWhatsAppTemplateRequest({ phone_number_id: "1" }, "T", { to: "1", templateName: "hello" });
  const body = JSON.parse(r.body);
  assert.equal(body.template.language.code, "en");
  assert.equal(body.template.components, undefined);
});

test("whatsapp template throws on missing name or phone_number_id", () => {
  assert.throws(() => buildWhatsAppTemplateRequest({ phone_number_id: "1" }, "T", { to: "1", templateName: "" }), /Template name/);
  assert.throws(() => buildWhatsAppTemplateRequest({}, "T", { to: "1", templateName: "x" }), /phone_number_id/);
});

test("missing whatsapp phone_number_id / empty inputs throw", () => {
  assert.throws(() => buildSendRequest("whatsapp_business", {}, "T", { to: "1", text: "x" }));
  assert.throws(() => buildSendRequest("telegram", {}, "", { to: "1", text: "x" }), /token/i);
  assert.throws(() => buildSendRequest("telegram", {}, "T", { to: "", text: "x" }), /Recipient/);
  assert.throws(() => buildSendRequest("telegram", {}, "T", { to: "1", text: "" }), /text/i);
});
