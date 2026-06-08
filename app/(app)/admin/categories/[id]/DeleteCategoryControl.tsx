"use client";

import { useState, useTransition } from "react";
import { deleteCategory } from "../actions";

/**
 * Safe category delete. The admin chooses what happens to the category's
 * products via three options:
 *   A. Move products to another category.
 *   B. Leave products Uncategorized (FK SET NULL).
 *   C. Permanently delete the category AND all its products.
 *
 * Option C is irreversible for the CATALOG but never breaks history: every
 * quotation / proforma / order / invoice / production task list keeps its own
 * product snapshot (name + price + configuration) from migration 089, so those
 * documents stay fully readable after the products are gone. Because it is
 * destructive, C requires a strong confirmation: the admin must type the exact
 * category name to enable the delete button.
 */
export default function DeleteCategoryControl({
  categoryId,
  categoryName,
  productCount,
  otherCategories,
  startOpen = false,
}: {
  categoryId: string;
  categoryName: string;
  productCount: number;
  otherCategories: Array<{ id: string; name: string }>;
  /** When true, render the options panel immediately (no extra "Delete…" click)
   *  — used when the control is embedded in the Product Catalog categories table. */
  startOpen?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(startOpen);
  const [target, setTarget] = useState("");
  const [err, setErr] = useState<string | null>(null);
  // Option C: reveal the strong-confirmation panel + the typed confirmation.
  const [hardOpen, setHardOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  function run(opts: { reassignTo?: string | null; mode?: "delete_products" }) {
    setErr(null);
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("id", categoryId);
        if (opts.reassignTo) fd.set("reassignTo", opts.reassignTo);
        if (opts.mode) fd.set("mode", opts.mode);
        await deleteCategory(fd); // redirects to /admin/categories on success
      } catch (e: any) {
        // redirect() throws NEXT_REDIRECT — that's success, not an error.
        if (e?.message && !String(e.message).includes("NEXT_REDIRECT")) setErr(e.message);
      }
    });
  }

  // No products → a plain confirm is enough.
  if (productCount === 0) {
    return (
      <button
        onClick={() => {
          if (confirm(`Delete category “${categoryName}”? This cannot be undone.`)) run({});
        }}
        disabled={pending}
        className="btn-secondary text-red-600 hover:bg-red-50 disabled:opacity-50"
      >
        {pending ? "Deleting…" : "Delete category"}
      </button>
    );
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-secondary text-red-600 hover:bg-red-50">
        Delete category…
      </button>
    );
  }

  const confirmOk = confirmText.trim() === categoryName.trim();

  return (
    <div className="rounded-md border border-red-200 bg-red-50/60 p-3 space-y-3 max-w-xl">
      <p className="text-sm text-red-900">
        <b>{categoryName}</b> has <b>{productCount}</b> product{productCount === 1 ? "" : "s"}. Choose what happens to
        them:
      </p>

      {/* Option A — move */}
      <div className="flex flex-wrap items-end gap-2">
        <label className="block text-xs">
          <span className="text-neutral-600">Move products to</span>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="mt-0.5 block rounded border px-2 py-1 text-sm min-w-[12rem]"
          >
            <option value="">Select a category…</option>
            {otherCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => run({ reassignTo: target })}
          disabled={pending || !target}
          className="btn-primary text-sm disabled:opacity-50"
        >
          {pending ? "Working…" : "Move & delete"}
        </button>
      </div>

      {/* Option B — orphan */}
      <div className="border-t border-red-100 pt-2">
        <button
          onClick={() => {
            if (confirm(`Delete “${categoryName}” and leave ${productCount} product(s) Uncategorized?`)) run({});
          }}
          disabled={pending}
          className="text-sm text-red-700 hover:underline disabled:opacity-50"
        >
          Delete and leave {productCount} product{productCount === 1 ? "" : "s"} Uncategorized
        </button>
      </div>

      {/* Option C — delete category AND all products (strong confirmation) */}
      <div className="border-t border-red-200 pt-2">
        {!hardOpen ? (
          <button
            onClick={() => {
              setHardOpen(true);
              setConfirmText("");
              setErr(null);
            }}
            disabled={pending}
            className="text-sm font-semibold text-red-700 hover:underline disabled:opacity-50"
          >
            Delete category and permanently delete all {productCount} product
            {productCount === 1 ? "" : "s"}…
          </button>
        ) : (
          <div className="rounded-md border border-red-300 bg-white p-3 space-y-2.5">
            <div className="flex items-start gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-5 w-5 mt-0.5 shrink-0 text-red-600"
                aria-hidden
              >
                <path
                  fillRule="evenodd"
                  d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 6a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 6Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
                  clipRule="evenodd"
                />
              </svg>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-red-900">
                  Permanently delete “{categoryName}” and {productCount} product
                  {productCount === 1 ? "" : "s"}
                </div>
                <p className="text-xs text-red-800 mt-1 leading-relaxed">
                  This <b>cannot be undone</b>. The category and all{" "}
                  <b>{productCount}</b> product{productCount === 1 ? "" : "s"} in it
                  (including their prices, options and cost history) will be
                  permanently removed from the catalog.
                </p>
                <p className="text-xs text-emerald-800 mt-1.5 leading-relaxed">
                  ✓ Existing quotations, proformas, orders, invoices and
                  production task lists are <b>not</b> affected — each keeps its
                  own snapshot (product name, price, configuration) and stays
                  fully readable.
                </p>
              </div>
            </div>

            <label className="block text-xs text-red-900">
              Type the category name <b>{categoryName}</b> to confirm:
              <input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={categoryName}
                autoFocus
                className="mt-1 block w-full rounded border border-red-300 px-2 py-1 text-sm focus:border-red-500 focus:outline-none"
              />
            </label>

            <div className="flex items-center gap-3">
              <button
                onClick={() => run({ mode: "delete_products" })}
                disabled={pending || !confirmOk}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {pending
                  ? "Deleting…"
                  : `Permanently delete category + ${productCount} product${
                      productCount === 1 ? "" : "s"
                    }`}
              </button>
              <button
                onClick={() => setHardOpen(false)}
                disabled={pending}
                className="text-sm text-neutral-500 hover:underline"
              >
                Back
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button onClick={() => setOpen(false)} disabled={pending} className="text-sm text-neutral-500 hover:underline">
          Cancel
        </button>
        {err && <span className="text-sm text-rose-700">{err}</span>}
      </div>
    </div>
  );
}
