"use server";

/**
 * Integrations — "Send spec sheet to customer" from a quotation.
 *
 * Emits the spec_sheet.sent event, which the webhook fan-out (Step 4b) turns
 * into a spec_sheet.sent delivery for any subscribed endpoint — so n8n can push
 * the spec-sheet PDF to the customer over Zalo / WhatsApp / email. Also logs a
 * best-effort outbound touch on the client timeline.
 *
 * Gated by integration.log_interaction (the client-facing roles) — the same
 * grant that lets a rep log any other client interaction.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireCapability } from "@/lib/permissions";
import { getCurrentUserRole } from "@/lib/auth";
import { emitEvent } from "@/lib/events";

export async function sendSpecSheet(input: {
  documentId: string;
  specUrl?: string | null;
  note?: string | null;
}): Promise<void> {
  await requireCapability("integration.log_interaction");

  const documentId = (input.documentId ?? "").trim();
  if (!documentId) throw new Error("Missing quotation id");

  const specUrl = (input.specUrl ?? "").trim() || null;
  if (specUrl && !/^https?:\/\/.+/i.test(specUrl)) {
    throw new Error("Spec sheet link must be a valid http(s) URL.");
  }
  const note = (input.note ?? "").trim() || null;

  const supabase = createClient();
  const { data: doc } = await supabase
    .from("documents")
    .select("id, number, pdf_url, client_id, clients(company_name, email, phone_number)")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc) throw new Error("Quotation not found");

  const client = (doc as any).clients ?? null;
  const label = doc.number ?? documentId.slice(0, 8) + "…";

  // The event fans out to the spec_sheet.sent webhook (payload = everything n8n
  // needs to deliver the sheet). Best-effort: never block the rep's action.
  await emitEvent({
    entity_type: "document",
    entity_id: documentId,
    event_type: "spec_sheet.sent",
    message: `Spec sheet sent to customer for quotation ${label}`,
    payload: {
      document_id: documentId,
      number: doc.number ?? null,
      client_id: doc.client_id ?? null,
      company: client?.company_name ?? null,
      email: client?.email ?? null,
      phone: client?.phone_number ?? null,
      quotation_pdf_url: (doc as any).pdf_url ?? null,
      spec_url: specUrl,
      note,
    },
    bestEffort: true,
  });

  // Mirror onto the client's interaction timeline. Use the service client (the
  // capability gate above is the authorization) so a non-owner rep's send is
  // still recorded; created_by is set explicitly since it has no auth.uid().
  if (doc.client_id) {
    const svc = createServiceClient();
    if (svc) {
      const { userId } = await getCurrentUserRole();
      const { error } = await svc.from("client_interactions").insert({
        client_id: doc.client_id,
        channel: "email",
        direction: "outbound",
        source: "manual",
        summary: `Spec sheet sent for quotation ${label}${note ? ` — ${note}` : ""}`,
        payload: { document_id: documentId, spec_url: specUrl },
        created_by: userId,
      });
      if (error) console.warn("[sendSpecSheet] interaction log skipped:", error.message);
    }
  }

  revalidatePath(`/documents/${documentId}`);
}
