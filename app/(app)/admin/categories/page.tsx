import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  createCategory,
  duplicateCategory,
  saveAsTemplate,
  unmarkTemplate,
  createFromTemplate,
} from "./actions";
import { getEffectiveRole } from "@/lib/auth";
import { isAdminLike } from "@/lib/types";
import AccessDenied from "@/components/AccessDenied";

export default async function CategoriesPage() {
  // Master data — admin-only. Access Denied (not a silent redirect) on miss.
  const { effectiveRole } = await getEffectiveRole();
  if (!isAdminLike(effectiveRole)) {
    return (
      <AccessDenied
        title="Administrators only"
        message="Master-data management is restricted to administrators."
      />
    );
  }

  const supabase = createClient();
  const [{ data: allCategories }, { data: productCounts }, { data: fields }] =
    await Promise.all([
      supabase
        .from("product_categories")
        .select("id, name, position, is_template")
        .order("position")
        .order("name"),
      supabase.from("products").select("category_id").eq("active", true),
      supabase
        .from("config_fields")
        .select("category_id")
        .eq("active", true),
    ]);

  const categories = (allCategories ?? []).filter((c) => !(c as any).is_template);
  const templates = (allCategories ?? []).filter((c) => !!(c as any).is_template);

  const countsByCategory = new Map<string, number>();
  for (const p of productCounts ?? []) {
    if (!p.category_id) continue;
    countsByCategory.set(
      p.category_id,
      (countsByCategory.get(p.category_id) ?? 0) + 1
    );
  }
  const fieldsByCategory = new Map<string, number>();
  for (const f of fields ?? []) {
    if (!f.category_id) continue;
    fieldsByCategory.set(
      f.category_id,
      (fieldsByCategory.get(f.category_id) ?? 0) + 1
    );
  }

  return (
    <div className="mx-auto max-w-screen-2xl px-6 py-8 space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <div className="eyebrow">Admin</div>
          <h1 className="doc-title mt-1">Product categories</h1>
          <p className="text-xs text-neutral-500 mt-2 max-w-xl">
            Every product belongs to a category — e.g. <i>All in one</i>,{" "}
            <i>Split solar street light</i>, <i>Solar column</i>, <i>Bollard</i>.
            Each category owns a set of configurable technical fields that
            sales users fill out on the quotation and the factory sees on the
            production task list.
          </p>
        </div>
      </div>

      {/* ── Create new category ─────────────────────────────────────── */}
      <form
        action={createCategory}
        className="panel p-4 flex flex-wrap items-end gap-3"
      >
        <label className="flex-1 min-w-[220px]">
          <span className="eyebrow mb-1 block">Category name</span>
          <input
            name="name"
            placeholder="e.g. Solar column"
            required
            className="w-full rounded-md border border-neutral-200 px-3 py-2"
          />
        </label>
        <label className="w-32">
          <span className="eyebrow mb-1 block">Order</span>
          <input
            name="position"
            type="number"
            min={0}
            defaultValue={0}
            className="w-full rounded-md border border-neutral-200 px-3 py-2 tabular-nums"
          />
        </label>
        <button className="btn-primary">+ Add category</button>
      </form>

      {/* ── Create from template ─────────────────────────────────────── */}
      {templates.length > 0 && (
        <section className="panel p-4 space-y-3">
          <div>
            <h2 className="text-base font-semibold">Create from template</h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              Pick a template, give the new category a name, and all fields +
              options are copied instantly. The new category is fully
              independent — editing it later never affects the template.
            </p>
          </div>
          <form
            action={createFromTemplate}
            className="flex flex-wrap items-end gap-3"
          >
            <label className="flex-1 min-w-[200px]">
              <span className="eyebrow mb-1 block">Template</span>
              <select
                name="template_id"
                required
                defaultValue=""
                className="w-full rounded-md border border-neutral-200 px-3 py-2"
              >
                <option value="" disabled>
                  — choose a template —
                </option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {" · "}
                    {fieldsByCategory.get(t.id) ?? 0} fields
                  </option>
                ))}
              </select>
            </label>
            <label className="flex-1 min-w-[200px]">
              <span className="eyebrow mb-1 block">New category name</span>
              <input
                name="name"
                required
                placeholder="e.g. AOSPRO+"
                className="w-full rounded-md border border-neutral-200 px-3 py-2"
              />
            </label>
            <button className="btn-primary">Create from template →</button>
          </form>
        </section>
      )}

      {/* ── Categories table ─────────────────────────────────────────── */}
      <div className="panel overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-solux-accent text-left">
              <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-widerx text-neutral-700">
                Category
              </th>
              <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-widerx text-neutral-700 text-right">
                Products
              </th>
              <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-widerx text-neutral-700 text-right">
                Fields
              </th>
              <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-widerx text-neutral-700 text-right">
                Order
              </th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => (
              <tr
                key={c.id}
                className="border-t border-neutral-100 hover:bg-neutral-50/70"
              >
                <td className="px-4 py-3 font-medium">{c.name}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {countsByCategory.get(c.id) ?? 0}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {fieldsByCategory.get(c.id) ?? 0}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-neutral-500">
                  {c.position}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex items-center gap-3">
                    {/* Duplicate */}
                    <form action={duplicateCategory} className="inline">
                      <input type="hidden" name="id" value={c.id} />
                      <button
                        type="submit"
                        className="text-xs text-neutral-600 hover:text-neutral-900 hover:underline"
                        title="Duplicate this category with all its fields and options"
                      >
                        Duplicate
                      </button>
                    </form>
                    {/* Save as template */}
                    <form action={saveAsTemplate} className="inline">
                      <input type="hidden" name="id" value={c.id} />
                      <button
                        type="submit"
                        className="text-xs text-neutral-600 hover:text-neutral-900 hover:underline"
                        title="Save this category as a reusable template"
                      >
                        Save as template
                      </button>
                    </form>
                    <Link href={`/admin/categories/${c.id}`} className="row-link">
                      Configure →
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
            {categories.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-12 text-center text-neutral-500 text-sm"
                >
                  No categories yet. Add your first one above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Templates section ────────────────────────────────────────── */}
      {templates.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-base font-semibold">Templates</h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              Templates are reusable field structures. They don&apos;t appear in
              product dropdowns — use them to spin up new categories instantly.
            </p>
          </div>
          <div className="panel overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-solux-accent text-left">
                  <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-widerx text-neutral-700">
                    Template
                  </th>
                  <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-widerx text-neutral-700 text-right">
                    Fields
                  </th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr
                    key={t.id}
                    className="border-t border-neutral-100 hover:bg-neutral-50/70"
                  >
                    <td className="px-4 py-3 font-medium">{t.name}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {fieldsByCategory.get(t.id) ?? 0}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-3">
                        {/* Duplicate template */}
                        <form action={duplicateCategory} className="inline">
                          <input type="hidden" name="id" value={t.id} />
                          <button
                            type="submit"
                            className="text-xs text-neutral-600 hover:text-neutral-900 hover:underline"
                            title="Create a copy of this template"
                          >
                            Duplicate
                          </button>
                        </form>
                        {/* Convert back to regular category */}
                        <form action={unmarkTemplate} className="inline">
                          <input type="hidden" name="id" value={t.id} />
                          <button
                            type="submit"
                            className="text-xs text-neutral-600 hover:text-neutral-900 hover:underline"
                            title="Convert this template back into a regular category"
                          >
                            Use as category
                          </button>
                        </form>
                        <Link href={`/admin/categories/${t.id}`} className="row-link">
                          Edit template →
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
