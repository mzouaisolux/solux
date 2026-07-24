/**
 * Knowledge Hub — "Send to customer" deep-link builders (pure).
 *
 * The model page offers two ways to get the datasheet to a customer:
 *   • open  — hand off to the rep's OWN client (mailto: / wa.me) with the
 *             message + a link to the branded PDF prefilled. No server delivery.
 *   • send  — automated delivery via the integration adapter (n8n).
 *
 * These builders back the "open" path. Kept pure (no DOM / no fetch) so the
 * link shapes are unit-tested and the client component just opens them.
 */

export const DATASHEET_CHANNELS = ["email", "whatsapp"] as const;
export type DatasheetChannel = (typeof DATASHEET_CHANNELS)[number];
export type DatasheetMode = "open" | "send";

export const isDatasheetChannel = (v: string): v is DatasheetChannel =>
  (DATASHEET_CHANNELS as readonly string[]).includes(v);

/**
 * Classify what the rep typed into the smart "To" field: a full email, a phone
 * number, or a name to search the client list with. Used to decide whether the
 * input is a direct recipient or a search query.
 */
export function detectRecipientKind(query: string): "email" | "phone" | "search" {
  const q = (query ?? "").trim();
  if (/^\S+@\S+\.\S+$/.test(q)) return "email";
  if (/^[+\d][\d\s().-]{5,}$/.test(q)) return "phone";
  return "search";
}

/** The recipient value for a channel: email address for email, phone for WhatsApp. */
export function recipientForChannel(
  channel: DatasheetChannel,
  c: { email?: string | null; phone?: string | null }
): string {
  const v = channel === "email" ? c.email : c.phone;
  return (v ?? "").trim();
}

/** Message + optional signed link → the body a rep sends the customer. */
export function composeBody(message: string, datasheetUrl: string | null): string {
  const note = (message ?? "").trim();
  const link = (datasheetUrl ?? "").trim();
  if (!link) return note;
  if (!note) return `Datasheet: ${link}`;
  return `${note}\n\nDatasheet: ${link}`;
}

/** mailto: URL for the "Open in Email" handoff. `recipient` is an email. */
export function buildMailto(input: {
  recipient: string;
  subject: string;
  message: string;
  datasheetUrl: string | null;
}): string {
  const to = encodeURIComponent((input.recipient ?? "").trim());
  const params = new URLSearchParams({
    subject: (input.subject ?? "").trim(),
    body: composeBody(input.message, input.datasheetUrl),
  });
  return `mailto:${to}?${params.toString()}`;
}

/**
 * wa.me URL for the "Open in WhatsApp" handoff. `recipient` is a phone; WhatsApp
 * click-to-chat needs digits only (country code, no +, spaces, or dashes).
 * WhatsApp can't attach a file via a link, so the PDF goes in as a link.
 */
export function buildWhatsAppLink(input: {
  recipient: string;
  message: string;
  datasheetUrl: string | null;
}): string {
  const digits = (input.recipient ?? "").replace(/[^\d]/g, "");
  const text = encodeURIComponent(composeBody(input.message, input.datasheetUrl));
  return `https://wa.me/${digits}?text=${text}`;
}
