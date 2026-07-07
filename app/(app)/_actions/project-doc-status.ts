"use server";

/**
 * Project Documents SSoT Lot 2 (m150) — set the lifecycle status of a
 * repository file: Draft / Approved / Final. Applies to the two FILE
 * sources (manual uploads + production-order documents); quotations and
 * invoices keep their own commercial statuses.
 *
 * Gated by `document.set_status` (matrix-delegable; admins pass via the
 * capability grant seeded in m150).
 */

import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/permissions";

const SOURCES = new Set(["attachment", "order_document"]);
const STATUSES = new Set(["draft", "approved", "final"]);

export async function setProjectDocumentStatus(formData: FormData): Promise<void> {
  await requireCapability("document.set_status");
  const source = String(formData.get("source") ?? "");
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!SOURCES.has(source)) throw new Error("Unknown document source.");
  if (!id) throw new Error("Missing document id.");
  if (!STATUSES.has(status)) throw new Error("Unknown status.");

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const table = source === "attachment" ? "attachments" : "order_documents";
  const { error } = await supabase
    .from(table)
    .update({
      doc_status: status,
      status_set_by: user?.id ?? null,
      status_set_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) {
    if (/doc_status/.test(error.message ?? "")) {
      throw new Error("Document status needs migration 150 (not applied yet).");
    }
    throw new Error(error.message);
  }
}
