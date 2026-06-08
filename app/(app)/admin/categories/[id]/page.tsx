import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { renameCategory } from "../actions";
import DeleteCategoryControl from "./DeleteCategoryControl";
import { FieldCard, NewFieldForm } from "./FieldEditor";
import {
  CONFIG_FIELD_TYPE_ICON,
  CONFIG_FIELD_TYPE_LABEL,
  type ConfigField,
  type ConfigFieldOption,
} from "@/lib/types";
import { naturalProductSort } from "@/lib/product-sort";

export default async function CategoryDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createClient();
  const [{ data: category }, { data: fields }, { data: opts }, { data: products }, { data: otherCats }] =
    await Promise.all([
      supabase
        .from("product_categories")
        .select("id, name, position")
        .eq("id", params.id)
        .maybeSingle(),
      supabase
        .from("config_fields")
        .select(
          "id, category_id, field_name, field_type, required, required_for_production, default_value, placeholder, field_order, visible_in_quotation, visible_in_task_list, visible_in_factory, internal_only, access_level, allow_custom_value, field_scope, active"
        )
        .eq("category_id", params.id)
        .order("field_order")
        .order("field_name"),
      supabase
        .from("config_field_options")
        .select("id, field_id, option_value, option_order")
        .order("option_order")
        .order("option_value"),
      supabase
        .from("products")
        .select("id, name, sku")
        .eq("category_id", params.id)
        .eq("active", true)
        .order("name"),
      supabase
        .from("product_categories")
        .select("id, name")
        .eq("is_template", false)
        .neq("id", params.id)
        .order("position")
        .order("name"),
    ]);

  if (!category) notFound();

  // Show the category's products in natural business order (model asc, standard
  // before IoT) to match the cost file and the pricing tables.
  products?.sort(naturalProductSort);

  const optionsByField = new Map<string, ConfigFieldOption[]>();
  for (const o of opts ?? []) {
    if (!optionsByField.has(o.field_id))
      optionsByField.set(o.field_id, []);
    optionsByField.get(o.field_id)!.push(o as ConfigFieldOption);
  }

  const fieldList = (fields ?? []) as ConfigField[];
  const hasFields = fieldList.length > 0;
  const startingOrder = fieldList.length * 10;

  return (
    <div className="mx-auto max-w-screen-2xl px-6 py-8 space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="eyebrow">Product category</div>
          <h1 className="doc-title mt-1">{category.name}</h1>
          <p className="text-xs text-neutral-500 mt-2 max-w-xl">
            Configuration fields below apply to every product assigned to this
            category. Visibility flags control whether each field is shown on
            the customer quotation, the internal production task list, or
            both.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/categories" className="btn-secondary">
            ← All categories
          </Link>
        </div>
      </div>

      {/* Category settings */}
      <section className="panel p-4">
        <form
          action={renameCategory}
          className="flex flex-wrap items-end gap-3"
        >
          <input type="hidden" name="id" value={category.id} />
          <label className="flex-1 min-w-[220px]">
            <span className="eyebrow mb-1 block">Category name</span>
            <input
              name="name"
              defaultValue={category.name}
              required
              className="w-full rounded-md border border-neutral-200 px-3 py-2"
            />
          </label>
          <label className="w-28">
            <span className="eyebrow mb-1 block">Order</span>
            <input
              name="position"
              type="number"
              defaultValue={category.position}
              className="w-full rounded-md border border-neutral-200 px-3 py-2 tabular-nums"
            />
          </label>
          <button type="submit" className="btn-primary">Save</button>
        </form>
        {products && products.length > 0 && (
          <div className="mt-3 border-t border-neutral-100 pt-3 text-xs text-neutral-500">
            <span className="eyebrow mr-2">
              Used by {products.length} product
              {products.length === 1 ? "" : "s"}
            </span>
            <span className="text-neutral-600">
              {products
                .slice(0, 6)
                .map((p: any) => p.sku || p.name)
                .join(" · ")}
              {products.length > 6 && ` · +${products.length - 6} more`}
            </span>
          </div>
        )}
        <div className="mt-4 border-t border-neutral-100 pt-3">
          <DeleteCategoryControl
            categoryId={category.id}
            categoryName={category.name}
            productCount={products?.length ?? 0}
            otherCategories={(otherCats ?? []) as Array<{ id: string; name: string }>}
          />
        </div>
      </section>

      {/* Fields section heading — full width, compact */}
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            Fields ({fieldList.length})
          </h2>
          <p className="text-xs text-neutral-500 max-w-xl">
            Sales users see these on the quotation builder for any product in
            this category; the factory sees them on the production task list
            (per your visibility flags).
          </p>
        </div>
      </div>

      {/*
        When there are NO fields yet: full-width column for breathing room.
        When fields exist: 2-col grid — wide editor + compact sticky index.
      */}
      {!hasFields ? (
        <section className="space-y-4">
          <NewFieldForm categoryId={category.id} startingOrder={startingOrder} />
          <div className="panel p-10 text-center space-y-2">
            <p className="text-sm text-neutral-600">
              No configuration fields yet.
            </p>
            <p className="text-xs text-neutral-500">
              Add your first field above — e.g. <i>Battery type</i> (Dropdown)
              or <i>Laser logo</i> (Yes / No).
            </p>
          </div>
        </section>
      ) : (
        <section className="grid gap-6 lg:grid-cols-[1fr_220px]">
          <div className="space-y-4 min-w-0">
            <NewFieldForm
              categoryId={category.id}
              startingOrder={startingOrder}
            />
            {fieldList.map((f) => (
              <div
                key={f.id}
                id={`field-${f.id}`}
                className="scroll-mt-24"
              >
                <FieldCard
                  field={f}
                  options={optionsByField.get(f.id) ?? []}
                  categoryId={category.id}
                />
              </div>
            ))}
          </div>

          <aside className="hidden lg:block lg:sticky lg:top-20 lg:self-start">
            <div className="panel p-3 space-y-2">
              <div className="eyebrow px-1">In this category</div>
              <ul className="space-y-0.5">
                {fieldList.map((f) => (
                  <li key={f.id}>
                    <a
                      href={`#field-${f.id}`}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-neutral-100 transition"
                      title={CONFIG_FIELD_TYPE_LABEL[f.field_type]}
                    >
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-neutral-100 text-[11px] font-semibold text-neutral-700 shrink-0">
                        {CONFIG_FIELD_TYPE_ICON[f.field_type]}
                      </span>
                      <span className="truncate flex-1 text-neutral-700 group-hover:text-neutral-900">
                        {f.field_name}
                      </span>
                      {f.internal_only && (
                        <span
                          className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0"
                          title="Internal only"
                        />
                      )}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </section>
      )}
    </div>
  );
}
