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
import { resolveAttachmentWriteAnchor } from "@/lib/attachments-server";

const VALID_TYPES = ATTACHMENT_TYPES.map((t) => t.value);

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

  const supabase = createClient();
  const { userId } = await getCurrentUserRole();
  // Real affair id post-m156, legacy chain root before (a fresh sales upload
  // must stay visible to its uploader under the m060 RLS read policy).
  const affairId = await resolveAttachmentWriteAnchor(supabase, documentId);

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
 * Replace an attachment with a NEW VERSION (SSoT Lot 4, m151). The browser
 * uploads the new file to Storage first, then calls this with the OLD row
 * id: we insert a new row chained to the same group (version = max+1,
 * doc_status restarts at 'draft' via the column default) and KEEP the old
 * row + file as history. Pre-m151 (no group_id column) we fall back to the
 * legacy behaviour: plain insert + delete of the old row.
 */
export async function replaceAttachment(formData: FormData): Promise<void> {
  const oldId = String(formData.get("replaces_id") ?? "");
  const documentId = String(formData.get("document_id") ?? "");
  const storagePath = String(formData.get("storage_path") ?? "");
  const fileName = String(formData.get("file_name") ?? "").trim();
  const fileSizeRaw = formData.get("file_size");
  const mimeType = String(formData.get("mime_type") ?? "") || null;
  if (!oldId) throw new Error("Missing replaces_id");
  if (!storagePath || !fileName) throw new Error("Missing file info");

  const supabase = createClient();
  const { userId } = await getCurrentUserRole();

  // Old row = the version chain anchor + metadata to carry over.
  let old: any = null;
  {
    const res = await supabase
      .from("attachments")
      .select("id, affair_id, attachment_type, note, group_id, version")
      .eq("id", oldId)
      .maybeSingle();
    if (res.error && /group_id|version/.test(res.error.message ?? "")) {
      // pre-m151 — legacy columns only
      const legacy = await supabase
        .from("attachments")
        .select("id, affair_id, attachment_type, note")
        .eq("id", oldId)
        .maybeSingle();
      old = legacy.data;
    } else {
      old = res.data;
    }
  }
  if (!old) throw new Error("Attachment not found.");

  const groupKey = old.group_id ?? old.id;
  const base = {
    affair_id: old.affair_id,
    storage_path: storagePath,
    file_name: fileName,
    file_size:
      fileSizeRaw != null && String(fileSizeRaw).trim() !== ""
        ? Number(fileSizeRaw)
        : null,
    mime_type: mimeType,
    attachment_type: old.attachment_type ?? "other",
    note: old.note ?? null,
    uploaded_by: userId,
  };

  // Versioned insert; on missing m151 columns → legacy insert + delete old.
  const { data: maxRows } = await supabase
    .from("attachments")
    .select("version")
    .eq("group_id", groupKey)
    .order("version", { ascending: false })
    .limit(1);
  const nextVersion =
    ((maxRows?.[0]?.version as number | undefined) ?? old.version ?? 1) + 1;
  const ins = await supabase
    .from("attachments")
    .insert({ ...base, group_id: groupKey, version: nextVersion });
  if (ins.error) {
    if (/group_id|version/.test(ins.error.message ?? "")) {
      const legacyIns = await supabase.from("attachments").insert(base);
      if (legacyIns.error) throw new Error(legacyIns.error.message);
      await supabase.from("attachments").delete().eq("id", oldId);
    } else {
      throw new Error(ins.error.message);
    }
  }

  if (documentId) revalidatePath(`/documents/${documentId}`);
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
