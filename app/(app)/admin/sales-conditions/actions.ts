"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function str(fd: FormData, key: string) {
  const v = fd.get(key);
  return v == null ? null : String(v).trim() || null;
}

async function clearDefaults(supabase: ReturnType<typeof createClient>) {
  // Partial unique index allows only one default — we clear before setting.
  await supabase.from("sales_conditions").update({ is_default: false }).eq("is_default", true);
}

export async function createSalesCondition(formData: FormData) {
  await requireAdmin();
  const supabase = createClient();

  const title = str(formData, "title");
  const content = str(formData, "content");
  const isDefault = formData.get("is_default") === "on";
  if (!title) throw new Error("Title is required");
  if (!content) throw new Error("Content is required");

  if (isDefault) await clearDefaults(supabase);

  const { error } = await supabase.from("sales_conditions").insert({
    title,
    content,
    is_default: isDefault,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/admin/sales-conditions");
}

export async function updateSalesCondition(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing id");

  const supabase = createClient();
  const isDefault = formData.get("is_default") === "on";
  if (isDefault) await clearDefaults(supabase);

  const { error } = await supabase
    .from("sales_conditions")
    .update({
      title: str(formData, "title"),
      content: str(formData, "content"),
      is_default: isDefault,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath(`/admin/sales-conditions/${id}`);
  revalidatePath("/admin/sales-conditions");
  redirect("/admin/sales-conditions");
}

export async function deleteSalesCondition(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing id");

  const supabase = createClient();
  const { error } = await supabase.from("sales_conditions").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/admin/sales-conditions");
}

export async function setDefaultSalesCondition(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing id");

  const supabase = createClient();
  await clearDefaults(supabase);
  const { error } = await supabase
    .from("sales_conditions")
    .update({ is_default: true })
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/admin/sales-conditions");
}
