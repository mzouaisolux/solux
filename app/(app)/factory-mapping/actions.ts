"use server";

import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/permissions";
import { revalidatePath } from "next/cache";

function str(fd: FormData, key: string) {
  const v = fd.get(key);
  return v == null ? null : String(v).trim() || null;
}

/**
 * Upsert a factory mapping for a given dropdown option. Idempotent on
 * (option_id) thanks to the UNIQUE constraint — passing the same option_id
 * again replaces the previous instruction.
 */
export async function upsertFactoryMapping(formData: FormData) {
  // Capability-driven (matrix), real-role enforced. Mirrors the page gate
  // and the RLS write policy so all three layers honor the same toggle.
  await requireCapability("factory_mapping.access");

  const field_id = String(formData.get("field_id"));
  const option_id = String(formData.get("option_id"));
  const factory_instruction = str(formData, "factory_instruction");
  if (!field_id) throw new Error("Missing field id");
  if (!option_id) throw new Error("Missing option id");
  if (!factory_instruction)
    throw new Error("Factory instruction is required");

  const factory_code = str(formData, "factory_code");
  const notes = str(formData, "notes");
  const active = formData.get("active") === "on" || formData.get("active") === "true";

  const supabase = createClient();
  // Use upsert with onConflict on option_id so a second save for the same
  // option overwrites instead of erroring on the unique constraint.
  const { error } = await supabase
    .from("factory_mappings")
    .upsert(
      {
        field_id,
        option_id,
        factory_instruction,
        factory_code,
        notes,
        active,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "option_id" }
    );
  if (error) throw new Error(error.message);

  revalidatePath("/factory-mapping");
}

/** Remove the mapping for a given option — falls back to "missing" state. */
export async function deleteFactoryMapping(formData: FormData) {
  await requireCapability("factory_mapping.access");

  const option_id = String(formData.get("option_id"));
  if (!option_id) throw new Error("Missing option id");

  const supabase = createClient();
  const { error } = await supabase
    .from("factory_mappings")
    .delete()
    .eq("option_id", option_id);
  if (error) throw new Error(error.message);

  revalidatePath("/factory-mapping");
}
