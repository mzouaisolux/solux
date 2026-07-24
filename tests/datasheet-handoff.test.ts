/**
 * Knowledge Hub — "Send to customer" deep-link builders. Pure imports only (no
 * DB / no @/ alias) so they run under the node test runner with type-stripping.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  composeBody,
  buildMailto,
  buildWhatsAppLink,
  isDatasheetChannel,
  recipientForChannel,
  detectRecipientKind,
} from "../features/product-knowledge-hub/lib/datasheetHandoff.ts";

test("detectRecipientKind tells emails, phones and search queries apart", () => {
  assert.equal(detectRecipientKind("mai@acme.com"), "email");
  assert.equal(detectRecipientKind("+84 90 123 4567"), "phone");
  assert.equal(detectRecipientKind("0922550812"), "phone");
  assert.equal(detectRecipientKind("Acme Lighting"), "search");
  assert.equal(detectRecipientKind("3M"), "search");
  assert.equal(detectRecipientKind("  "), "search");
});

test("recipientForChannel returns email for email, phone for whatsapp", () => {
  const c = { email: "buyer@acme.com", phone: "+84 90 123 4567" };
  assert.equal(recipientForChannel("email", c), "buyer@acme.com");
  assert.equal(recipientForChannel("whatsapp", c), "+84 90 123 4567");
  assert.equal(recipientForChannel("email", { email: null, phone: "+8490" }), "");
  assert.equal(recipientForChannel("whatsapp", { phone: "  " }), "");
});

test("isDatasheetChannel accepts only email + whatsapp", () => {
  assert.equal(isDatasheetChannel("email"), true);
  assert.equal(isDatasheetChannel("whatsapp"), true);
  assert.equal(isDatasheetChannel("crm"), false);
  assert.equal(isDatasheetChannel(""), false);
});

test("composeBody appends the link, tolerating a missing message or link", () => {
  assert.equal(composeBody("Hi there", "https://x/y.pdf"), "Hi there\n\nDatasheet: https://x/y.pdf");
  assert.equal(composeBody("Hi there", null), "Hi there");
  assert.equal(composeBody("", "https://x/y.pdf"), "Datasheet: https://x/y.pdf");
  assert.equal(composeBody("  ", null), "");
});

test("buildMailto encodes recipient, subject and body", () => {
  const url = buildMailto({
    recipient: "customer@acme.com",
    subject: "TOTEM 40 datasheet (v2)",
    message: "Hello",
    datasheetUrl: "https://x/y.pdf",
  });
  assert.ok(url.startsWith("mailto:customer%40acme.com?"));
  assert.match(url, /subject=TOTEM\+40\+datasheet\+%28v2%29/);
  assert.match(url, /body=Hello/);
  assert.match(url, /Datasheet%3A\+https/);
});

test("buildWhatsAppLink strips the phone to digits and encodes the text", () => {
  const url = buildWhatsAppLink({
    recipient: "+84 90 123 4567",
    message: "Hi",
    datasheetUrl: "https://x/y.pdf",
  });
  assert.ok(url.startsWith("https://wa.me/84901234567?text="));
  assert.match(url, /text=Hi/);
  assert.match(url, /Datasheet%3A%20https/);
});
