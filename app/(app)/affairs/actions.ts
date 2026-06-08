"use server";

// =====================================================================
// Affairs (Projects) — server actions. P2b-1.
//
// Writes to the `affairs` table (m076/m077). RLS already gates these
// (insert/update by creator/owner/technical). Owner reassignment is
// additionally gated to management here. No deletes — cleanup is status
// (lost/abandoned) or a soft archive (archived_at + mandatory reason).
// =====================================================================

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserRole } from "@/lib/auth";
import { isTechnicalRole } from "@/lib/types";

const LIFECYCLE = [
  "lead",
  "opportunity",
  "quotation",
  "negotiation",
  "won",
  "in_production",
  "shipped",
  "completed",
  "lost",
  "abandoned",
] as const;

const now = () => new Date().toISOString();

/** Create a project FIRST — before any quotation. */
export async function createAffair(formData: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Project name is required");
  const client_id = String(formData.get("client_id") ?? "") || null;
  const ownerRaw = String(formData.get("owner_id") ?? "");
  const owner_id = ownerRaw && ownerRaw !== "__unassign__" ? ownerRaw : user?.id ?? null;

  const { error } = await supabase.from("affairs").insert({
    name,
    client_id,
    owner_id,
    status: "lead",
    created_by: user?.id ?? null,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/affairs");
}

export async function renameAffair(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!id) throw new Error("Missing project id");
  if (!name) throw new Error("Project name is required");
  const supabase = createClient();
  const { error } = await supabase
    .from("affairs")
    .update({ name, updated_at: now() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/affairs");
}

/** Set the independent project lifecycle status (also used by lost/abandoned). */
export async function setAffairStatus(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id) throw new Error("Missing project id");
  if (!(LIFECYCLE as readonly string[]).includes(status)) {
    throw new Error("Invalid project status");
  }
  const supabase = createClient();
  const { error } = await supabase
    .from("affairs")
    .update({ status, updated_at: now() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/affairs");
}

/** Assign the project owner; owner is inherited by the project's documents. */
export async function setAffairOwner(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing project id");
  const raw = String(formData.get("owner_id") ?? "");
  const owner_id = raw && raw !== "__unassign__" ? raw : null;

  const { role } = await getCurrentUserRole();
  if (!isTechnicalRole(role)) {
    throw new Error("Only management roles can reassign project ownership.");
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("affairs")
    .update({ owner_id, updated_at: now() })
    .eq("id", id);
  if (error) throw new Error(error.message);

  // Owner inheritance: propagate to this project's documents (m066).
  await supabase.from("documents").update({ sales_owner_id: owner_id }).eq("affair_id", id);

  revalidatePath("/affairs");
}

/** Soft archive — reason is mandatory (Decision F). No destructive delete. */
export async function archiveAffair(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!id) throw new Error("Missing project id");
  if (!reason) throw new Error("An archive reason is required.");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("affairs")
    .update({
      archived_at: now(),
      archived_by: user?.id ?? null,
      archive_reason: reason,
      updated_at: now(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/affairs");
}

/**
 * Hard-delete a project — only when EMPTY. If any quotation is still linked,
 * refuse and point the user to Archive (mirrors the client-delete safety rule:
 * never orphan linked records). Quotations themselves are never deleted here.
 */
export async function deleteAffair(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing project id");
  const supabase = createClient();

  const { count } = await supabase
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("affair_id", id);
  if ((count ?? 0) > 0) {
    throw new Error(
      `Cannot delete this project — ${count} quotation(s) are still linked. ` +
        `Remove them from the project first, or use "Archive project" instead.`,
    );
  }

  const { error } = await supabase.from("affairs").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/affairs");
  revalidatePath("/clients", "layout");
}

/** Resolve a document's whole version family (root + all its revisions). */
async function familyIds(
  supabase: ReturnType<typeof createClient>,
  documentId: string,
): Promise<string[]> {
  const { data: doc } = await supabase
    .from("documents")
    .select("id, root_document_id")
    .eq("id", documentId)
    .single();
  const root = (doc?.root_document_id as string | null) ?? documentId;
  const { data: fam } = await supabase
    .from("documents")
    .select("id")
    .or(`id.eq.${root},root_document_id.eq.${root}`);
  const ids = (fam ?? []).map((d: { id: string }) => d.id);
  return ids.length ? ids : [documentId];
}

/** Assign an existing quotation (and its whole version family) to a project. */
export async function assignDocumentToAffair(formData: FormData) {
  const affair_id = String(formData.get("affair_id") ?? "");
  const document_id = String(formData.get("document_id") ?? "");
  if (!affair_id || !document_id) throw new Error("Missing project or document id");
  const supabase = createClient();
  const ids = await familyIds(supabase, document_id);
  const { error } = await supabase.from("documents").update({ affair_id }).in("id", ids);
  if (error) throw new Error(error.message);
  // Keep linked production records consistent (the version family moves together).
  await supabase.from("production_task_lists").update({ affair_id }).in("quotation_id", ids);
  await supabase.from("production_orders").update({ affair_id }).in("quotation_id", ids);
  revalidatePath("/affairs");
  revalidatePath(`/affairs/${affair_id}`);
}

/** Remove a quotation (and its version family) from its project. */
export async function unassignDocument(formData: FormData) {
  const document_id = String(formData.get("document_id") ?? "");
  const affair_id = String(formData.get("affair_id") ?? "");
  if (!document_id) throw new Error("Missing document id");
  const supabase = createClient();
  const ids = await familyIds(supabase, document_id);
  const { error } = await supabase
    .from("documents")
    .update({ affair_id: null })
    .in("id", ids);
  if (error) throw new Error(error.message);
  await supabase.from("production_task_lists").update({ affair_id: null }).in("quotation_id", ids);
  await supabase.from("production_orders").update({ affair_id: null }).in("quotation_id", ids);
  revalidatePath("/affairs");
  if (affair_id) revalidatePath(`/affairs/${affair_id}`);
}
