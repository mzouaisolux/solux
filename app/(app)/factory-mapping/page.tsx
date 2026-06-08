import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { hasUiCapability } from "@/lib/permissions";
import { type FactoryMapping } from "@/lib/types";
import AccessDenied from "@/components/AccessDenied";
import MappingRow from "./MappingRow";

/**
 * Factory Mapping (production configuration).
 *
 * Per-option factory instructions. Only dropdown options surface here —
 * text/number/checkbox fields don't have a discrete value set we can map
 * 1:1 (yet).
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
 * the server actions (`requireCapability`) and in RLS (migration 088).
 */
export default async function FactoryMappingPage() {
  const allowed = await hasUiCapability("factory_mapping.access");
  if (!allowed) {
    return <AccessDenied capability="factory_mapping.access" />;
  }

  const supabase = createClient();

  // Pull every dropdown field on every category, plus the option list, plus
  // any existing mappings. Three round-trips kept independent so a missing
  // mapping doesn't break the rest.
  const [
    { data: categories },
    { data: fields },
    { data: options },
    { data: mappings },
  ] = await Promise.all([
    supabase
      .from("product_categories")
      .select("id, name, position")
      .order("position")
      .order("name"),
    supabase
      .from("config_fields")
      .select("id, category_id, field_name, field_type, field_scope, active, field_order")
      .eq("active", true)
      .eq("field_type", "dropdown")
      .order("field_order"),
    supabase
      .from("config_field_options")
      .select("id, field_id, option_value, option_order")
      .order("option_order"),
    supabase
      .from("factory_mappings")
      .select(
        "id, field_id, option_id, factory_instruction, factory_code, notes, active"
      ),
  ]);

  const optionsByField = new Map<string, typeof options>();
  for (const o of options ?? []) {
    if (!optionsByField.has(o.field_id))
      optionsByField.set(o.field_id, [] as any);
    optionsByField.get(o.field_id)!.push(o as any);
  }
  const mappingByOption = new Map<string, FactoryMapping>();
  for (const m of (mappings ?? []) as FactoryMapping[]) {
    mappingByOption.set(m.option_id, m);
  }
  const fieldsByCategory = new Map<string, any[]>();
  for (const f of fields ?? []) {
    if (!fieldsByCategory.has(f.category_id))
      fieldsByCategory.set(f.category_id, []);
    fieldsByCategory.get(f.category_id)!.push(f);
  }

  // Top-level counters for the summary banner.
  let totalOptions = 0;
  let missingMappings = 0;
  for (const f of fields ?? []) {
    const opts = optionsByField.get(f.id) ?? [];
    for (const o of opts as any[]) {
      totalOptions++;
      if (!mappingByOption.has(o.id)) missingMappings++;
    }
  }

  return (
    <div className="mx-auto max-w-screen-2xl px-6 py-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="eyebrow">Production configuration</div>
          <h1 className="doc-title mt-1">Factory mapping</h1>
          <p className="text-xs text-neutral-500 mt-2 max-w-2xl">
            For each sales-facing dropdown option, write the matching factory
            instruction. The task list manager sees these auto-resolved on
            every production task list — and the factory PDF includes them in
            full. Configure once, reuse everywhere.
          </p>
        </div>
        <Link href="/task-lists" className="btn-secondary shrink-0">
          ← Task lists
        </Link>
      </div>

      {/* Coverage summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="panel p-4">
          <div className="eyebrow">Dropdown options</div>
          <div className="text-2xl font-semibold mt-1 tabular-nums">
            {totalOptions}
          </div>
        </div>
        <div className="panel p-4">
          <div className="eyebrow">Mapped</div>
          <div className="text-2xl font-semibold mt-1 tabular-nums text-emerald-700">
            {totalOptions - missingMappings}
          </div>
        </div>
        <div className="panel p-4">
          <div className="eyebrow">Missing</div>
          <div
            className={`text-2xl font-semibold mt-1 tabular-nums ${
              missingMappings > 0 ? "text-amber-700" : "text-neutral-500"
            }`}
          >
            {missingMappings}
          </div>
        </div>
      </div>

      {totalOptions === 0 && (
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
      )}

      {/* Grouped: Category → Field → Options with their mappings */}
      <div className="space-y-6">
        {(categories ?? []).map((c) => {
          const catFields = fieldsByCategory.get(c.id) ?? [];
          if (catFields.length === 0) return null;
          return (
            <section key={c.id} className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-widerx text-neutral-700">
                {c.name}
              </h2>
              {catFields.map((f: any) => {
                const opts = (optionsByField.get(f.id) ?? []) as any[];
                if (opts.length === 0) return null;
                return (
                  <div key={f.id} className="panel overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2.5 bg-solux-accent">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-neutral-800">
                          {f.field_name}
                        </h3>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            (f.field_scope ?? "sales") === "technical"
                              ? "bg-amber-100 text-amber-900"
                              : "bg-sky-100 text-sky-900"
                          }`}
                        >
                          {(f.field_scope ?? "sales") === "technical"
                            ? "Technical"
                            : "Sales"}
                        </span>
                      </div>
                      <span className="text-[11px] text-neutral-500 tabular-nums">
                        {opts.length} option{opts.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    {opts.map((o) => (
                      <MappingRow
                        key={o.id}
                        fieldId={f.id}
                        optionId={o.id}
                        optionValue={o.option_value}
                        mapping={mappingByOption.get(o.id) ?? null}
                      />
                    ))}
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}
