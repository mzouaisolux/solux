"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Currency } from "@/lib/types";

function str(fd: FormData, key: string) {
  const v = fd.get(key);
  return v == null ? null : String(v).trim() || null;
}

function currency(fd: FormData): Currency {
  const v = str(fd, "currency");
  if (v !== "USD" && v !== "EUR" && v !== "CNY") {
    throw new Error("Currency must be USD, EUR or CNY");
  }
  return v;
}

async function clearDefaultForCurrency(
  supabase: ReturnType<typeof createClient>,
  cur: Currency
) {
  await supabase
    .from("bank_accounts")
    .update({ is_default: false })
    .eq("currency", cur)
    .eq("is_default", true);
}

export async function createBankAccount(formData: FormData) {
  await requireAdmin();
  const supabase = createClient();

  const account_name = str(formData, "account_name");
  if (!account_name) throw new Error("Account name is required");
  const cur = currency(formData);
  const isDefault = formData.get("is_default") === "on";

  if (isDefault) await clearDefaultForCurrency(supabase, cur);

  // Try inserting WITH the new business_account_name column (m038). If
  // the column isn't there yet, retry without so the form still works
  // on a pre-migration env.
  const baseInsert = {
    account_name,
    currency: cur,
    bank_name: str(formData, "bank_name"),
    bank_address: str(formData, "bank_address"),
    account_number: str(formData, "account_number"),
    swift: str(formData, "swift"),
    is_default: isDefault,
  };
  const businessAccountName = str(formData, "business_account_name") || null;

  let attempt = await supabase
    .from("bank_accounts")
    .insert({ ...baseInsert, business_account_name: businessAccountName });
  if (
    attempt.error &&
    /business_account_name/.test(attempt.error.message ?? "")
  ) {
    attempt = await supabase.from("bank_accounts").insert(baseInsert);
  }
  if (attempt.error) throw new Error(attempt.error.message);

  revalidatePath("/admin/banks");
}

export async function updateBankAccount(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing id");

  const supabase = createClient();
  const cur = currency(formData);
  const isDefault = formData.get("is_default") === "on";

  if (isDefault) await clearDefaultForCurrency(supabase, cur);

  const baseUpdate = {
    account_name: str(formData, "account_name"),
    currency: cur,
    bank_name: str(formData, "bank_name"),
    bank_address: str(formData, "bank_address"),
    account_number: str(formData, "account_number"),
    swift: str(formData, "swift"),
    is_default: isDefault,
  };
  const businessAccountName = str(formData, "business_account_name") || null;

  // Same fallback pattern as createBankAccount — defends the action
  // against an env where m038 hasn't landed yet.
  let attempt = await supabase
    .from("bank_accounts")
    .update({ ...baseUpdate, business_account_name: businessAccountName })
    .eq("id", id);
  if (
    attempt.error &&
    /business_account_name/.test(attempt.error.message ?? "")
  ) {
    attempt = await supabase
      .from("bank_accounts")
      .update(baseUpdate)
      .eq("id", id);
  }
  if (attempt.error) throw new Error(attempt.error.message);

  revalidatePath(`/admin/banks/${id}`);
  revalidatePath("/admin/banks");
  redirect("/admin/banks");
}

export async function deleteBankAccount(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing id");

  const supabase = createClient();
  const { error } = await supabase.from("bank_accounts").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/admin/banks");
}

export async function setDefaultBankAccount(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing id");

  const supabase = createClient();

  // Need the account's currency to clear only its bucket.
  const { data: row } = await supabase
    .from("bank_accounts")
    .select("currency")
    .eq("id", id)
    .maybeSingle();
  if (!row) throw new Error("Bank account not found");

  await clearDefaultForCurrency(supabase, row.currency as Currency);
  const { error } = await supabase
    .from("bank_accounts")
    .update({ is_default: true })
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/admin/banks");
}
