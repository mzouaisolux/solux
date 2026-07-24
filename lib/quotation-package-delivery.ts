/**
 * PRD-006 — webhook payload for n8n package delivery (spec_sheet.sent).
 * Pure helper so the envelope shape is unit-tested and n8n bindings stay stable.
 */

export type PackageDeliveryPayload = {
  channel: "package";
  revision: number;
  /** Change 2 — TWO attachments: the quote on its own, and the combined
   *  datasheets PDF. `specs_url` is null when no datasheet was selected/available
   *  (then only the quote is sent). */
  quote_url: string | null;
  quote_filename: string;
  specs_url: string | null;
  specs_filename: string | null;
  /** How many datasheets are in the specs PDF (deduped). 0 → quote only. */
  specs_count: number;
  included: number;
  missing: number;
  quote_number: string | null;
  client_name: string | null;
  recipient_email: string | null;
  /** Where recipient_email came from — for the n8n guard + ops visibility. */
  recipient_source: "contact" | "client" | "none";
  recipient_name: string | null;
  client_id: string | null;
  /** Sales owner (quote owner, else creator) — for the delivery email reply-to. */
  sales_name: string | null;
  sales_email: string | null;
};

/**
 * Recipient resolution (option B): prefer the client's PRIMARY CONTACT email
 * (the real buyer), fall back to the client record's own email, then null.
 * `clients.email` is often an internal/generic address (verified: some clients
 * hold a Solux rep's email), so the maintained contact wins when present.
 * `recipient_source` lets n8n block/alert on a weak recipient instead of
 * emailing the wrong person.
 */
export function buildPackageDeliveryPayload(input: {
  revision: number;
  quoteUrl: string | null;
  quoteFilename: string;
  specsUrl: string | null;
  specsFilename: string | null;
  specsCount: number;
  included: number;
  missing: number;
  quoteNumber: string | null;
  clientId: string | null;
  client?: { company_name?: string | null; email?: string | null } | null;
  primaryContact?: { name?: string | null; email?: string | null } | null;
  salesOwner?: { name?: string | null; email?: string | null } | null;
}): PackageDeliveryPayload {
  const contactEmail = input.primaryContact?.email?.trim() || null;
  const clientEmail = input.client?.email?.trim() || null;
  const recipient_email = contactEmail ?? clientEmail ?? null;
  const recipient_source: PackageDeliveryPayload["recipient_source"] =
    contactEmail ? "contact" : clientEmail ? "client" : "none";
  return {
    channel: "package",
    revision: input.revision,
    quote_url: input.quoteUrl,
    quote_filename: input.quoteFilename,
    specs_url: input.specsUrl,
    specs_filename: input.specsFilename,
    specs_count: input.specsCount,
    included: input.included,
    missing: input.missing,
    quote_number: input.quoteNumber,
    client_name: input.client?.company_name ?? null,
    recipient_email,
    recipient_source,
    recipient_name: input.primaryContact?.name ?? null,
    client_id: input.clientId,
    sales_name: input.salesOwner?.name?.trim() || null,
    sales_email: input.salesOwner?.email?.trim() || null,
  };
}
