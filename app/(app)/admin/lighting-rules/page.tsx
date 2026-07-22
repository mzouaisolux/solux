import { createClient } from "@/lib/supabase/server";
import { canAccessOrAdmin } from "@/lib/permissions";
import AccessDenied from "@/components/AccessDenied";
import {
  RULE_OUTCOME_LABELS,
  normalizeRule,
  type ProgrammingRule,
  DEFAULT_OUTCOME,
} from "@/lib/lighting/programming-rules";
import { saveProgrammingRule, deleteProgrammingRule } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Admin → Programming rules (m180) — which product lines require a Lighting
 * Setup. One shared resolver (lib/lighting/programming-rules.ts) drives the
 * task-list UI, the Pre-Validation board, the release gate, exports and AI
 * population — these rules are its single source of truth, never the UI.
 */
export default async function LightingRulesPage() {
  const allowed = await canAccessOrAdmin(["lighting_rules.manage"]);
  if (!allowed) {
    return (
      <AccessDenied message="Programming rules are available to admins and the Task List Manager." />
    );
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("lighting_programming_rules")
    .select("id, outcome, priority, category_id, product_id, sku_pattern, controller, config_match, active, notes")
    .order("priority", { ascending: false });
  const live = !error;
  const rules = ((data ?? []) as unknown[])
    .map(normalizeRule)
    .filter((r): r is ProgrammingRule => r != null);

  const { data: cats } = await supabase
    .from("product_categories")
    .select("id, name")
    .eq("is_template", false)
    .order("name");
  const categories = ((cats ?? []) as any[]).map((c) => ({
    id: c.id as string,
    name: c.name as string,
  }));
  const catName = (id: string | null) =>
    id ? (categories.find((c) => c.id === id)?.name ?? "?") : null;

  const input = "w-full rounded-md border border-neutral-200 px-3 py-2 text-sm";

  return (
    <div className="mx-auto max-w-screen-xl px-6 py-8 space-y-6">
      <div>
        <div className="eyebrow">Admin</div>
        <h1 className="doc-title mt-1">Programming rules</h1>
        <p className="mt-2 max-w-3xl text-xs text-neutral-500">
          Decide which product lines require a <b>Lighting Setup</b> (factory
          programming): <b>Required</b> blocks Final Validation while missing,{" "}
          <b>Optional</b> allows one, <b>Not applicable</b> hides programming
          entirely. Matchers combine with AND; the highest-priority match wins.
          Lines matched by <b>no rule</b> default to{" "}
          <b>{RULE_OUTCOME_LABELS[DEFAULT_OUTCOME]}</b>.
        </p>
        {!live && (
          <p className="mt-3 max-w-3xl rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Editing activates once migration <b>m180</b>{" "}
            (180_line_lighting_and_rules.sql) is applied in Supabase. Until
            then every line uses the default ({RULE_OUTCOME_LABELS[DEFAULT_OUTCOME]}).
          </p>
        )}
      </div>

      {/* New rule */}
      <form action={saveProgrammingRule} className="panel grid grid-cols-1 gap-3 p-4 md:grid-cols-12">
        <label className="block md:col-span-3">
          <span className="eyebrow mb-1 block">Product family</span>
          <select name="category_id" className={input} defaultValue="">
            <option value="">— Any family —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="block md:col-span-2">
          <span className="eyebrow mb-1 block">SKU pattern</span>
          <input name="sku_pattern" placeholder="SSLX* or AOS" className={`${input} font-mono`} />
        </label>
        <label className="block md:col-span-2">
          <span className="eyebrow mb-1 block">Controller</span>
          <input name="controller" placeholder="contains…" className={input} />
        </label>
        <label className="block md:col-span-2">
          <span className="eyebrow mb-1 block">Outcome *</span>
          <select name="outcome" className={input} defaultValue="required">
            {Object.entries(RULE_OUTCOME_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </label>
        <label className="block md:col-span-1">
          <span className="eyebrow mb-1 block">Priority</span>
          <input name="priority" type="number" defaultValue={0} className={input} />
        </label>
        <div className="flex items-end md:col-span-2">
          <button type="submit" className="w-full rounded-md border border-solux bg-solux px-3 py-2 text-sm font-medium text-white hover:bg-solux/90">
            Add rule
          </button>
        </div>
        <label className="block md:col-span-12">
          <span className="eyebrow mb-1 block">Notes</span>
          <input name="notes" placeholder="Why this rule exists" className={input} />
        </label>
      </form>

      {/* Rules */}
      <div className="panel divide-y divide-neutral-100">
        {rules.length === 0 && (
          <p className="px-4 py-6 text-sm text-neutral-500">
            No rules yet — every line currently defaults to{" "}
            {RULE_OUTCOME_LABELS[DEFAULT_OUTCOME]}.
          </p>
        )}
        {rules.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                r.outcome === "required"
                  ? "border-rose-200 bg-rose-50 text-rose-700"
                  : r.outcome === "not_applicable"
                    ? "border-neutral-200 bg-neutral-100 text-neutral-500"
                    : "border-emerald-200 bg-emerald-50 text-emerald-800"
              }`}
            >
              {RULE_OUTCOME_LABELS[r.outcome]}
            </span>
            <span className="text-xs text-neutral-800">
              {[
                catName(r.category_id) && `family ${catName(r.category_id)}`,
                r.sku_pattern && `SKU ~ ${r.sku_pattern}`,
                r.controller && `controller ~ ${r.controller}`,
              ]
                .filter(Boolean)
                .join(" · ") || "(catch-all)"}
            </span>
            <span className="text-[11px] tabular-nums text-neutral-400">prio {r.priority}</span>
            {!r.active && (
              <span className="rounded-full border border-neutral-200 bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500">inactive</span>
            )}
            {r.notes && <span className="text-[11px] text-neutral-500">{r.notes}</span>}
            <form action={deleteProgrammingRule} className="ml-auto">
              <input type="hidden" name="id" value={r.id} />
              <button type="submit" className="text-[11px] text-neutral-400 hover:text-rose-600">
                delete
              </button>
            </form>
          </div>
        ))}
      </div>
    </div>
  );
}
