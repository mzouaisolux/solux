import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPackageDeliveryPayload } from "../lib/quotation-package-delivery.ts";

const base = {
  revision: 1,
  quoteUrl: null as string | null,
  quoteFilename: "x_Quotation.pdf",
  specsUrl: null as string | null,
  specsFilename: null as string | null,
  specsCount: 0,
  included: 0,
  missing: 0,
  quoteNumber: null as string | null,
  clientId: null as string | null,
};

test("buildPackageDeliveryPayload carries n8n delivery fields", () => {
  const payload = buildPackageDeliveryPayload({
    ...base,
    quoteUrl: "https://signed.example/quote.pdf",
    quoteFilename: "SLX-NOR-26-005_Quotation.pdf",
    included: 3,
    quoteNumber: "SLX-NOR-26-005",
    clientId: "client-uuid",
    client: { company_name: "ACME Lighting", email: "buyer@acme.example" },
  });
  assert.equal(payload.channel, "package");
  assert.equal(payload.quote_number, "SLX-NOR-26-005");
  assert.equal(payload.client_name, "ACME Lighting");
  assert.equal(payload.recipient_email, "buyer@acme.example");
  assert.equal(payload.recipient_source, "client");
  assert.equal(payload.client_id, "client-uuid");
});

test("Change 2 — quote + specs are two distinct attachments", () => {
  const both = buildPackageDeliveryPayload({
    ...base,
    quoteUrl: "https://signed.example/quote.pdf",
    quoteFilename: "SLX-NOR-26-021_Quotation.pdf",
    specsUrl: "https://signed.example/specs.pdf",
    specsFilename: "SLX-NOR-26-021_Datasheets.pdf",
    specsCount: 2,
    included: 3,
  });
  assert.equal(both.quote_url, "https://signed.example/quote.pdf");
  assert.equal(both.specs_url, "https://signed.example/specs.pdf");
  assert.equal(both.specs_filename, "SLX-NOR-26-021_Datasheets.pdf");
  assert.equal(both.specs_count, 2);

  // No datasheet selected/available → quote only, specs null.
  const quoteOnly = buildPackageDeliveryPayload({
    ...base,
    quoteUrl: "https://signed.example/quote.pdf",
    quoteFilename: "q.pdf",
  });
  assert.equal(quoteOnly.specs_url, null);
  assert.equal(quoteOnly.specs_filename, null);
  assert.equal(quoteOnly.specs_count, 0);
});

test("primary contact email wins over the client record email (option B)", () => {
  const payload = buildPackageDeliveryPayload({
    ...base,
    quoteNumber: "Q1",
    clientId: "c1",
    included: 1,
    client: { company_name: "Norsum", email: "rep@solux-light.com" },
    primaryContact: { name: "H A Nga", email: "buyer@norsum.example" },
  });
  assert.equal(payload.recipient_email, "buyer@norsum.example");
  assert.equal(payload.recipient_source, "contact");
  assert.equal(payload.recipient_name, "H A Nga");
});

test("sales owner is carried for the delivery reply-to (and null when absent)", () => {
  const withOwner = buildPackageDeliveryPayload({
    ...base,
    quoteNumber: "Q1",
    clientId: "c1",
    client: { company_name: "A", email: "a@a.example" },
    salesOwner: { name: "  Klairs  ", email: "  klairs@solux-light.com  " },
  });
  assert.equal(withOwner.sales_name, "Klairs", "trimmed");
  assert.equal(withOwner.sales_email, "klairs@solux-light.com", "trimmed");

  const noOwner = buildPackageDeliveryPayload({ ...base, client: null });
  assert.equal(noOwner.sales_name, null);
  assert.equal(noOwner.sales_email, null);
});

test("falls back to client email, then none, and flags the source", () => {
  const clientOnly = buildPackageDeliveryPayload({
    ...base,
    clientId: "c1",
    client: { company_name: "A", email: "a@a.example" },
    primaryContact: { name: "x", email: null },
  });
  assert.equal(clientOnly.recipient_email, "a@a.example");
  assert.equal(clientOnly.recipient_source, "client");

  const none = buildPackageDeliveryPayload({ ...base, client: null });
  assert.equal(none.recipient_email, null);
  assert.equal(none.recipient_source, "none");
  assert.equal(none.client_name, null);
});
