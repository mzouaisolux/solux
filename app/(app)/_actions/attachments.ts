"use server";

/**
 * Attachment server actions.
 *
 * Upload flow (kept simple + reusing the proven PDF Storage path):
 *   1. The client uploads the file straight to the `documents` bucket
 *      via the browser Supabase client (authenticated — same policy the
 *      PDF flow already relies on), under `attachments/<affairId>/…`.
 *   2. The client then calls `recordAttachment` with the resulting path
 *      + metadata to persist the row (RLS scopes it to the affair).
 *
 * Download is handled by the server panel, which mints short-lived
 * signed URLs. No OCR / parsing / approval — deliberately lightweight.
 */

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { getCurrentUserRole } from "@/lib/auth";
import {
  ATTACHMENT_TYPES,
  ATTACHMENTS_BUCKET,
  type AttachmentType,
} from "@/lib/attachments";

const VALID_TYPES = ATTACHMENT_TYPES.map((t) => t.value);

/**
 * Resolve the affair root for a document id (root_document_id ?? id),
 * tolerating the column being absent (pre-m059).
 */
async function resolveAffairId(documentId: string): Promise<string> {
  const supabase = createClient();
  try {
    const { data } = await supabase
      .from("documents")
      .select("id, root_document_id")
      .eq("id", documentId)
      .maybeSingle();
    return (data?.root_document_id as string | null) ?? documentId;
  } catch {
    return documentId;
  }
}

/**
 * Persist an attachment row after the file has been uploaded to Storage.
 * `document_id` is any document of the affair (we resolve the root).
 */
export async function recordAttachment(formData: FormData): Promise<void> {
  const documentId = String(formData.get("document_id") ?? "");
  const storagePath = String(formData.get("storage_path") ?? "");
  const fileName = String(formData.get("file_name") ?? "").trim();
  const fileSizeRaw = formData.get("file_size");
  const mimeType = String(formData.get("mime_type") ?? "") || null;
  const typeRaw = String(formData.get("attachment_type") ?? "other");
  const note = String(formData.get("note") ?? "").trim() || null;

  if (!documentId) throw new Error("Missing document_id");
  if (!storagePath) throw new Error("Missing storage_path");
  if (!fileName) throw new Error("Missing file_name");

  const attachmentType = (VALID_TYPES.includes(typeRaw as AttachmentType)
    ? typeRaw
    : "other") as AttachmentType;

  const fileSize =
    fileSizeRaw != null && String(fileSizeRaw).trim() !== ""
      ? Number(fileSizeRaw)
      : null;

  // Visibility flags — checkbox value "1" = visible. Defaults applied
  // when the field is absent (uploader always sends them explicitly).
  const flag = (key: string, dflt: boolean) => {
    const v = formData.get(key);
    if (v == null) return dflt;
    return v === "1" || v === "true" || v === "on";
  };

  const { userId } = await getCurrentUserRole();
  const affairId = await resolveAffairId(documentId);

  const supabase = createClient();
  const { error } = await supabase.from("attachments").insert({
    affair_id: affairId,
    storage_path: storagePath,
    file_name: fileName,
    file_size: fileSize,
    mime_type: mimeType,
    attachment_type: attachmentType,
    note,
    visible_sales: flag("visible_sales", true),
    visible_ops: flag("visible_ops", true),
    visible_factory: flag("visible_factory", true),
    visible_client: flag("visible_client", false),
    uploaded_by: userId,
  });
  if (error) {
    if (/attachments/.test(error.message ?? "")) {
      throw new Error(
        "attachments table missing — apply migration m060 (060_attachments.sql) in Supabase."
      );
    }
    throw new Error(error.message);
  }

  // Refresh both surfaces that show the affair's attachments.
  revalidatePath(`/documents/${documentId}`);
  revalidatePath("/task-lists", "layout");
}

/**
 * Update an existing attachment's type and/or comment (note). Used by
 * the inline per-file editor in the attachments list. RLS gates who can
 * (uploader or technical roles). Each field is optional — only the ones
 * present in the form are touched.
 */
export async function updateAttachment(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const documentId = String(formData.get("document_id") ?? "");
  if (!id) throw new Error("Missing attachment id");

  const patch: Record<string, unknown> = {};
  const typeRaw = formData.get("attachment_type");
  if (typeRaw !== null) {
    const t = String(typeRaw);
    patch.attachment_type = VALID_TYPES.includes(t as AttachmentType)
      ? t
      : "other";
  }
  const noteRaw = formData.get("note");
  if (noteRaw !== null) {
    patch.note = String(noteRaw).trim() || null;
  }
  if (Object.keys(patch).length === 0) return;

  const supabase = createClient();
  const { error } = await supabase
    .from("attachments")
    .update(patch)
    .eq("id", id);
  if (error) throw new Error(error.message);

  if (documentId) revalidatePath(`/documents/${documentId}`);
  revalidatePath("/task-lists", "layout");
}

/**
 * Delete an attachment: remove the row (RLS gates who can) then best-
 * effort remove the Storage object so we don't orphan files.
 */
export async function deleteAttachment(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const documentId = String(formData.get("document_id") ?? "");
  if (!id) throw new Error("Missing attachment id");

  const supabase = createClient();

  // Read the path first (so we can clean Storage after the row delete).
  const { data: row } = await supabase
    .from("attachments")
    .select("storage_path")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase.from("attachments").delete().eq("id", id);
  if (error) throw new Error(error.message);

  if (row?.storage_path) {
    // Best-effort — a leftover Storage object is harmless, never block.
    await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .remove([row.storage_path as string])
      .catch(() => {});
  }

  if (documentId) revalidatePath(`/documents/${documentId}`);
  revalidatePath("/task-lists", "layout");
}
