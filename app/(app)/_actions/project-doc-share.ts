"use server";

/**
 * Project Documents SSoT Lot 3 — Share: mint a copyable signed link for a
 * repository file (valid 7 days). The lookup is ID-based and runs under
 * the caller's own RLS-scoped read — you can only share what you can
 * already open. Records (in-app pages) are shared client-side.
 */

import { createClient } from "@/lib/supabase/server";
import { ATTACHMENTS_BUCKET } from "@/lib/attachments";

const SHARE_TTL_SECONDS = 7 * 24 * 3600;

export async function createDocumentShareLink(
  source: string,
  id: string,
  extra?: string
): Promise<{ url: string }> {
  if (!id) throw new Error("Missing document id.");
  const supabase = createClient();

  let path: string | null = null;
  if (source === "attachment") {
    const { data } = await supabase
      .from("attachments")
      .select("storage_path")
      .eq("id", id)
      .maybeSingle();
    path = data?.storage_path ?? null;
  } else if (source === "order_document") {
    const { data } = await supabase
      .from("order_documents")
      .select("storage_path")
      .eq("id", id)
      .maybeSingle();
    path = data?.storage_path ?? null;
  } else if (source === "lighting") {
    const { data } = await supabase
      .from("product_lighting_setups")
      .select("energy_study_path, dialux_path")
      .eq("id", id)
      .maybeSingle();
    path = extra === "dialux" ? data?.dialux_path ?? null : data?.energy_study_path ?? null;
  } else if (source === "quotation") {
    const { data } = await supabase
      .from("documents")
      .select("pdf_url")
      .eq("id", id)
      .maybeSingle();
    path = data?.pdf_url ?? null;
  } else {
    throw new Error("Unknown document source.");
  }
  if (!path) throw new Error("File not found (or no PDF generated yet).");

  const { data, error } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUrl(path, SHARE_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? "Could not create the share link.");
  }
  return { url: data.signedUrl };
}
