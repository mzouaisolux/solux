"use server";

import { createClient } from "@/lib/supabase/server";
import { requireTaskListManagerOrAdmin } from "@/lib/auth";
import { revalidatePath } from "next/cache";

function str(fd: FormData, key: string) {
  const v = fd.get(key);
  return v == null ? null : String(v).trim() || null;
}

/**
 * Create a commercial→internal component mapping. Sales reference is on
 * the left ("18RH battery"), internal factory reference on the right
 * ("LFP-18RH-32700-G2W"). Used by the task list manager during technical
 * enrichment.
 */
export async function createComponentMapping(formData: FormData) {
  await requireTaskListManagerOrAdmin();

  const commercial_name = str(formData, "commercial_name");
  const internal_reference = str(formData, "internal_reference");
  if (!commercial_name) throw new Error("Commercial name is required");
  if (!internal_reference) throw new Error("Internal reference is required");

  const supabase = createClient();
  const { error } = await supabase.from("component_mappings").insert({
    commercial_name,
    internal_reference,
    category: str(formData, "category"),
    notes: str(formData, "notes"),
    active: true,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/admin/components");
}

export async function updateComponentMapping(formData: FormData) {
  await requireTaskListManagerOrAdmin();
  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing mapping id");

  const commercial_name = str(formData, "commercial_name");
  const internal_reference = str(formData, "internal_reference");
  if (!commercial_name) throw new Error("Commercial name is required");
  if (!internal_reference) throw new Error("Internal reference is required");

  const supabase = createClient();
  const { error } = await supabase
    .from("component_mappings")
    .update({
      commercial_name,
      internal_reference,
      category: str(formData, "category"),
      notes: str(formData, "notes"),
      active: formData.get("active") === "on",
    })
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/admin/components");
}

export async function deleteComponentMapping(formData: FormData) {
  await requireTaskListManagerOrAdmin();
  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing mapping id");

  const supabase = createClient();
  const { error } = await supabase
    .from("component_mappings")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/admin/components");
}
