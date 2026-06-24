"use server";

import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/permissions";

/**
 * Order Documents actions (m099). Collaborative by design — any authenticated
 * user can upload / replace / archive / restore. No capability gate; governance
 * is the version history + append-only audit + soft delete, not access blocks.
 */

function reqStr(fd: FormData, k: string): string {
  const v = fd.get(k);
  if (typeof v !== "string" || !v.trim()) throw new Error(`Missing ${k}`);
  return v.trim();
}
function optStr(fd: FormData, k: string): string | null {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function revalidateOrder(orderId: string) {
  revalidatePath(`/production/orders/${orderId}`);
}
async function requireUserId(supabase: ReturnType<typeof createClient>): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be signed in.");
  return user.id;
}

/** Upload a new document, OR a new VERSION of an existing one (replace). The
 *  browser uploads the file to the `documents` bucket first, then calls this. */
export async function recordOrderDocument(formData: FormData): Promise<void> {
  const supabase = createClient();
  const userId = await requireUserId(supabase);
  const orderId = reqStr(formData, "order_id");
  const storagePath = reqStr(formData, "storage_path");
  const fileName = reqStr(formData, "file_name");
  const sizeRaw = Number(formData.get("file_size"));
  const fileSize = Number.isFinite(sizeRaw) ? Math.round(sizeRaw) : null;
  const mime = optStr(formData, "mime_type");
  const category = optStr(formData, "category") ?? "other";
  // m115 — canonical shipping-document kind (commercial_invoice,
  // packing_list, …). Optional: free uploads stay kind-less, exactly the
  // pre-m115 behavior. The Shipping Documents checklist matches on it.
  const kind = optStr(formData, "kind");
  const replaceGroupId = optStr(formData, "replace_group_id");

  let groupId: string;
  let version = 1;
  let action: "upload" | "replace" = "upload";
  if (replaceGroupId) {
    action = "replace";
    groupId = replaceGroupId;
    const { data: prev } = await supabase
      .from("order_documents")
      .select("version")
      .eq("group_id", replaceGroupId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    version = Number((prev as any)?.version ?? 0) + 1;
  } else {
    groupId = randomUUID();
  }

  const row: Record<string, any> = {
    production_order_id: orderId,
    group_id: groupId,
    version,
    name: fileName,
    storage_path: storagePath,
    file_size: fileSize,
    mime_type: mime,
    category,
    uploaded_by: userId,
  };
  if (kind) row.kind = kind;
  // Defensive write (house pattern): if m115 isn't applied yet, retry
  // without `kind` so plain uploads keep working on a pre-m115 database.
  let insertAttempt = await supabase.from("order_documents").insert(row);
  if (
    insertAttempt.error &&
    kind &&
    /kind/.test(insertAttempt.error.message ?? "")
  ) {
    const { kind: _drop, ...fallback } = row;
    void _drop;
    insertAttempt = await supabase.from("order_documents").insert(fallback);
  }
  if (insertAttempt.error) throw new Error(insertAttempt.error.message);

  await supabase.from("order_document_audit").insert({
    production_order_id: orderId,
    document_group_id: groupId,
    action,
    file_name: fileName,
    actor: userId,
  });
  revalidateOrder(orderId);
}

/**
 * Assign the Commercial Invoice number for an order (m115).
 *
 * Idempotent: the number is minted ONCE (own sequence, CI-XXXX) and then
 * reused forever — regenerating the PDF creates a new VERSION of the same
 * logical document, never a new number. Gated by
 * `production_order.edit_shipment`: the CI is part of the shipment
 * package, so whoever prepares the shipment mints it. Read-only roles
 * can still view/download the generated document.
 */
export async function assignCommercialInvoiceNumber(
  orderId: string
): Promise<string> {
  await requireCapability("production_order.edit_shipment");
  if (!orderId) throw new Error("Missing production order id");
  const supabase = createClient();

  const { data: existing, error: loadErr } = await supabase
    .from("production_orders")
    .select("commercial_invoice_number")
    .eq("id", orderId)
    .maybeSingle();
  if (loadErr) {
    if (/commercial_invoice_number/.test(loadErr.message ?? "")) {
      throw new Error(
        "Commercial Invoice numbering is not installed — apply migration 115_shipping_documents_package.sql in Supabase first."
      );
    }
    throw new Error(loadErr.message);
  }
  if (!existing) throw new Error("Production order not found");

  const current = (existing as any).commercial_invoice_number as string | null;
  if (current) return current;

  const { data: minted, error: seqErr } = await supabase.rpc("next_ci_number");
  if (seqErr) {
    throw new Error(
      /next_ci_number/.test(seqErr.message ?? "") || seqErr.code === "42883"
        ? "next_ci_number() is not deployed — apply migration 115 in Supabase first."
        : seqErr.message
    );
  }
  const ciNumber = String(minted);

  const { error: saveErr } = await supabase
    .from("production_orders")
    .update({ commercial_invoice_number: ciNumber })
    .eq("id", orderId);
  if (saveErr) throw new Error(saveErr.message);

  revalidateOrder(orderId);
  return ciNumber;
}

/** Soft-delete a logical document (all its versions). Files are kept. */
export async function archiveOrderDocument(formData: FormData): Promise<void> {
  const supabase = createClient();
  const userId = await requireUserId(supabase);
  const orderId = reqStr(formData, "order_id");
  const groupId = reqStr(formData, "group_id");
  const { error } = await supabase
    .from("order_documents")
    .update({ archived_at: new Date().toISOString(), archived_by: userId })
    .eq("group_id", groupId);
  if (error) throw new Error(error.message);
  await supabase.from("order_document_audit").insert({
    production_order_id: orderId,
    document_group_id: groupId,
    action: "archive",
    file_name: optStr(formData, "file_name"),
    actor: userId,
  });
  revalidateOrder(orderId);
}

/** Restore a soft-deleted document. */
export async function restoreOrderDocument(formData: FormData): Promise<void> {
  const supabase = createClient();
  const userId = await requireUserId(supabase);
  const orderId = reqStr(formData, "order_id");
  const groupId = reqStr(formData, "group_id");
  const { error } = await supabase
    .from("order_documents")
    .update({ archived_at: null, archived_by: null })
    .eq("group_id", groupId);
  if (error) throw new Error(error.message);
  await supabase.from("order_document_audit").insert({
    production_order_id: orderId,
    document_group_id: groupId,
    action: "restore",
    file_name: optStr(formData, "file_name"),
    actor: userId,
  });
  revalidateOrder(orderId);
}
