"use server";

/**
 * Programming-rules administration — server actions (m180).
 * Gated on `lighting_rules.manage` (super_admin/admin floor + TLM), checked
 * here AND in RLS. The rules feed ONE resolver shared by the task-list UI,
 * the release gates, exports and AI population — editing here changes what
 * blocks Final Validation, which is exactly the point.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireCapabilityOrAdmin } from "@/lib/permissions";
import { getCurrentUserRole } from "@/lib/auth";
import { RULE_OUTCOMES } from "@/lib/lighting/programming-rules";

const MISSING_TABLE =
  "Rules table missing — apply migration m180 (180_line_lighting_and_rules.sql) in Supabase.";

function str(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  return v == null ? null : String(v).trim() || null;
}

export async function saveProgrammingRule(formData: FormData) {
  await requireCapabilityOrAdmin("lighting_rules.manage");
  const { userId } = await getCurrentUserRole();

  const outcome = str(formData, "outcome");
  if (!outcome || !(RULE_OUTCOMES as string[]).includes(outcome)) {
    throw new Error("Pick an outcome (required / optional / not applicable).");
  }
  const category_id = str(formData, "category_id");
  const sku_pattern = str(formData, "sku_pattern");
  const controller = str(formData, "controller");
  if (!category_id && !sku_pattern && !controller) {
    throw new Error(
      "A rule needs at least one matcher (family, SKU pattern or controller) — a blanket rule would override the default for every product."
    );
  }
  const priority = Number(str(formData, "priority") ?? "0");

  const row: Record<string, unknown> = {
    outcome,
    priority: Number.isFinite(priority) ? Math.round(priority) : 0,
    category_id,
    sku_pattern,
    controller,
    notes: str(formData, "notes"),
    active: str(formData, "active") !== "0",
    updated_by: userId ?? null,
    updated_at: new Date().toISOString(),
  };

  const supabase = createClient();
  const id = str(formData, "id");
  const { error } = id
    ? await supabase.from("lighting_programming_rules").update(row).eq("id", id)
    : await supabase
        .from("lighting_programming_rules")
        .insert({ ...row, created_by: userId ?? null });
  if (error) {
    throw new Error(/lighting_programming_rules/i.test(error.message ?? "") ? MISSING_TABLE : error.message);
  }
  revalidatePath("/admin/lighting-rules");
}

export async function deleteProgrammingRule(formData: FormData) {
  await requireCapabilityOrAdmin("lighting_rules.manage");
  const id = str(formData, "id");
  if (!id) throw new Error("Missing rule id");
  const supabase = createClient();
  const { error } = await supabase.from("lighting_programming_rules").delete().eq("id", id);
  if (error) {
    throw new Error(/lighting_programming_rules/i.test(error.message ?? "") ? MISSING_TABLE : error.message);
  }
  revalidatePath("/admin/lighting-rules");
}
