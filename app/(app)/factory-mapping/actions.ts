"use server";

import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/permissions";
import {
  buildFactoryMappingClonePlan,
  type SourceMappedOption,
  type TargetOption,
} from "@/lib/factory-mapping-clone";
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
  // An unchecked checkbox is OMITTED from the POST, which would silently store
  // active=false (the resolver/gate then ignore the mapping → "missing" even
  // though an instruction was saved). Distinguish "the form carried an active
  // control" (marker present → honor checked/unchecked, so explicit
  // deactivation still works) from "no active control at all" (programmatic
  // caller → default ACTIVE, so a filled mapping is never silently inert).
  const activeRaw = formData.get("active");
  const active =
    formData.get("active_present") != null
      ? activeRaw === "on" || activeRaw === "true"
      : true;

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
  // Factory mappings are GLOBAL — a change can affect ANY task list's
  // missing-mapping gate. Invalidate task-list routes too (defense-in-depth;
  // the no-store Supabase client already keeps server reads fresh).
  revalidatePath("/task-lists", "layout");
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
  // Factory mappings are GLOBAL — a change can affect ANY task list's
  // missing-mapping gate. Invalidate task-list routes too (defense-in-depth;
  // the no-store Supabase client already keeps server reads fresh).
  revalidatePath("/task-lists", "layout");
}

export type CopyMappingsResult = {
  copied: number;
  skipped: number;
  sourceMappings: number;
};

/**
 * Copy every factory mapping from a SOURCE family onto a TARGET family whose
 * dropdown options share the same VALUES (e.g. a family created by duplicating
 * another). Each source mapping's instruction + factory_code (+ notes/active)
 * is re-bound to the target option matched by `${field_name}|${value}`
 * (case-insensitive value — same key the resolver uses). Target options with no
 * source match are left untouched.
 *
 * Idempotent: writes through the same onConflict:"option_id" upsert as
 * upsertFactoryMapping, so re-running overwrites with identical rows. Gated by
 * the SAME capability as editing a mapping (factory_mapping.access), which is
 * also enforced by RLS (migration 088) on the write.
 *
 * Returns counts so the caller can surface "X copied, Y skipped".
 */
export async function copyFactoryMappingsFromFamily(
  sourceCategoryId: string,
  targetCategoryId: string
): Promise<CopyMappingsResult> {
  await requireCapability("factory_mapping.access");

  const source = String(sourceCategoryId ?? "").trim();
  const target = String(targetCategoryId ?? "").trim();
  if (!source || !target) throw new Error("Pick a source and a target family.");
  if (source === target)
    throw new Error("Source and target must be different families.");

  const supabase = createClient();

  // Only dropdown fields carry mappable options — mirror the factory-mapping page.
  const [{ data: srcFields }, { data: tgtFields }] = await Promise.all([
    supabase
      .from("config_fields")
      .select("id, field_name")
      .eq("category_id", source)
      .eq("field_type", "dropdown"),
    supabase
      .from("config_fields")
      .select("id, field_name")
      .eq("category_id", target)
      .eq("field_type", "dropdown"),
  ]);

  const srcFieldName = new Map((srcFields ?? []).map((f) => [f.id, f.field_name]));
  const tgtFieldName = new Map((tgtFields ?? []).map((f) => [f.id, f.field_name]));
  const srcFieldIds = [...srcFieldName.keys()];
  const tgtFieldIds = [...tgtFieldName.keys()];
  if (srcFieldIds.length === 0 || tgtFieldIds.length === 0) {
    return { copied: 0, skipped: 0, sourceMappings: 0 };
  }

  const [{ data: srcOpts }, { data: tgtOpts }] = await Promise.all([
    supabase
      .from("config_field_options")
      .select("id, field_id, option_value")
      .in("field_id", srcFieldIds),
    supabase
      .from("config_field_options")
      .select("id, field_id, option_value")
      .in("field_id", tgtFieldIds),
  ]);

  const srcOptIds = (srcOpts ?? []).map((o) => o.id);
  const { data: mappings } = srcOptIds.length
    ? await supabase
        .from("factory_mappings")
        .select("option_id, factory_instruction, factory_code, notes, active")
        .in("option_id", srcOptIds)
    : { data: [] as any[] };
  const mappingByOption = new Map((mappings ?? []).map((m) => [m.option_id, m]));

  const sourceMappedOptions: SourceMappedOption[] = [];
  for (const o of srcOpts ?? []) {
    const m = mappingByOption.get(o.id);
    if (!m) continue; // source option without a mapping — nothing to clone
    sourceMappedOptions.push({
      field_name: srcFieldName.get(o.field_id) ?? "",
      option_value: o.option_value,
      factory_instruction: m.factory_instruction,
      factory_code: m.factory_code,
      notes: m.notes,
      active: m.active,
    });
  }

  const targetOptions: TargetOption[] = (tgtOpts ?? []).map((o) => ({
    field_id: o.field_id,
    option_id: o.id,
    field_name: tgtFieldName.get(o.field_id) ?? "",
    option_value: o.option_value,
  }));

  const plan = buildFactoryMappingClonePlan({ sourceMappedOptions, targetOptions });

  if (plan.rows.length > 0) {
    const stamped = plan.rows.map((r) => ({
      ...r,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase
      .from("factory_mappings")
      .upsert(stamped, { onConflict: "option_id" });
    if (error) throw new Error(error.message);
  }

  revalidatePath("/factory-mapping");
  // Global mappings affect any task list — invalidate task-list routes too.
  revalidatePath("/task-lists", "layout");
  return {
    copied: plan.copied,
    skipped: plan.skipped,
    sourceMappings: plan.sourceMappings,
  };
}
