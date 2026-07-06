import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
// Render fresh so a just-saved mapping shows immediately (#12), without the
// app-wide cache penalty of a global no-store.
export const dynamic = "force-dynamic";
import { hasUiCapability } from "@/lib/permissions";
import AccessDenied from "@/components/AccessDenied";
import MappingGrid from "./MappingGrid";
import type { MappingGridRow } from "@/lib/factory-mapping-grid";

/**
 * Factory Mapping (production configuration) — BULK-EDIT GRID.
 *
 * Per-option factory instructions, edited like a spreadsheet (owner spec
 * 2026-07-04): every cell is inline-editable, Excel paste fans down, and
 * nothing persists until one "Save mappings" click — same philosophy as
 * /cost-entry. Only dropdown options surface here — text/number/checkbox
 * fields don't have a discrete value set we can map 1:1 (yet).
 *
 * Lives at its OWN route (not under /admin) so any role granted the
 * `factory_mapping.access` capability (Task List Manager, Operations, …)
 * can reach it directly — surfaced in the nav (Task Lists › Factory
 * configuration) via the central config `lib/navigation.ts` (`NAVIGATION`).
 *
 * ACCESS IS CAPABILITY-DRIVEN ONLY. We deliberately do NOT add a
 * `role === "admin"` / `isTechnicalRole(role)` bypass: that would let a
 * role keep access after a super-admin UNCHECKS the capability in the
 * matrix, making the toggle cosmetic. The single check below is the same
 * `factory_mapping.access` key shown in /permissions, enforced again in
 * the server action (`requireCapability`) and in RLS (migration 088).
 */

/**
 * Fetch EVERY row of a query deterministically. The old page did plain
 * unbounded selects on config_field_options / factory_mappings — the exact
 * anti-pattern behind the resolver's historical "missing count oscillates"
 * bug: past the PostgREST row cap you get a silent, NON-DETERMINISTIC subset.
 * Paging by .range() with a stable order guarantees the full set.
 */
async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>
): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    out.push(...batch);
    if (batch.length < PAGE) break;
  }
  return out;
}

export default async function FactoryMappingPage() {
  const allowed = await hasUiCapability("factory_mapping.access");
  if (!allowed) {
    return <AccessDenied capability="factory_mapping.access" />;
  }

  const supabase = createClient();

  const [categories, fields, options, mappings] = await Promise.all([
    fetchAll<any>((from, to) =>
      supabase
        .from("product_categories")
        .select("id, name, position")
        .order("position")
        .order("name")
        .order("id")
        .range(from, to)
    ),
    fetchAll<any>((from, to) =>
      supabase
        .from("config_fields")
        .select(
          "id, category_id, field_name, field_type, field_scope, active, field_order"
        )
        .eq("active", true)
        .eq("field_type", "dropdown")
        .order("field_order")
        .order("id")
        .range(from, to)
    ),
    fetchAll<any>((from, to) =>
      supabase
        .from("config_field_options")
        .select("id, field_id, option_value, option_order")
        .order("option_order")
        .order("id")
        .range(from, to)
    ),
    fetchAll<any>((from, to) =>
      supabase
        .from("factory_mappings")
        .select(
          "id, field_id, option_id, factory_instruction, factory_code, notes, active"
        )
        .order("id")
        .range(from, to)
    ),
  ]);

  // Flatten to grid rows in a stable Category → Field → Option order.
  const optionsByField = new Map<string, any[]>();
  for (const o of options) {
    if (!optionsByField.has(o.field_id)) optionsByField.set(o.field_id, []);
    optionsByField.get(o.field_id)!.push(o);
  }
  const mappingByOption = new Map<string, any>();
  for (const m of mappings) mappingByOption.set(m.option_id, m);
  const fieldsByCategory = new Map<string, any[]>();
  for (const f of fields) {
    if (!fieldsByCategory.has(f.category_id))
      fieldsByCategory.set(f.category_id, []);
    fieldsByCategory.get(f.category_id)!.push(f);
  }

  const rows: MappingGridRow[] = [];
  for (const c of categories) {
    for (const f of fieldsByCategory.get(c.id) ?? []) {
      for (const o of optionsByField.get(f.id) ?? []) {
        const m = mappingByOption.get(o.id) ?? null;
        rows.push({
          categoryId: c.id,
          categoryName: c.name,
          fieldId: f.id,
          fieldName: f.field_name,
          fieldScope: f.field_scope ?? "sales",
          optionId: o.id,
          optionValue: o.option_value,
          instruction: m?.factory_instruction ?? "",
          code: m?.factory_code ?? "",
          hasMapping: !!m,
          notes: m?.notes ?? null,
          active: m?.active ?? true,
        });
      }
    }
  }

  const gridCategories = categories
    .filter((c) => (fieldsByCategory.get(c.id) ?? []).length > 0)
    .map((c) => ({ id: c.id, name: c.name }));

  return (
    <div className="solux-pro">
      <div className="mx-auto max-w-screen-2xl px-6 py-8 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="eyebrow">Production configuration</div>
            <h1 className="doc-title mt-1">Factory mapping</h1>
            <p className="text-xs text-neutral-500 mt-2 max-w-2xl">
              For each sales-facing dropdown option, write the matching factory
              instruction — directly in the grid, like a spreadsheet. Paste
              whole columns from Excel, filter the missing ones, then press
              “Save mappings” once. The task list manager sees these
              auto-resolved on every production task list — and the factory PDF
              includes them in full.
            </p>
          </div>
          <Link href="/task-lists" className="btn-secondary shrink-0">
            ← Task lists
          </Link>
        </div>

        {rows.length === 0 ? (
          <div className="panel p-10 text-center space-y-2">
            <p className="text-sm text-neutral-600">
              No dropdown options to map yet.
            </p>
            <p className="text-xs text-neutral-500">
              Set up your configuration fields first under{" "}
              <Link
                href="/admin/categories"
                className="underline hover:text-neutral-900"
              >
                Admin → Categories
              </Link>
              .
            </p>
          </div>
        ) : (
          <MappingGrid rows={rows} categories={gridCategories} />
        )}
      </div>
    </div>
  );
}
