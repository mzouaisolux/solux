import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole } from "@/lib/auth";
import { isTechnicalRole, type ComponentMapping } from "@/lib/types";
import AccessDenied from "@/components/AccessDenied";
import {
  createComponentMapping,
  deleteComponentMapping,
  updateComponentMapping,
} from "./actions";

/**
 * Admin → Component mappings.
 *
 * Dictionary of commercial → internal factory references that the task
 * list manager uses to translate simplified sales references into real
 * production references when enriching task lists.
 */
export default async function ComponentMappingsPage() {
  // Technical-role tool (admin / super_admin / task_list_manager /
  // operations). Access Denied (not a silent redirect) on miss.
  const { effectiveRole: role } = await getEffectiveRole();
  if (!isTechnicalRole(role)) {
    return (
      <AccessDenied message="Component mappings are available to technical roles only." />
    );
  }

  const supabase = createClient();
  const { data: mappings } = await supabase
    .from("component_mappings")
    .select("id, commercial_name, internal_reference, category, notes, active")
    .order("category", { ascending: true, nullsFirst: false })
    .order("commercial_name");

  const grouped = new Map<string, ComponentMapping[]>();
  for (const m of (mappings ?? []) as ComponentMapping[]) {
    const k = m.category ?? "Uncategorized";
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k)!.push(m);
  }

  return (
    <div className="mx-auto max-w-screen-2xl px-6 py-8 space-y-6">
      <div>
        <div className="eyebrow">Admin</div>
        <h1 className="doc-title mt-1">Component mappings</h1>
        <p className="text-xs text-neutral-500 mt-2 max-w-2xl">
          Translate simplified sales references (e.g. <i>"18RH battery"</i>)
          into the real factory part numbers (e.g.{" "}
          <i>"LFP-18RH-32700-G2W"</i>). The task list manager uses this
          dictionary while enriching task lists during technical review.
        </p>
      </div>

      {/* New mapping */}
      <form
        action={createComponentMapping}
        className="panel p-4 grid grid-cols-1 md:grid-cols-12 gap-3"
      >
        <label className="block md:col-span-4">
          <span className="eyebrow mb-1 block">Commercial name *</span>
          <input
            name="commercial_name"
            placeholder="e.g. 18RH battery"
            required
            className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm"
          />
        </label>
        <label className="block md:col-span-4">
          <span className="eyebrow mb-1 block">Internal reference *</span>
          <input
            name="internal_reference"
            placeholder="e.g. LFP-18RH-32700-G2W"
            required
            className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm font-mono"
          />
        </label>
        <label className="block md:col-span-3">
          <span className="eyebrow mb-1 block">Category</span>
          <input
            name="category"
            placeholder="battery, panel, controller…"
            className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm"
          />
        </label>
        <div className="md:col-span-1 flex items-end">
          <button className="btn-primary w-full">+ Add</button>
        </div>
        <label className="block md:col-span-12">
          <span className="eyebrow mb-1 block">Notes (optional)</span>
          <input
            name="notes"
            placeholder="Spec sheet link, vendor info, etc."
            className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm"
          />
        </label>
      </form>

      {/* List grouped by category */}
      {grouped.size === 0 ? (
        <div className="panel p-10 text-center text-sm text-neutral-500">
          No component mappings yet. Add your first one above — start with
          the components you use most often.
        </div>
      ) : (
        <div className="space-y-6">
          {Array.from(grouped.entries()).map(([cat, items]) => (
            <section key={cat} className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-widerx text-neutral-700">
                {cat}{" "}
                <span className="text-xs font-normal text-neutral-500 normal-case tracking-normal">
                  ({items.length})
                </span>
              </h2>
              <div className="panel overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-solux-accent text-left">
                      <th className="px-3 py-2 font-semibold text-xs uppercase tracking-widerx text-neutral-700">
                        Commercial
                      </th>
                      <th className="px-3 py-2 font-semibold text-xs uppercase tracking-widerx text-neutral-700">
                        Internal
                      </th>
                      <th className="px-3 py-2 font-semibold text-xs uppercase tracking-widerx text-neutral-700">
                        Notes
                      </th>
                      <th className="px-3 py-2 font-semibold text-xs uppercase tracking-widerx text-neutral-700 text-center">
                        Active
                      </th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((m) => (
                      <tr key={m.id} className="border-t border-neutral-100">
                        <td className="px-3 py-2 align-top">
                          <form
                            action={updateComponentMapping}
                            className="space-y-1.5"
                          >
                            <input type="hidden" name="id" value={m.id} />
                            <input type="hidden" name="category" value={m.category ?? ""} />
                            <input
                              name="commercial_name"
                              defaultValue={m.commercial_name}
                              className="w-full rounded border border-neutral-200 px-2 py-1 text-sm"
                            />
                            <input
                              name="internal_reference"
                              defaultValue={m.internal_reference}
                              className="hidden"
                            />
                            <input
                              name="notes"
                              defaultValue={m.notes ?? ""}
                              className="hidden"
                            />
                            {m.active && (
                              <input type="hidden" name="active" value="on" />
                            )}
                            <button
                              type="submit"
                              className="text-[11px] text-neutral-500 hover:text-neutral-900"
                            >
                              Save row
                            </button>
                          </form>
                        </td>
                        <td className="px-3 py-2 font-mono text-[13px] text-neutral-800 align-top">
                          {m.internal_reference}
                        </td>
                        <td className="px-3 py-2 text-xs text-neutral-500 align-top">
                          {m.notes ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-center align-top">
                          <span
                            className={`inline-block h-2 w-2 rounded-full ${
                              m.active ? "bg-emerald-500" : "bg-neutral-300"
                            }`}
                          />
                        </td>
                        <td className="px-3 py-2 text-right align-top">
                          <form action={deleteComponentMapping}>
                            <input type="hidden" name="id" value={m.id} />
                            <button className="text-xs text-red-600 hover:underline">
                              Delete
                            </button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
