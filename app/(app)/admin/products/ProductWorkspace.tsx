"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ProductGrid from "./grid/ProductGrid";
import { createCategoryReturning } from "../categories/actions";
import DeleteCategoryControl from "../categories/[id]/DeleteCategoryControl";

const ALL = "__all__";
const UNCAT = "__uncat__";

type Cat = {
  id: string;
  name: string;
  position: number;
  productCount: number;
  fieldCount: number;
};
type ProductLite = {
  id: string;
  name: string;
  sku: string | null;
  category_id: string | null;
  image_url: string | null;
  active: boolean | null;
};

/**
 * Unified Product Catalog workspace — categories AND products on one screen.
 * Top: a compact, selectable categories table + inline "Add Category" (no
 * navigation). Bottom: the existing product grid, filtered to the selected
 * category. Creating a category auto-selects it so the user can start adding
 * products immediately. Reuses ProductGrid wholesale (controlled selection).
 */
export default function ProductWorkspace({
  categories,
  products,
  uncategorizedCount,
}: {
  categories: Cat[];
  products: ProductLite[];
  uncategorizedCount: number;
}) {
  const router = useRouter();
  const [selectedCat, setSelectedCat] = useState<string>(categories[0]?.id ?? ALL);
  // Which category row has its inline delete panel open (one at a time).
  const [deleteCatId, setDeleteCatId] = useState<string | null>(null);

  // Inline add-category form state.
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [order, setOrder] = useState("");
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function addCategory() {
    if (!name.trim()) return;
    setErr(null);
    startTransition(async () => {
      try {
        const res = await createCategoryReturning(name.trim(), Number(order) || 0);
        setName("");
        setOrder("");
        setShowAdd(false);
        if (res?.id) setSelectedCat(res.id); // auto-select the new category
        router.refresh(); // pull the new category + counts (soft, keeps state)
      } catch (e: any) {
        if (!String(e?.message ?? "").includes("NEXT_REDIRECT")) {
          setErr(e?.message ?? "Could not create the category.");
        }
      }
    });
  }

  const totalProducts = products.length;
  const selected = categories.find((c) => c.id === selectedCat) ?? null;
  const selectedName =
    selectedCat === ALL
      ? "All categories"
      : selectedCat === UNCAT
        ? "Uncategorized"
        : selected?.name ?? "—";
  const selectedCount =
    selectedCat === ALL
      ? totalProducts
      : selectedCat === UNCAT
        ? uncategorizedCount
        : selected?.productCount ?? 0;

  const rowCls = (active: boolean) =>
    `cursor-pointer border-t border-neutral-100 ${
      active ? "bg-sky-50/70" : "hover:bg-neutral-50/70"
    }`;

  return (
    <div className="space-y-6">
      {/* ───────── CATEGORIES (top) ───────── */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="eyebrow">Categories</div>
          <div className="flex items-center gap-3">
            <Link
              href="/admin/categories"
              className="text-xs text-neutral-400 hover:text-neutral-700 hover:underline"
              title="Templates & advanced category tools"
            >
              Templates &amp; advanced →
            </Link>
            <button onClick={() => setShowAdd((v) => !v)} className="btn-secondary text-sm">
              + Add Category
            </button>
          </div>
        </div>

        {showAdd && (
          <div className="flex flex-wrap items-end gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-3">
            <label className="block">
              <span className="text-[11px] text-neutral-500">Category name</span>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addCategory();
                  if (e.key === "Escape") setShowAdd(false);
                }}
                placeholder="e.g. AOSPRO+"
                className="mt-0.5 block w-56 rounded border px-2 py-1 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-[11px] text-neutral-500">Order</span>
              <input
                value={order}
                onChange={(e) => setOrder(e.target.value)}
                type="number"
                min={0}
                placeholder="0"
                className="mt-0.5 block w-20 rounded border px-2 py-1 text-sm tabular-nums"
              />
            </label>
            <button
              onClick={addCategory}
              disabled={pending || !name.trim()}
              className="btn-primary text-sm disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => {
                setShowAdd(false);
                setName("");
                setOrder("");
                setErr(null);
              }}
              className="text-sm text-neutral-500 hover:underline"
            >
              Cancel
            </button>
            {err && <span className="text-sm text-rose-700">{err}</span>}
          </div>
        )}

        <div className="panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-solux-accent text-left">
                <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-widerx text-neutral-700">
                  Category
                </th>
                <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-widerx text-neutral-700 text-right">
                  Products
                </th>
                <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-widerx text-neutral-700 text-right">
                  Fields
                </th>
                <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-widerx text-neutral-700 text-right">
                  Order
                </th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {/* All categories */}
              <tr className={rowCls(selectedCat === ALL)} onClick={() => setSelectedCat(ALL)}>
                <td className="px-4 py-2.5 font-medium text-neutral-700">All categories</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{totalProducts}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-neutral-300">—</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-neutral-300">—</td>
                <td className="px-4 py-2.5"></td>
              </tr>

              {categories.map((c) => (
                <Fragment key={c.id}>
                  <tr className={rowCls(selectedCat === c.id)} onClick={() => setSelectedCat(c.id)}>
                    <td className="px-4 py-2.5 font-medium">{c.name}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{c.productCount}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{c.fieldCount}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-neutral-500">{c.position}</td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="inline-flex items-center gap-3">
                        <Link
                          href={`/admin/categories/${c.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="row-link text-xs"
                        >
                          Edit →
                        </Link>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteCatId((cur) => (cur === c.id ? null : c.id));
                          }}
                          className="text-xs text-rose-600 hover:underline"
                        >
                          {deleteCatId === c.id ? "Close" : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {deleteCatId === c.id && (
                    <tr className="border-t border-rose-100 bg-rose-50/30">
                      <td colSpan={5} className="px-4 py-3">
                        <DeleteCategoryControl
                          startOpen
                          categoryId={c.id}
                          categoryName={c.name}
                          productCount={c.productCount}
                          otherCategories={categories
                            .filter((x) => x.id !== c.id)
                            .map((x) => ({ id: x.id, name: x.name }))}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}

              {uncategorizedCount > 0 && (
                <tr className={rowCls(selectedCat === UNCAT)} onClick={() => setSelectedCat(UNCAT)}>
                  <td className="px-4 py-2.5 font-medium text-neutral-500">Uncategorized</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{uncategorizedCount}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-neutral-300">—</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-neutral-300">—</td>
                  <td className="px-4 py-2.5"></td>
                </tr>
              )}

              {categories.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-neutral-500">
                    No categories yet — add your first one above, then start adding products.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ───────── PRODUCTS (bottom) ───────── */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <div className="eyebrow">Products</div>
          <span className="text-sm text-neutral-500">
            — <span className="font-semibold text-neutral-700">{selectedName}</span>{" "}
            <span className="text-neutral-400">
              ({selectedCount} product{selectedCount === 1 ? "" : "s"})
            </span>
          </span>
        </div>
        <ProductGrid
          initialProducts={products as any}
          categories={categories.map((c) => ({ id: c.id, name: c.name }))}
          initialCategoryId={selectedCat}
          categoryControl={{ selected: selectedCat, onSelect: setSelectedCat }}
        />
      </section>
    </div>
  );
}
