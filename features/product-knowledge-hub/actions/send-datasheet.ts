"use server";

/**
 * Knowledge Hub — "Send to customer". Two ways to get the branded datasheet to
 * a customer, both gated by integration.send_business and both audited:
 *
 *   • mode="open" — the rep hands off from their OWN client. The action renders
 *     the PDF + signs a URL and returns it; the client builds a mailto: / wa.me
 *     deep link (message + link prefilled) and opens it. No server delivery.
 *   • mode="send" — automated delivery. Emits spec_sheet.sent, which the webhook
 *     fan-out turns into a delivery → n8n sends the PDF on the chosen channel
 *     (email: Gmail attachment; whatsapp: approved template + document).
 *
 * Either way the emitted spec_sheet.sent event is the audit record; `mode` +
 * `recipient_source` let n8n route (and only mode="send" is delivered).
 */

import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/permissions";
import { emitEvent } from "@/lib/events";
import { renderSpecSheet, getSpecSheetSignedUrl } from "../render/renderSpecSheet";
import { isDatasheetChannel, type DatasheetMode } from "../lib/datasheetHandoff";

export type { DatasheetChannel } from "../lib/datasheetHandoff";

export async function sendModelSpecSheet(input: {
  productId: string;
  sku: string | null;
  version: string | null;
  productName: string;
  channel: string;
  recipient: string;
  message?: string | null;
  mode?: DatasheetMode;
  /** Set when the recipient was chosen from the client list (vs typed). */
  clientId?: string | null;
}): Promise<{ datasheetUrl: string | null }> {
  await requireCapability("integration.send_business");

  const productId = (input.productId ?? "").trim();
  const recipient = (input.recipient ?? "").trim();
  const channel = (input.channel ?? "").trim();
  const mode: DatasheetMode = input.mode === "open" ? "open" : "send";
  if (!productId) throw new Error("Missing product.");
  if (!recipient) throw new Error("Recipient is required.");
  if (!isDatasheetChannel(channel)) throw new Error("Pick a channel.");

  // Ensure the branded datasheet PDF exists and produce a signed URL for it. For
  // "send" n8n fetches the PDF from this URL; for "open" the rep's client links
  // to it. Server-to-server / short-lived is fine either way — 24h covers
  // webhook delivery + retries and gives the rep's email time to go out.
  // Best-effort: rendering/signing must never block the rep's action.
  let datasheetUrl: string | null = null;
  const datasheetFilename = `${input.sku ?? input.productName}-${input.version ?? "current"}.pdf`;
  if (input.version) {
    try {
      const { path } = await renderSpecSheet(productId, input.version);
      datasheetUrl = await getSpecSheetSignedUrl(path, 60 * 60 * 24);
    } catch (e: any) {
      console.warn("[sendModelSpecSheet] datasheet URL unavailable:", e?.message);
    }
  }

  const clientId = (input.clientId ?? "").trim() || null;
  const verb = mode === "open" ? "handed off" : "sent";
  await emitEvent({
    entity_type: "spec_change_request",
    entity_id: productId,
    event_type: "spec_sheet.sent",
    message: `${input.productName} datasheet (${input.version ?? "—"}) ${verb} to ${recipient} via ${channel}`,
    payload: {
      product_id: productId,
      sku: input.sku ?? null,
      version: input.version ?? null,
      product_name: input.productName,
      channel,
      mode,
      // The sender identity behind the mode: personal (rep opens their own app)
      // vs business (Solux company channel via n8n). Redundant with `mode` but
      // explicit for the audit trail + downstream routing.
      sender: mode === "open" ? "personal" : "business",
      recipient,
      client_id: clientId,
      // Where the recipient came from: "client" when chosen from the rep's
      // client list (client_id set), "manual" when typed. The n8n channel
      // branches key off `mode`.
      recipient_source: clientId ? "client" : "manual",
      note: (input.message ?? "").trim() || null,
      datasheet_url: datasheetUrl,
      datasheet_filename: datasheetFilename,
    },
    bestEffort: true,
  });

  revalidatePath(`/productknowledgehub`);
  return { datasheetUrl };
}
