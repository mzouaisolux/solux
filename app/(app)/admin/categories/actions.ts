"use server";

import { createClient } from "@/lib/supabase/server";
import { requireCapability, requireCapabilityOrAdmin } from "@/lib/permissions";
import {
  buildFactoryMappingClonePlan,
  type SourceMappedOption,
  type TargetOption,
} from "@/lib/factory-mapping-clone";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ConfigFieldType } from "@/lib/types";
import { CONFIG_FIELD_TYPES } from "@/lib/types";

function str(fd: FormData, key: string) {
  const v = fd.get(key);
  return v == null ? null : String(v).trim() || null;
}

function num(fd: FormData, key: string, fallback = 0) {
  const v = fd.get(key);
  if (v == null || String(v).trim() === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function bool(fd: FormData, key: string) {
  return fd.get(key) === "on" || fd.get(key) === "true";
}

// ---------- CATEGORIES ----------

export async function createCategory(formData: FormData) {
  await requireCapabilityOrAdmin("admin.manage_categories");
  const name = str(formData, "name");
  if (!name) throw new Error("Category name is required");

  const supabase = createClient();
  const { error } = await supabase
    .from("product_categories")
    .insert({ name, position: num(formData, "position") });
  if (error) throw new Error(error.message);

  revalidatePath("/admin/categories");
  revalidatePath("/admin/products");
}

/**
 * Like createCategory but with typed args and RETURNS the new id. Used by the
 * unified Product Catalog workspace (client call) so it can auto-select the
 * freshly created category and let the user start adding products immediately.
 */
export async function createCategoryReturning(
  name: string,
  position: number
): Promise<{ id: string }> {
  await requireCapabilityOrAdmin("admin.manage_categories");
  const clean = name.trim();
  if (!clean) throw new Error("Category name is required");

  const supabase = createClient();
  const { data, error } = await supabase
    .from("product_categories")
    .insert({ name: clean, position: Number.isFinite(position) ? position : 0 })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  revalidatePath("/admin/categories");
  revalidatePath("/admin/products");
  return { id: data.id };
}

export async function renameCategory(formData: FormData) {
  await requireCapabilityOrAdmin("admin.manage_categories");
  const id = String(formData.get("id"));
  const name = str(formData, "name");
  if (!id) throw new Error("Missing category id");
  if (!name) throw new Error("Category name is required");

  const supabase = createClient();
  const { error } = await supabase
    .from("product_categories")
    .update({ name, position: num(formData, "position") })
    .eq("id", id);
  if (error) throw new Error(error.message);

  // Keep the denormalized free-text `products.category` column in sync with
  // the renamed category so legacy UIs that read it stay coherent.
  await supabase
    .from("products")
    .update({ category: name })
    .eq("category_id", id);

  revalidatePath(`/admin/categories/${id}`);
  revalidatePath("/admin/categories");
  revalidatePath("/admin/products");
}

export async function deleteCategory(formData: FormData) {
  await requireCapabilityOrAdmin("admin.manage_categories");
  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing category id");
  // Optional: move this category's products to another category before deleting.
  const reassignTo = str(formData, "reassignTo");
  // What to do with the products: "reassign" (via reassignTo) | "orphan"
  // (default) | "delete_products" (permanently delete them).
  const mode = str(formData, "mode");

  const supabase = createClient();

  if (reassignTo && reassignTo !== id) {
    // Reassign products (keep the denormalized `category` text in sync).
    const { data: target } = await supabase
      .from("product_categories")
      .select("name")
      .eq("id", reassignTo)
      .maybeSingle();
    const { error: moveErr } = await supabase
      .from("products")
      .update({ category_id: reassignTo, category: target?.name ?? null })
      .eq("category_id", id);
    if (moveErr) throw new Error(moveErr.message);
  } else if (mode === "delete_products") {
    // Hard-delete every product in this category. Irreversible for the CATALOG
    // but NEVER touches history: migration 089 snapshots product name + price +
    // configuration onto every document/order/task-list line and sets the
    // line's product_id to NULL on delete — so quotations, proformas, orders,
    // invoices and production task lists stay fully readable. Catalog satellites
    // (options, prices_version, product_costs, pricing-engine rows, technical
    // mappings) cascade-delete with the product. Must run BEFORE the category
    // delete, while products.category_id still matches this category.
    const { error: delProdErr } = await supabase
      .from("products")
      .delete()
      .eq("category_id", id);
    if (delProdErr) throw new Error(delProdErr.message);
  } else {
    // Orphan path: products keep existing (FK is ON DELETE SET NULL) but become
    // Uncategorized. Clear the denormalized `category` text so it isn't stale.
    await supabase.from("products").update({ category: null }).eq("category_id", id);
  }

  const { error } = await supabase.from("product_categories").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/admin/categories");
  revalidatePath("/admin/products");
  // Categories now live in the unified Product Catalog — land there after delete
  // (whether triggered from the catalog table or the category Edit page).
  redirect("/admin/products");
}

// ---------- FIELDS ----------

export async function createConfigField(formData: FormData) {
  await requireCapabilityOrAdmin("admin.manage_categories");
  const category_id = String(formData.get("category_id"));
  const field_name = str(formData, "field_name");
  const field_type = str(formData, "field_type");
  if (!category_id) throw new Error("Missing category id");
  if (!field_name) throw new Error("Field name is required");
  if (!field_type || !CONFIG_FIELD_TYPES.includes(field_type as ConfigFieldType)) {
    throw new Error("Invalid field type");
  }

  const supabase = createClient();
  // access_level supersedes internal_only; keep both in sync for backward compat.
  const rawAccess = str(formData, "access_level") ?? "everyone";
  const access_level =
    rawAccess === "internal" || rawAccess === "admin" ? rawAccess : "everyone";
  const internal_only = access_level !== "everyone";
  // field_scope: sales | technical | both
  const rawScope = str(formData, "field_scope") ?? "sales";
  const field_scope =
    rawScope === "technical" ? "technical" : rawScope === "both" ? "both" : "sales";

  const { data: inserted, error } = await supabase
    .from("config_fields")
    .insert({
      category_id,
      field_name,
      field_type,
      required: bool(formData, "required"),
      required_for_production: bool(formData, "required_for_production"),
      default_value: str(formData, "default_value"),
      placeholder: str(formData, "placeholder"),
      field_order: num(formData, "field_order"),
      visible_in_quotation: bool(formData, "visible_in_quotation"),
      visible_in_task_list: bool(formData, "visible_in_task_list"),
      visible_in_factory: bool(formData, "visible_in_factory"),
      internal_only,
      access_level,
      // Only meaningful for dropdowns. Stored as a flat boolean so we can also
      // toggle it on/off later without touching the rest of the row.
      allow_custom_value:
        field_type === "dropdown" && bool(formData, "allow_custom_value"),
      field_scope,
      active: true,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  // Dropdown + checkbox_group: if the admin pasted bulk options into the
  // new-field form, insert them right away so the field is usable immediately.
  if ((field_type === "dropdown" || field_type === "checkbox_group") && inserted?.id) {
    const raw = String(formData.get("bulk_options") ?? "");
    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length > 0) {
      const seen = new Set<string>();
      const rows = lines
        .filter((v) => {
          const lo = v.toLowerCase();
          if (seen.has(lo)) return false;
          seen.add(lo);
          return true;
        })
        .map((v, i) => ({
          field_id: inserted.id,
          option_value: v,
          option_order: i * 10,
        }));
      if (rows.length > 0) {
        const { error: optError } = await supabase
          .from("config_field_options")
          .insert(rows);
        if (optError) throw new Error(optError.message);
      }
    }
  }

  revalidatePath(`/admin/categories/${category_id}`);
}

export async function updateConfigField(formData: FormData) {
  await requireCapabilityOrAdmin("admin.manage_categories");
  const id = String(formData.get("id"));
  const category_id = String(formData.get("category_id"));
  if (!id) throw new Error("Missing field id");

  const supabase = createClient();
  const field_type = str(formData, "field_type");
  if (!field_type || !CONFIG_FIELD_TYPES.includes(field_type as ConfigFieldType)) {
    throw new Error("Invalid field type");
  }
  const rawAccess = str(formData, "access_level") ?? "everyone";
  const access_level =
    rawAccess === "internal" || rawAccess === "admin" ? rawAccess : "everyone";
  const internal_only = access_level !== "everyone";
  const rawScope = str(formData, "field_scope") ?? "sales";
  const field_scope =
    rawScope === "technical" ? "technical" : rawScope === "both" ? "both" : "sales";

  const { error } = await supabase
    .from("config_fields")
    .update({
      field_name: str(formData, "field_name"),
      field_type,
      required: bool(formData, "required"),
      required_for_production: bool(formData, "required_for_production"),
      default_value: str(formData, "default_value"),
      placeholder: str(formData, "placeholder"),
      field_order: num(formData, "field_order"),
      visible_in_quotation: bool(formData, "visible_in_quotation"),
      visible_in_task_list: bool(formData, "visible_in_task_list"),
      visible_in_factory: bool(formData, "visible_in_factory"),
      internal_only,
      access_level,
      allow_custom_value:
        field_type === "dropdown" && bool(formData, "allow_custom_value"),
      field_scope,
      active: bool(formData, "active"),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath(`/admin/categories/${category_id}`);
}

export async function deleteConfigField(formData: FormData) {
  await requireCapabilityOrAdmin("admin.manage_categories");
  const id = String(formData.get("id"));
  const category_id = String(formData.get("category_id"));
  if (!id) throw new Error("Missing field id");

  const supabase = createClient();
  const { error } = await supabase.from("config_fields").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath(`/admin/categories/${category_id}`);
}

// ---------- FIELD OPTIONS ----------

export async function addFieldOption(formData: FormData) {
  await requireCapabilityOrAdmin("admin.manage_categories");
  const field_id = String(formData.get("field_id"));
  const category_id = String(formData.get("category_id"));
  const option_value = str(formData, "option_value");
  if (!field_id) throw new Error("Missing field id");
  if (!option_value) throw new Error("Option value is required");

  const supabase = createClient();
  const { error } = await supabase.from("config_field_options").insert({
    field_id,
    option_value,
    option_order: num(formData, "option_order"),
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/admin/categories/${category_id}`);
}

/**
 * Bulk-add: paste one option per line. Trims, dedupes against existing rows
 * (case-insensitive), and assigns sequential `option_order` after the
 * current max. Empty lines are ignored. Much faster than one-at-a-time.
 */
export async function addFieldOptionsBulk(formData: FormData) {
  await requireCapabilityOrAdmin("admin.manage_categories");
  const field_id = String(formData.get("field_id"));
  const category_id = String(formData.get("category_id"));
  const raw = String(formData.get("bulk_options") ?? "");
  if (!field_id) throw new Error("Missing field id");

  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return;

  const supabase = createClient();

  // Fetch existing options to dedupe (case-insensitive) + find next order.
  const { data: existing } = await supabase
    .from("config_field_options")
    .select("option_value, option_order")
    .eq("field_id", field_id);
  const existingLower = new Set(
    (existing ?? []).map((o: any) => String(o.option_value).toLowerCase())
  );
  let nextOrder =
    (existing ?? []).reduce(
      (max: number, o: any) => Math.max(max, Number(o.option_order ?? 0)),
      -10
    ) + 10;

  const rows: { field_id: string; option_value: string; option_order: number }[] = [];
  const seenInBatch = new Set<string>();
  for (const v of lines) {
    const low = v.toLowerCase();
    if (existingLower.has(low) || seenInBatch.has(low)) continue;
    seenInBatch.add(low);
    rows.push({ field_id, option_value: v, option_order: nextOrder });
    nextOrder += 10;
  }
  if (rows.length === 0) return;

  const { error } = await supabase.from("config_field_options").insert(rows);
  if (error) throw new Error(error.message);

  revalidatePath(`/admin/categories/${category_id}`);
}

export async function deleteFieldOption(formData: FormData) {
  await requireCapabilityOrAdmin("admin.manage_categories");
  const id = String(formData.get("id"));
  const category_id = String(formData.get("category_id"));
  if (!id) throw new Error("Missing option id");

  const supabase = createClient();
  const { error } = await supabase.from("config_field_options").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath(`/admin/categories/${category_id}`);
}

// =========================================================================
// DUPLICATION & TEMPLATES
// =========================================================================

/**
 * Deep-copy a category: creates a new category named "<Name> (Copy)" and
 * duplicates all of its config_fields + config_field_options. The copy is
 * fully independent — editing one never affects the other.
 *
 * Works for both regular categories AND templates (is_template is preserved
 * in the copy so you can duplicate a template to derive a new variant).
 */
export async function duplicateCategory(formData: FormData) {
  await requireCapabilityOrAdmin("admin.manage_categories");
  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing category id");

  // Optional: also clone the source family's factory mappings onto the copy.
  // Writing factory_mappings is governed by `factory_mapping.access` at BOTH
  // the app layer and RLS (migration 088) — enforce it up front, before any
  // writes, so we never leave a half-built copy that then fails on the mapping
  // upsert. (Admins hold this capability in the matrix, so they pass.)
  const copyMappings = bool(formData, "copy_factory_mappings");
  if (copyMappings) await requireCapability("factory_mapping.access");

  const supabase = createClient();

  // 1. Load the source category + all fields + all options.
  const [{ data: src }, { data: srcFields }] = await Promise.all([
    supabase
      .from("product_categories")
      .select("name, position, is_template")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("config_fields")
      .select(
        "id, field_name, field_type, required, default_value, placeholder, field_order, visible_in_quotation, visible_in_task_list, internal_only, allow_custom_value, field_scope, active"
      )
      .eq("category_id", id)
      .order("field_order"),
  ]);
  if (!src) throw new Error("Category not found");

  const fieldIds = (srcFields ?? []).map((f) => f.id);
  const { data: srcOptions } = fieldIds.length
    ? await supabase
        .from("config_field_options")
        .select("id, field_id, option_value, option_order")
        .in("field_id", fieldIds)
        .order("option_order")
    : { data: [] };

  // 2. Create the new category.
  const { data: newCat, error: catErr } = await supabase
    .from("product_categories")
    .insert({
      name: `${src.name} (Copy)`,
      position: (src.position ?? 0) + 1,
      is_template: (src as any).is_template ?? false,
    })
    .select("id")
    .single();
  if (catErr) throw new Error(catErr.message);
  const newCatId = newCat.id;

  // 3. Copy fields, remembering old→new id mapping.
  if ((srcFields ?? []).length > 0) {
    const oldToNew = new Map<string, string>();
    for (const f of srcFields ?? []) {
      const { data: newF, error: fErr } = await supabase
        .from("config_fields")
        .insert({
          category_id: newCatId,
          field_name: f.field_name,
          field_type: f.field_type,
          required: f.required,
          default_value: f.default_value,
          placeholder: f.placeholder,
          field_order: f.field_order,
          visible_in_quotation: f.visible_in_quotation,
          visible_in_task_list: f.visible_in_task_list,
          internal_only: f.internal_only,
          allow_custom_value: f.allow_custom_value,
          field_scope: f.field_scope,
          active: f.active,
        })
        .select("id")
        .single();
      if (fErr) throw new Error(fErr.message);
      oldToNew.set(f.id, newF.id);
    }

    // 4. Copy options using new field ids. Capture the inserted ids so we can
    //    re-bind factory mappings to them below (step 5).
    const optRows = (srcOptions ?? [])
      .map((o) => {
        const newFieldId = oldToNew.get(o.field_id);
        if (!newFieldId) return null;
        return { field_id: newFieldId, option_value: o.option_value, option_order: o.option_order };
      })
      .filter(Boolean) as { field_id: string; option_value: string; option_order: number }[];

    let newOptions: { id: string; field_id: string; option_value: string }[] = [];
    if (optRows.length > 0) {
      const { data: inserted, error: optErr } = await supabase
        .from("config_field_options")
        .insert(optRows)
        .select("id, field_id, option_value");
      if (optErr) throw new Error(optErr.message);
      newOptions = inserted ?? [];
    }

    // 5. Optionally clone the source family's factory mappings onto the copy.
    //    The copy has brand-new option_ids, so mappings (keyed by option_id)
    //    don't carry over by themselves — we re-bind them by matching option
    //    VALUE per field, the same key the resolver/gate use. Reuses the shared
    //    pure planner so the standalone "copy between families" path and this
    //    one stay in lock-step.
    if (copyMappings && newOptions.length > 0) {
      const oldFieldName = new Map((srcFields ?? []).map((f) => [f.id, f.field_name]));
      const newFieldName = new Map<string, string>();
      for (const f of srcFields ?? []) {
        const nid = oldToNew.get(f.id);
        if (nid) newFieldName.set(nid, f.field_name);
      }

      const srcOptIds = (srcOptions ?? []).map((o) => o.id);
      const { data: mappings } = srcOptIds.length
        ? await supabase
            .from("factory_mappings")
            .select("option_id, factory_instruction, factory_code, notes, active")
            .in("option_id", srcOptIds)
        : { data: [] as any[] };
      const mappingByOption = new Map((mappings ?? []).map((m) => [m.option_id, m]));

      const sourceMappedOptions: SourceMappedOption[] = [];
      for (const o of srcOptions ?? []) {
        const m = mappingByOption.get(o.id);
        if (!m) continue;
        sourceMappedOptions.push({
          field_name: oldFieldName.get(o.field_id) ?? "",
          option_value: o.option_value,
          factory_instruction: m.factory_instruction,
          factory_code: m.factory_code,
          notes: m.notes,
          active: m.active,
        });
      }

      if (sourceMappedOptions.length > 0) {
        const targetOptions: TargetOption[] = newOptions.map((o) => ({
          field_id: o.field_id,
          option_id: o.id,
          field_name: newFieldName.get(o.field_id) ?? "",
          option_value: o.option_value,
        }));
        const plan = buildFactoryMappingClonePlan({ sourceMappedOptions, targetOptions });
        if (plan.rows.length > 0) {
          const stamped = plan.rows.map((r) => ({
            ...r,
            updated_at: new Date().toISOString(),
          }));
          const { error: mapErr } = await supabase
            .from("factory_mappings")
            .upsert(stamped, { onConflict: "option_id" });
          if (mapErr) throw new Error(mapErr.message);
        }
      }
    }
  }

  revalidatePath("/admin/categories");
  if (copyMappings) revalidatePath("/factory-mapping");
  redirect(`/admin/categories/${newCatId}`);
}

/**
 * Duplicate a single config field (+ its options) within the same category.
 * The copy is named "<Field name> (Copy)" and appended after the last field.
 */
export async function duplicateConfigField(formData: FormData) {
  await requireCapabilityOrAdmin("admin.manage_categories");
  const id = String(formData.get("id"));
  const category_id = String(formData.get("category_id"));
  if (!id) throw new Error("Missing field id");
  if (!category_id) throw new Error("Missing category id");

  const supabase = createClient();

  // Load source field + its options.
  const [{ data: src }, { data: srcOpts }] = await Promise.all([
    supabase
      .from("config_fields")
      .select(
        "field_name, field_type, required, default_value, placeholder, field_order, visible_in_quotation, visible_in_task_list, internal_only, allow_custom_value, field_scope, active"
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("config_field_options")
      .select("option_value, option_order")
      .eq("field_id", id)
      .order("option_order"),
  ]);
  if (!src) throw new Error("Field not found");

  // Append after last field in the category.
  const { data: lastField } = await supabase
    .from("config_fields")
    .select("field_order")
    .eq("category_id", category_id)
    .order("field_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const newOrder = ((lastField as any)?.field_order ?? 0) + 10;

  // Create the new field.
  const { data: newField, error: fErr } = await supabase
    .from("config_fields")
    .insert({
      category_id,
      field_name: `${src.field_name} (Copy)`,
      field_type: src.field_type,
      required: src.required,
      default_value: src.default_value,
      placeholder: src.placeholder,
      field_order: newOrder,
      visible_in_quotation: src.visible_in_quotation,
      visible_in_task_list: src.visible_in_task_list,
      internal_only: src.internal_only,
      allow_custom_value: src.allow_custom_value,
      field_scope: src.field_scope,
      active: src.active,
    })
    .select("id")
    .single();
  if (fErr) throw new Error(fErr.message);

  // Copy options.
  if ((srcOpts ?? []).length > 0) {
    const optRows = (srcOpts ?? []).map((o) => ({
      field_id: newField.id,
      option_value: o.option_value,
      option_order: o.option_order,
    }));
    const { error: optErr } = await supabase.from("config_field_options").insert(optRows);
    if (optErr) throw new Error(optErr.message);
  }

  revalidatePath(`/admin/categories/${category_id}`);
}

/**
 * Mark an existing category as a template (is_template = true).
 * The category keeps all its fields and options; it is simply flagged
 * so the UI can list it separately and hide it from product dropdowns.
 */
export async function saveAsTemplate(formData: FormData) {
  await requireCapabilityOrAdmin("admin.manage_categories");
  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing category id");

  const supabase = createClient();
  const { error } = await supabase
    .from("product_categories")
    .update({ is_template: true } as any)
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/admin/categories");
}

/**
 * Unmark a template so it becomes a regular category again.
 */
export async function unmarkTemplate(formData: FormData) {
  await requireCapabilityOrAdmin("admin.manage_categories");
  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing category id");

  const supabase = createClient();
  const { error } = await supabase
    .from("product_categories")
    .update({ is_template: false } as any)
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/admin/categories");
}

/**
 * Create a new independent category from a template snapshot.
 * The template is not modified. All fields + options are deep-copied.
 * The new category always has is_template = false.
 */
export async function createFromTemplate(formData: FormData) {
  await requireCapabilityOrAdmin("admin.manage_categories");
  const template_id = String(formData.get("template_id"));
  const name = str(formData, "name");
  if (!template_id) throw new Error("Missing template id");
  if (!name) throw new Error("Category name is required");

  const supabase = createClient();

  // Load template + fields + options (reuse duplicateCategory logic).
  const [{ data: tmpl }, { data: tmplFields }] = await Promise.all([
    supabase
      .from("product_categories")
      .select("position, is_template")
      .eq("id", template_id)
      .maybeSingle(),
    supabase
      .from("config_fields")
      .select(
        "id, field_name, field_type, required, default_value, placeholder, field_order, visible_in_quotation, visible_in_task_list, internal_only, allow_custom_value, field_scope, active"
      )
      .eq("category_id", template_id)
      .order("field_order"),
  ]);
  if (!tmpl) throw new Error("Template not found");

  const fieldIds = (tmplFields ?? []).map((f) => f.id);
  const { data: tmplOptions } = fieldIds.length
    ? await supabase
        .from("config_field_options")
        .select("field_id, option_value, option_order")
        .in("field_id", fieldIds)
        .order("option_order")
    : { data: [] };

  // Create the new regular category.
  const { data: newCat, error: catErr } = await supabase
    .from("product_categories")
    .insert({
      name,
      position: (tmpl as any).position ?? 0,
      is_template: false,
    })
    .select("id")
    .single();
  if (catErr) throw new Error(catErr.message);
  const newCatId = newCat.id;

  // Deep-copy fields + options.
  if ((tmplFields ?? []).length > 0) {
    const oldToNew = new Map<string, string>();
    for (const f of tmplFields ?? []) {
      const { data: newF, error: fErr } = await supabase
        .from("config_fields")
        .insert({
          category_id: newCatId,
          field_name: f.field_name,
          field_type: f.field_type,
          required: f.required,
          default_value: f.default_value,
          placeholder: f.placeholder,
          field_order: f.field_order,
          visible_in_quotation: f.visible_in_quotation,
          visible_in_task_list: f.visible_in_task_list,
          internal_only: f.internal_only,
          allow_custom_value: f.allow_custom_value,
          field_scope: f.field_scope,
          active: f.active,
        })
        .select("id")
        .single();
      if (fErr) throw new Error(fErr.message);
      oldToNew.set(f.id, newF.id);
    }

    const optRows = (tmplOptions ?? [])
      .map((o) => {
        const newFieldId = oldToNew.get(o.field_id);
        if (!newFieldId) return null;
        return { field_id: newFieldId, option_value: o.option_value, option_order: o.option_order };
      })
      .filter(Boolean) as { field_id: string; option_value: string; option_order: number }[];

    if (optRows.length > 0) {
      const { error: optErr } = await supabase.from("config_field_options").insert(optRows);
      if (optErr) throw new Error(optErr.message);
    }
  }

  revalidatePath("/admin/categories");
  redirect(`/admin/categories/${newCatId}`);
}
