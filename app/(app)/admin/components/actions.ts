"use server";

import { createClient } from "@/lib/supabase/server";
import { requireTaskListManagerOrAdmin } from "@/lib/auth";
import { revalidatePath } from "next/cache";

function str(fd: FormData, key: string) {
  const v = fd.get(key);
  return v == null ? null : String(v).trim() || null;
}

/** Multi-select values → uuid[]; absent field → []. */
function ids(fd: FormData, key: string): string[] {
  return fd
    .getAll(key)
    .map((v) => String(v).trim())
    .filter(Boolean);
}

/** m160 columns absent pre-migration → retry the write without them. */
const M160_COL_RE =
  /commercial_name_fr|factory_name_cn|erp_code|compatible_category_ids|compatible_product_ids|metadata/;

/**
 * Create a Product Dictionary entry (component_mappings). The commercial
 * name (EN) maps to the OFFICIAL factory reference — plus, since m160, the
 * FR name, the Chinese factory terminology, the ERP code and the product
 * families the item is compatible with (empty = generic, offered for every
 * family in the task-list spare-parts selector).
 */
export async function createComponentMapping(formData: FormData) {
  await requireTaskListManagerOrAdmin();

  const commercial_name = str(formData, "commercial_name");
  const internal_reference = str(formData, "internal_reference");
  if (!commercial_name) throw new Error("Commercial name is required");
  if (!internal_reference) throw new Error("Internal reference is required");

  const base = {
    commercial_name,
    internal_reference,
    category: str(formData, "category"),
    notes: str(formData, "notes"),
    active: true,
  };
  const m160 = {
    commercial_name_fr: str(formData, "commercial_name_fr"),
    factory_name_cn: str(formData, "factory_name_cn"),
    erp_code: str(formData, "erp_code"),
    compatible_category_ids: ids(formData, "compatible_category_ids"),
  };

  const supabase = createClient();
  let { error } = await supabase
    .from("component_mappings")
    .insert({ ...base, ...m160 });
  if (error && M160_COL_RE.test(error.message ?? "")) {
    // m160 not applied yet — keep the base dictionary usable (graceful).
    ({ error } = await supabase.from("component_mappings").insert(base));
  }
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

  const base = {
    commercial_name,
    internal_reference,
    category: str(formData, "category"),
    notes: str(formData, "notes"),
    active: formData.get("active") === "on",
  };
  // Only touch the m160 columns when the form actually carried them (the
  // pre-m160 fallback UI doesn't render those inputs).
  const hasM160 = formData.has("commercial_name_fr") || formData.has("erp_code");
  const m160 = hasM160
    ? {
        commercial_name_fr: str(formData, "commercial_name_fr"),
        factory_name_cn: str(formData, "factory_name_cn"),
        erp_code: str(formData, "erp_code"),
        compatible_category_ids: ids(formData, "compatible_category_ids"),
      }
    : {};

  const supabase = createClient();
  let { error } = await supabase
    .from("component_mappings")
    .update({ ...base, ...m160 })
    .eq("id", id);
  if (error && M160_COL_RE.test(error.message ?? "")) {
    ({ error } = await supabase.from("component_mappings").update(base).eq("id", id));
  }
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
