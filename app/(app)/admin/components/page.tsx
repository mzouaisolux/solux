import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole } from "@/lib/auth";
import { isTechnicalRole } from "@/lib/types";
import {
  normalizeDictionaryItem,
  type DictionaryItem,
} from "@/lib/industrial-dictionary";
import AccessDenied from "@/components/AccessDenied";
import {
  createComponentMapping,
  deleteComponentMapping,
  updateComponentMapping,
} from "./actions";

/**
 * Admin → Industrial dictionary (Product Dictionary, m160).
 *
 * The centralized dictionary of industrial items every module reads: the
 * commercial names (EN/FR) map to the OFFICIAL factory reference, the
 * Chinese factory terminology and the ERP code — those are references,
 * never translations. Compatibility (product families) scopes what the
 * task-list spare-parts selector offers per order. Built on the historical
 * component_mappings table (m012) so existing rows keep working.
 */
export default async function IndustrialDictionaryPage() {
  const { effectiveRole: role } = await getEffectiveRole();
  if (!isTechnicalRole(role)) {
    return (
      <AccessDenied message="The industrial dictionary is available to technical roles only." />
    );
  }

  const supabase = createClient();

  // m160 shape first; pre-migration fall back to the m012 base columns and
  // render the dormant hint on the extended fields.
  const M160_COLS =
    "id, commercial_name, commercial_name_fr, internal_reference, factory_name_cn, erp_code, category, notes, active, compatible_category_ids, compatible_product_ids";
  const BASE_COLS = "id, commercial_name, internal_reference, category, notes, active";
  let m160Live = true;
  let rows: any[] | null = null;
  const full = await supabase
    .from("component_mappings")
    .select(M160_COLS)
    .order("category", { ascending: true, nullsFirst: false })
    .order("commercial_name");
  if (!full.error) {
    rows = full.data as any[] | null;
  } else {
    m160Live = false;
    const base = await supabase
      .from("component_mappings")
      .select(BASE_COLS)
      .order("category", { ascending: true, nullsFirst: false })
      .order("commercial_name");
    rows = base.data as any[] | null;
  }
  const items = ((rows ?? []) as any[])
    .map(normalizeDictionaryItem)
    .filter((d): d is DictionaryItem => d != null);

  const { data: cats } = await supabase
    .from("product_categories")
    .select("id, name")
    .eq("is_template", false)
    .order("name");
  const categories = ((cats ?? []) as any[]).map((c) => ({
    id: c.id as string,
    name: c.name as string,
  }));
  const categoryName = (id: string) =>
    categories.find((c) => c.id === id)?.name ?? "?";

  const grouped = new Map<string, DictionaryItem[]>();
  for (const it of items) {
    const k = it.category ?? "Uncategorized";
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k)!.push(it);
  }

  const input =
    "w-full rounded-md border border-neutral-200 px-3 py-2 text-sm";
  const cellInput =
    "w-full rounded border border-neutral-200 px-2 py-1 text-sm";

  return (
    <div className="mx-auto max-w-screen-2xl px-6 py-8 space-y-6">
      <div>
        <div className="eyebrow">Admin</div>
        <h1 className="doc-title mt-1">Industrial dictionary</h1>
        <p className="text-xs text-neutral-500 mt-2 max-w-3xl">
          The Product Dictionary every module reads. Commercial names (EN/FR)
          map to the <b>official factory reference</b> (e.g.{" "}
          <i>LFP25-65AH-V6</i>), the <b>Chinese factory terminology</b> (e.g.{" "}
          <i>25.6V 65Ah 磷酸铁锂电池</i>) and the <b>ERP code</b> — references,
          never translations. Compatibility scopes what the task-list
          spare-parts selector offers for each order.
        </p>
        {!m160Live && (
          <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 max-w-3xl">
            FR/Chinese names, ERP codes and compatibility activate once
            migration m160 (160_industrial_dictionary.sql) is applied in
            Supabase — until then the base commercial → factory reference
            dictionary keeps working.
          </p>
        )}
      </div>

      {/* New entry */}
      <form
        action={createComponentMapping}
        className="panel p-4 grid grid-cols-1 md:grid-cols-12 gap-3"
      >
        <label className="block md:col-span-3">
          <span className="eyebrow mb-1 block">Commercial name (EN) *</span>
          <input name="commercial_name" placeholder="e.g. Battery 25.6V 65Ah" required className={input} />
        </label>
        <label className="block md:col-span-3">
          <span className="eyebrow mb-1 block">Factory reference *</span>
          <input name="internal_reference" placeholder="e.g. LFP25-65AH-V6" required className={`${input} font-mono`} />
        </label>
        <label className="block md:col-span-3">
          <span className="eyebrow mb-1 block">Part type</span>
          <input name="category" placeholder="battery, controller, led_module…" className={input} />
        </label>
        <div className="md:col-span-3 flex items-end">
          <button className="btn-primary w-full">+ Add to dictionary</button>
        </div>
        {m160Live && (
          <>
            <label className="block md:col-span-3">
              <span className="eyebrow mb-1 block">Commercial name (FR)</span>
              <input name="commercial_name_fr" placeholder="e.g. Batterie 25.6V 65Ah" className={input} />
            </label>
            <label className="block md:col-span-3">
              <span className="eyebrow mb-1 block">Factory name (中文)</span>
              <input name="factory_name_cn" placeholder="e.g. 25.6V 65Ah 磷酸铁锂电池" className={input} />
            </label>
            <label className="block md:col-span-2">
              <span className="eyebrow mb-1 block">ERP code</span>
              <input name="erp_code" placeholder="ERP code" className={`${input} font-mono`} />
            </label>
            <label className="block md:col-span-4">
              <span className="eyebrow mb-1 block">Compatible families (⌘/Ctrl-click)</span>
              <select
                name="compatible_category_ids"
                multiple
                size={3}
                className={input}
                title="Empty = generic (offered for every family)"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
          </>
        )}
        <label className="block md:col-span-12">
          <span className="eyebrow mb-1 block">Notes (optional)</span>
          <input name="notes" placeholder="Spec sheet link, vendor info, production notes…" className={input} />
        </label>
      </form>

      {/* List grouped by part type */}
      {grouped.size === 0 ? (
        <div className="panel p-10 text-center text-sm text-neutral-500">
          The dictionary is empty. Add your first industrial items above —
          start with the spare parts you ship most often.
        </div>
      ) : (
        <div className="space-y-6">
          {Array.from(grouped.entries()).map(([cat, list]) => (
            <section key={cat} className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-widerx text-neutral-700">
                {cat}{" "}
                <span className="text-xs font-normal text-neutral-500 normal-case tracking-normal">
                  ({list.length})
                </span>
              </h2>
              <div className="space-y-2">
                {list.map((it) => (
                  <div key={it.id} className="panel p-3">
                    <form
                      action={updateComponentMapping}
                      className="grid grid-cols-1 md:grid-cols-12 gap-2"
                    >
                      <input type="hidden" name="id" value={it.id} />
                      <input type="hidden" name="category" value={it.category ?? ""} />
                      <label className="block md:col-span-3">
                        <span className="text-[10px] uppercase tracking-wider text-neutral-500">Commercial (EN)</span>
                        <input name="commercial_name" defaultValue={it.commercial_name} className={cellInput} />
                      </label>
                      <label className="block md:col-span-3">
                        <span className="text-[10px] uppercase tracking-wider text-neutral-500">Factory reference</span>
                        <input name="internal_reference" defaultValue={it.internal_reference} className={`${cellInput} font-mono text-[13px]`} />
                      </label>
                      {m160Live && (
                        <>
                          <label className="block md:col-span-3">
                            <span className="text-[10px] uppercase tracking-wider text-neutral-500">Commercial (FR)</span>
                            <input name="commercial_name_fr" defaultValue={it.commercial_name_fr ?? ""} className={cellInput} />
                          </label>
                          <label className="block md:col-span-3">
                            <span className="text-[10px] uppercase tracking-wider text-neutral-500">Factory name (中文)</span>
                            <input name="factory_name_cn" defaultValue={it.factory_name_cn ?? ""} className={cellInput} />
                          </label>
                          <label className="block md:col-span-2">
                            <span className="text-[10px] uppercase tracking-wider text-neutral-500">ERP code</span>
                            <input name="erp_code" defaultValue={it.erp_code ?? ""} className={`${cellInput} font-mono text-[13px]`} />
                          </label>
                          <label className="block md:col-span-4">
                            <span className="text-[10px] uppercase tracking-wider text-neutral-500">
                              Compatible families — current:{" "}
                              {it.compatible_category_ids.length === 0
                                ? "generic (all)"
                                : it.compatible_category_ids.map(categoryName).join(", ")}
                            </span>
                            <select
                              name="compatible_category_ids"
                              multiple
                              size={3}
                              defaultValue={it.compatible_category_ids}
                              className={cellInput}
                            >
                              {categories.map((c) => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                              ))}
                            </select>
                          </label>
                        </>
                      )}
                      <label className="block md:col-span-4">
                        <span className="text-[10px] uppercase tracking-wider text-neutral-500">Notes</span>
                        <input name="notes" defaultValue={it.notes ?? ""} className={cellInput} />
                      </label>
                      <label className="inline-flex items-center gap-1.5 md:col-span-1 text-xs text-neutral-600 pt-4">
                        <input type="checkbox" name="active" defaultChecked={it.active} className="h-4 w-4 rounded border-neutral-300" />
                        Active
                      </label>
                      <div className="md:col-span-1 flex items-end justify-end">
                        <button type="submit" className="text-xs font-medium text-solux hover:underline">
                          Save
                        </button>
                      </div>
                    </form>
                    <form action={deleteComponentMapping} className="mt-1 text-right">
                      <input type="hidden" name="id" value={it.id} />
                      <button className="text-[11px] text-red-600 hover:underline">Delete</button>
                    </form>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
