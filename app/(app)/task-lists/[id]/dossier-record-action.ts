"use server";

/**
 * Project Documents SSoT Lot 3 — "generated documents are first-class":
 * when the Production Dossier PDF is generated, the browser uploads the
 * blob to Storage and calls this action to REGISTER it as a project
 * document. We record it as an `order_documents` row (category
 * 'production') with group_id = the task list id — so regenerations
 * VERSION UP the same logical document, and it lands automatically in
 * the 🏭 Production folder of the project repository (m099 collector).
 *
 * Best-effort by design: no production order yet (dossier generated
 * before validation edge case) → we skip silently; the download itself
 * is never blocked.
 */

import { createClient } from "@/lib/supabase/server";

export async function recordGeneratedDossier(formData: FormData): Promise<void> {
  const taskListId = String(formData.get("task_list_id") ?? "");
  const storagePath = String(formData.get("storage_path") ?? "");
  const fileName = String(formData.get("file_name") ?? "");
  const fileSize = Number(formData.get("file_size") ?? 0) || null;
  if (!taskListId || !storagePath || !fileName) throw new Error("Missing dossier info.");

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: po } = await supabase
    .from("production_orders")
    .select("id")
    .eq("task_list_id", taskListId)
    .maybeSingle();
  if (!po?.id) return; // no PO yet — nothing to attach to (best-effort)

  const { data: prev } = await supabase
    .from("order_documents")
    .select("version")
    .eq("group_id", taskListId)
    .order("version", { ascending: false })
    .limit(1);
  const version = ((prev?.[0]?.version as number | undefined) ?? 0) + 1;

  const { error } = await supabase.from("order_documents").insert({
    production_order_id: po.id,
    group_id: taskListId, // stable per task list → regenerations version up
    version,
    name: fileName,
    storage_path: storagePath,
    file_size: fileSize,
    mime_type: "application/pdf",
    category: "production",
    uploaded_by: user?.id ?? null,
  });
  if (error) throw new Error(error.message);
}
