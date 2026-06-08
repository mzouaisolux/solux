"use server";

import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

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

  const { error } = await supabase.from("order_documents").insert({
    production_order_id: orderId,
    group_id: groupId,
    version,
    name: fileName,
    storage_path: storagePath,
    file_size: fileSize,
    mime_type: mime,
    category,
    uploaded_by: userId,
  });
  if (error) throw new Error(error.message);

  await supabase.from("order_document_audit").insert({
    production_order_id: orderId,
    document_group_id: groupId,
    action,
    file_name: fileName,
    actor: userId,
  });
  revalidateOrder(orderId);
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
