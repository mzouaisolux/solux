// =====================================================================
// Manual production items (poles / masts / any non-catalog line) — m135.
// =====================================================================
//
// Business rule (owner decision 2026-06-29): "Launch Production" matches every
// quotation line to a catalog Product. Poles are NEVER catalog items — every
// project has different specs (height, thickness, arm, wind load, galvanization…)
// and prices change constantly, so they are bought project-by-project and never
// maintained as standard products. Such lines must become MANUAL items on the
// task list: free-form name + specs, editable, with no Product reference.
//
// CLASSIFICATION (single source of truth): a line is a manual item iff it has
// neither a catalog product NOR a category. With no product there is nothing to
// snapshot, and with no category there is no configurator/factory-mapping to
// drive — so the only sensible representation is a free-form manual item.
//
//   • Catalog product line .................. product_id set         → NOT manual
//   • Service-Request family line ........... product_id null, category set
//                                                                    → NOT manual
//                                             (keeps the category configurator)
//   • Pole / mast / custom free-text line ... product_id null, category null
//                                                                    → MANUAL
//
// This helper is the ONE place the rule lives. It is used at conversion
// (generateProductionTaskList sets production_task_list_lines.is_manual) and as
// the render-time fallback for rows created before the is_manual column existed.
// The migration backfill (m135) encodes the same predicate in SQL.
// =====================================================================

/**
 * True when a line is a manual (non-catalog) item: no product AND no category.
 * Accepts the loose `string | null | undefined` shapes that come off the
 * untyped Supabase client.
 */
export function isManualLine(
  productId: string | null | undefined,
  categoryId: string | null | undefined
): boolean {
  return !productId && !categoryId;
}

/** Fallback display name for a manual item with no name captured yet. */
export const MANUAL_ITEM_FALLBACK_NAME = "Manual item";

/** A quotation/proforma document line, in the loose shape the conversion reads. */
export type QuotationLineForConversion = {
  product_id?: string | null;
  category_id?: string | null;
  client_product_name?: string | null;
  unit_price?: number | null;
  quantity?: number | null;
  selected_options?: Record<string, string> | null;
  config_values?: Record<string, string> | null;
};

/** The production_task_list_lines insert row produced from one document line. */
export type TaskListLineInsert = {
  task_list_id: string;
  product_id: string | null;
  category_id: string | null;
  is_manual: boolean;
  product_name: string | null;
  unit_price: number | null;
  quantity: number | null;
  config_values: Record<string, string>;
  internal_notes: null;
  position: number;
};

/**
 * Build the production-task-list line insert row for one quotation/proforma
 * line — the heart of "Launch Production". Pure (no DB) so the manual-item
 * rule is unit-testable end-to-end.
 *
 *   • Catalog / Service-Request lines: product_id + category_id carried as-is;
 *     is_manual false; no name/price snapshot (the page uses the live products
 *     join + the m089 delete-time snapshot, and price stays on the proforma).
 *   • MANUAL items (poles/masts/non-catalog): is_manual true; the free-text
 *     name is snapshotted into product_name and the quoted unit_price is copied
 *     as a read-only reference.
 *
 * selected_options (legacy) is merged UNDER config_values so the factory teams
 * see everything, with config_values winning on key collisions (m133/009).
 */
export function buildTaskListLineFromQuotationLine(
  l: QuotationLineForConversion,
  taskListId: string,
  position: number
): TaskListLineInsert {
  const manual = isManualLine(l.product_id, l.category_id);
  return {
    task_list_id: taskListId,
    product_id: l.product_id ?? null,
    category_id: l.category_id ?? null,
    is_manual: manual,
    // Name snapshot: manual items always get one (their name IS the data).
    // Service-Request family lines (no product, category set) snapshot the
    // SR's descriptive commercial name too — without it the task-list line
    // renders as just the bare category (OBS-1, E2E « 14 juillet »). Catalog
    // lines stay null: the page reads the live products join / m089 snapshot.
    product_name: manual
      ? l.client_product_name?.trim() || MANUAL_ITEM_FALLBACK_NAME
      : !l.product_id && l.category_id
      ? l.client_product_name?.trim() || null
      : null,
    unit_price: manual ? l.unit_price ?? null : null,
    quantity: l.quantity ?? null,
    config_values: {
      ...(l.selected_options ?? {}),
      ...(l.config_values ?? {}),
    },
    internal_notes: null,
    position,
  };
}
