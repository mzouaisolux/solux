/**
 * Server-side task-list mapping/revision status (D1.1).
 *
 * Fetches a task list's context (lines + config fields + options + factory
 * mappings + client presets) and delegates the COUNTING to the pure
 * `countMissingMappings` — the exact same logic the task-list page renders.
 * Used by validateTaskList / markProductionReady to enforce server-side what
 * the Release-to-Production modal enforces client-side.
 *
 * READ-ONLY w.r.t. Factory Mapping: it resolves the existing autonomous
 * global/client/order mapping layers; it never writes or creates mappings.
 */

// Use the FRESH (no-store) client: this gate must see a factory mapping the
// moment it's saved in the autonomous zone (#12). It runs as a server action,
// so it can't rely on a page's force-dynamic. Scoped here only — the rest of
// the app keeps the cached client for performance.
import { createFreshClient } from "@/lib/supabase/server";
import { optionLookupKey } from "@/lib/types";
import type { ConfigField, FactoryMapping } from "@/lib/types";
import {
  countMissingMappings,
  type MappingLine,
} from "@/lib/task-list-mapping-status";

/** Count required factory mappings still missing for a task list. */
export async function countMissingTaskListMappings(
  taskListId: string
): Promise<number> {
  const supabase = createFreshClient();

  const [{ data: task }, { data: lines }] = await Promise.all([
    supabase
      .from("production_task_lists")
      .select("client_id")
      .eq("id", taskListId)
      .maybeSingle(),
    supabase
      .from("production_task_list_lines")
      .select(
        "config_values, factory_overrides, product_id, category_id, products(category_id)"
      )
      .eq("task_list_id", taskListId),
  ]);

  // SCOPE the config fetch to ONLY the categories present on this task list.
  // config_field_options and factory_mappings are app-wide tables: an UNSCOPED
  // select(...) hits the PostgREST row cap and returns a NON-DETERMINISTIC
  // subset (no stable total order), so a saved + active mapping intermittently
  // fails to resolve and the missing-count oscillates (5→3→5) across identical
  // reads — the exact bug seen in the 2026-06-19 E2E test. Scoping by
  // category → field_id makes each result set tiny, deterministic and cap-proof.
  // The task-list PAGE applies the SAME scoping so its displayed count and this
  // release gate can never diverge.
  const categoryIds = Array.from(
    new Set(
      // m133 — prefer the line's own category; fall back to the live product
      // join for legacy catalog lines created before the backfill.
      ((lines ?? []) as any[])
        .map((l) => l.category_id ?? l.products?.category_id)
        .filter(Boolean)
    )
  ) as string[];
  if (categoryIds.length === 0) return 0;

  const { data: fields } = await supabase
    .from("config_fields")
    .select("id, category_id, field_name, field_type, field_scope")
    .in("category_id", categoryIds)
    .eq("active", true)
    .eq("visible_in_task_list", true);

  const fieldIds = ((fields ?? []) as any[]).map((f) => f.id);
  if (fieldIds.length === 0) return 0;

  // factory_mappings.field_id is ALWAYS populated (upsertFactoryMapping requires
  // it; the clone writes it from the target option) so scoping mappings by
  // field_id is complete and lets options + mappings load in parallel.
  const [{ data: opts }, { data: mappings }] = await Promise.all([
    supabase
      .from("config_field_options")
      .select("id, field_id, option_value")
      .in("field_id", fieldIds),
    supabase
      .from("factory_mappings")
      .select(
        "id, field_id, option_id, factory_instruction, factory_code, notes, active"
      )
      .in("field_id", fieldIds),
  ]);

  // Build the SAME lookup maps the page builds.
  const optionsByField = new Map<string, any[]>();
  for (const o of (opts ?? []) as any[]) {
    if (!optionsByField.has(o.field_id)) optionsByField.set(o.field_id, []);
    optionsByField.get(o.field_id)!.push(o);
  }
  // Sales bucket = scope 'sales' or 'both' (technical-only fields excluded —
  // they aren't part of the "missing mappings" count on the page).
  const salesFieldsByCategory = new Map<string, ConfigField[]>();
  for (const f of (fields ?? []) as any[]) {
    if ((f.field_scope ?? "sales") === "technical") continue;
    if (!salesFieldsByCategory.has(f.category_id))
      salesFieldsByCategory.set(f.category_id, []);
    salesFieldsByCategory.get(f.category_id)!.push(f as ConfigField);
  }
  const mappingsByOption = new Map<string, FactoryMapping>();
  for (const m of (mappings ?? []) as FactoryMapping[]) {
    mappingsByOption.set(m.option_id, m);
  }
  const optionIdByFieldValue = new Map<string, string>();
  for (const f of (fields ?? []) as any[]) {
    if (f.field_type !== "dropdown") continue;
    for (const o of optionsByField.get(f.id) ?? []) {
      optionIdByFieldValue.set(
        optionLookupKey(f.category_id, f.field_name, o.option_value),
        o.id
      );
    }
  }

  // Client preset layer (technical preset per product).
  const clientOverridesByProduct = new Map<string, Record<string, string>>();
  const productIds = Array.from(
    new Set(((lines ?? []) as any[]).map((l) => l.product_id).filter(Boolean))
  ) as string[];
  if (task?.client_id && productIds.length) {
    const { data: presetRows } = await supabase
      .from("client_technical_presets")
      .select("product_id, mapping")
      .eq("client_id", task.client_id)
      .in("product_id", productIds);
    for (const r of (presetRows ?? []) as any[]) {
      const m = r.mapping;
      if (m && typeof m === "object" && !Array.isArray(m)) {
        const clean: Record<string, string> = {};
        for (const [k, v] of Object.entries(m)) {
          if (typeof v === "string" && v.trim() !== "") clean[k] = v;
        }
        clientOverridesByProduct.set(r.product_id, clean);
      }
    }
  }

  const mappingLines: MappingLine[] = ((lines ?? []) as any[]).map((l) => ({
    productId: l.product_id,
    categoryId: l.category_id ?? l.products?.category_id ?? null, // m133
    config: (l.config_values ?? {}) as Record<string, string>,
    overrides: (l.factory_overrides ?? {}) as Record<string, string>,
  }));

  return countMissingMappings({
    lines: mappingLines,
    salesFieldsByCategory,
    mappingsByOption,
    optionIdByFieldValue,
    clientOverridesByProduct,
  });
}

/**
 * Is there an OPEN (unanswered) revision request on this task list?
 * A request counts as open while it has no reply pointing at it and no
 * resolved_at — RLS-proof (doesn't depend on Sales being able to flip
 * resolved_at, which is restricted to technical roles).
 */
export async function taskListHasOpenRevision(
  taskListId: string
): Promise<boolean> {
  const supabase = createFreshClient();
  const { data } = await supabase
    .from("entity_messages")
    .select("id, message_kind, parent_message_id, resolved_at, structured_payload")
    .eq("entity_type", "task_list")
    .eq("entity_id", taskListId)
    .in("message_kind", ["request", "reply"]);
  const rows = (data ?? []) as any[];
  const repliedParents = new Set(
    rows
      .filter((r) => r.message_kind === "reply" && r.parent_message_id)
      .map((r) => r.parent_message_id)
  );
  return rows.some(
    (r) =>
      r.message_kind === "request" &&
      r.structured_payload?.kind === "revision_request" &&
      !r.resolved_at &&
      !repliedParents.has(r.id)
  );
}
