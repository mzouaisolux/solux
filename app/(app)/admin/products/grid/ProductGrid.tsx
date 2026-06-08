"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { saveProductsBatch, type ProductGridRow } from "../actions";

type Category = { id: string; name: string };
type Row = {
  key: string;
  id: string | null;
  name: string;
  sku: string;
  categoryId: string;
  imageUrl: string | null;
  active: boolean;
};

const ALL = "__all__";
const UNCAT = "__uncat__";

let keySeq = 0;
const newKey = () => `r${keySeq++}`;

/** Category + text filter applied to the full row set. */
function applyFilter(rows: Row[], cat: string, q: string): Row[] {
  const ql = q.trim().toLowerCase();
  return rows.filter((r) => {
    if (cat === UNCAT) {
      if (r.categoryId) return false;
    } else if (cat !== ALL) {
      if (r.categoryId !== cat) return false;
    }
    const blank = !r.name.trim() && !r.sku.trim();
    if (ql && !blank && !(r.name.toLowerCase().includes(ql) || r.sku.toLowerCase().includes(ql))) {
      return false;
    }
    return true;
  });
}

/**
 * Excel-style product catalog grid, organized by category. The ONLY product
 * fields live here: Name, SKU, Category, Image (read-only thumbnail — assigned
 * via the Upload images workflow), and Active. Costs, selling prices and
 * margins are intentionally NOT here — they live under Cost Entry / Price Lists.
 * Pick a family at the top; new/pasted rows inherit it.
 */
export default function ProductGrid({
  initialProducts,
  categories,
  initialCategoryId = ALL,
  categoryControl,
}: {
  initialProducts: Array<{
    id: string;
    name: string;
    sku: string | null;
    category_id: string | null;
    image_url: string | null;
    active: boolean | null;
  }>;
  categories: Category[];
  initialCategoryId?: string;
  /**
   * When provided, the selected category is CONTROLLED by the parent (the
   * unified Product Catalog workspace, where the categories table is the
   * selector). The grid then hides its own category chips. Omit for the
   * standalone grid, which keeps its internal chip selector.
   */
  categoryControl?: { selected: string; onSelect: (id: string) => void };
}) {
  const router = useRouter();
  const controlled = !!categoryControl;
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const catName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categories) m.set(c.id, c.name);
    return m;
  }, [categories]);
  const catByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categories) m.set(c.name.trim().toLowerCase(), c.id);
    return m;
  }, [categories]);

  // Original values keyed by product id — so Save only sends rows the user
  // actually changed (editing one family never re-validates unrelated rows).
  const baselineById = useMemo(() => {
    const m = new Map<string, { name: string; sku: string; categoryId: string; active: boolean }>();
    for (const p of initialProducts) {
      m.set(p.id, {
        name: p.name ?? "",
        sku: p.sku ?? "",
        categoryId: p.category_id ?? "",
        active: p.active ?? true,
      });
    }
    return m;
  }, [initialProducts]);

  const [internalCat, setInternalCat] = useState<string>(initialCategoryId);
  const selectedCat = controlled ? categoryControl!.selected : internalCat;
  const setSelectedCat = controlled ? categoryControl!.onSelect : setInternalCat;
  const [filter, setFilter] = useState("");

  const [rows, setRows] = useState<Row[]>(() =>
    initialProducts.map((p) => ({
      key: newKey(),
      id: p.id,
      name: p.name ?? "",
      sku: p.sku ?? "",
      categoryId: p.category_id ?? "",
      imageUrl: p.image_url ?? null,
      active: p.active ?? true,
    }))
  );
  const [deletedIds, setDeletedIds] = useState<string[]>([]);

  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  // Remember rows removed via the delete button so we can RESTORE any whose
  // DB delete fails (e.g. still referenced by a quotation) — keeps the grid
  // honest instead of optimistically hiding a product that wasn't deleted.
  const removedRows = useRef<Map<string, Row>>(new Map());

  // Per-category counts (real products only — ignore blank placeholder rows).
  const counts = useMemo(() => {
    const real = rows.filter((r) => r.name.trim() || r.id);
    const byCat = new Map<string, number>();
    let uncat = 0;
    for (const r of real) {
      if (r.categoryId) byCat.set(r.categoryId, (byCat.get(r.categoryId) ?? 0) + 1);
      else uncat++;
    }
    return { total: real.length, byCat, uncat };
  }, [rows]);

  const visible = useMemo(() => applyFilter(rows, selectedCat, filter), [rows, selectedCat, filter]);

  /** Category a newly-added/pasted row should inherit. */
  const defaultCatForNew = () =>
    selectedCat !== ALL && selectedCat !== UNCAT ? selectedCat : "";

  const blankRow = (): Row => ({
    key: newKey(),
    id: null,
    name: "",
    sku: "",
    categoryId: defaultCatForNew(),
    imageUrl: null,
    active: true,
  });

  function update(key: string, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((rs) => [...rs, blankRow()]);
  }
  function removeRow(key: string) {
    setRows((rs) => {
      const row = rs.find((r) => r.key === key);
      if (row?.id) {
        setDeletedIds((d) => [...d, row.id!]);
        removedRows.current.set(row.id, row); // so we can restore if delete fails
      }
      return rs.filter((r) => r.key !== key);
    });
  }

  // Paste a block from Excel starting at a visible row. col: 0 name, 1 sku, 2 category.
  // New rows created to absorb overflow inherit the selected category.
  function onPaste(e: React.ClipboardEvent, visIndex: number, col: number) {
    const text = e.clipboardData.getData("text");
    if (!text.includes("\t") && !text.includes("\n")) return;
    e.preventDefault();
    const cols = ["name", "sku", "category"] as const;
    const matrix = text
      .split(/\r?\n/)
      .filter((l, i, a) => !(i === a.length - 1 && l.trim() === ""))
      .map((l) => l.split("\t"));

    setRows((rs) => {
      const next = [...rs];
      const visKeys = applyFilter(next, selectedCat, filter).map((r) => r.key);
      const idxByKey = (k: string) => next.findIndex((r) => r.key === k);
      for (let dr = 0; dr < matrix.length; dr++) {
        const targetVis = visIndex + dr;
        let actual: number;
        if (targetVis < visKeys.length) {
          actual = idxByKey(visKeys[targetVis]);
        } else {
          const nr = blankRow();
          next.push(nr);
          visKeys.push(nr.key);
          actual = next.length - 1;
        }
        const cells = matrix[dr];
        for (let dc = 0; dc < cells.length; dc++) {
          const field = cols[col + dc];
          if (!field) break;
          const val = cells[dc].trim();
          if (field === "category") {
            next[actual] = { ...next[actual], categoryId: catByName.get(val.toLowerCase()) ?? next[actual].categoryId };
          } else {
            next[actual] = { ...next[actual], [field]: val } as Row;
          }
        }
      }
      return next;
    });
  }

  // A row needs saving only if it's new-with-content or differs from its
  // original. This is what stops an untouched, unrelated uncategorized row
  // (e.g. "MIRA") from failing the save while you edit another family.
  const isDirty = (r: Row): boolean => {
    if (!r.id) return Boolean(r.name.trim() || r.sku.trim() || r.categoryId);
    const b = baselineById.get(r.id);
    if (!b) return true;
    return r.name !== b.name || r.sku !== b.sku || r.categoryId !== b.categoryId || r.active !== b.active;
  };
  const dirtyCount = useMemo(
    () => rows.filter(isDirty).length + deletedIds.length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, deletedIds, baselineById]
  );

  function onSave() {
    setErr(null);
    setMsg(null);
    const payload: ProductGridRow[] = rows
      .filter(isDirty)
      .map((r) => ({ id: r.id, name: r.name, sku: r.sku || null, category_id: r.categoryId || null, active: r.active }));
    if (payload.length === 0 && deletedIds.length === 0) {
      setMsg("Nothing changed to save.");
      return;
    }
    startTransition(async () => {
      try {
        const res = await saveProductsBatch(payload, deletedIds);

        // Restore any products that could NOT be deleted (still referenced),
        // so the grid reflects what's actually in the database — no ghost rows
        // that "vanish" then reappear on reload.
        const failed = new Set(res.failedDeletes ?? []);
        if (failed.size) {
          setRows((rs) => {
            const have = new Set(rs.map((r) => r.id).filter(Boolean) as string[]);
            const restore: Row[] = [];
            for (const id of failed) {
              if (!have.has(id)) {
                const r = removedRows.current.get(id);
                if (r) restore.push(r);
              }
            }
            return restore.length ? [...rs, ...restore] : rs;
          });
        }
        setDeletedIds([]);
        removedRows.current.clear();

        if (res.errors.length) {
          // Surface DB errors loudly; do NOT also claim success.
          setErr(res.errors.slice(0, 4).join(" · ") + (res.errors.length > 4 ? " …" : ""));
          setMsg(null);
        } else {
          setErr(null);
          setMsg(
            `Saved — ${res.created} new, ${res.updated} updated` +
              (res.reattached ? `, ${res.reattached} re-attached by SKU` : "") +
              `, ${res.deleted} deleted.`
          );
        }
        router.refresh();
      } catch (e: any) {
        setErr(e?.message ?? "Save failed.");
      }
    });
  }

  const editingLabel =
    selectedCat === ALL
      ? "All categories"
      : selectedCat === UNCAT
        ? "Uncategorized products"
        : catName.get(selectedCat) ?? "—";

  // Saved (DB-backed) products currently shown — what "Delete all" targets.
  const visibleSavedIds = visible.map((r) => r.id).filter(Boolean) as string[];

  // Delete every product in the current view and COMMIT IMMEDIATELY (no
  // separate "Save changes" step — that staging was a trap: rows vanished but
  // weren't deleted until Save, so a refresh brought them back). Successfully
  // deleted rows are removed; any the DB rejects (still referenced) are kept
  // with a clear error.
  function deleteAllInView() {
    const ids = visibleSavedIds;
    if (ids.length === 0) return;
    const ok = window.confirm(
      `Permanently delete ${ids.length} product${ids.length === 1 ? "" : "s"} in “${editingLabel}”?\n\n` +
        `This deletes them from the catalog now. Any product still referenced by a quotation, ` +
        `order or task list is kept (you'll see why). Historical documents are never affected.`
    );
    if (!ok) return;
    setErr(null);
    setMsg(null);
    startTransition(async () => {
      try {
        const res = await saveProductsBatch([], ids); // delete-only; commits now
        const failed = new Set(res.failedDeletes ?? []);
        // Drop the rows that were actually deleted; keep any that failed.
        setRows((rs) => rs.filter((r) => !(r.id && ids.includes(r.id) && !failed.has(r.id))));
        if (res.errors.length) {
          setErr(res.errors.slice(0, 4).join(" · ") + (res.errors.length > 4 ? " …" : ""));
        } else {
          setMsg(`Deleted ${res.deleted} product${res.deleted === 1 ? "" : "s"}.`);
        }
        router.refresh();
      } catch (e: any) {
        setErr(e?.message ?? "Delete failed.");
      }
    });
  }

  const chip = (id: string, label: string, count: number) => (
    <button
      key={id}
      onClick={() => setSelectedCat(id)}
      className={`rounded-full px-3 py-1 text-sm border whitespace-nowrap ${
        id === selectedCat
          ? "bg-solux-accent border-neutral-400 font-medium"
          : "bg-white border-neutral-200 text-neutral-600 hover:bg-neutral-50"
      }`}
    >
      {label} <span className="text-neutral-400">({count})</span>
    </button>
  );

  return (
    <div className="space-y-4">
      {/* category selector + editing label — hidden when the parent workspace
          drives the category (its categories table is the selector). */}
      {!controlled && (
        <>
          <div className="flex flex-wrap gap-2">
            {chip(ALL, "All categories", counts.total)}
            {categories.map((c) => chip(c.id, c.name, counts.byCat.get(c.id) ?? 0))}
            {counts.uncat > 0 && chip(UNCAT, "Uncategorized", counts.uncat)}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm">
              <span className="text-neutral-500">Editing products for category: </span>
              <span className="font-semibold">{editingLabel}</span>
              {selectedCat !== ALL && selectedCat !== UNCAT && (
                <span className="ml-2 text-xs text-neutral-400">new rows inherit this category</span>
              )}
            </div>
            {categories.length === 0 && (
              <Link href="/admin/categories" className="row-link text-sm">
                + Create your first category →
              </Link>
            )}
          </div>
        </>
      )}

      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={addRow} className="btn-secondary text-sm">
          + Add row
        </button>
        {!controlled && (
          <Link href="/admin/categories" className="row-link text-sm">
            Manage categories →
          </Link>
        )}
        <Link href="/admin/products/images" className="row-link text-sm">
          Upload images →
        </Link>
        <Link href="/admin/products/import" className="row-link text-sm">
          Import →
        </Link>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name / SKU…"
          className="rounded border px-3 py-1.5 text-sm w-64"
        />
        {visibleSavedIds.length > 0 && (
          <button
            onClick={deleteAllInView}
            className="text-sm text-rose-600 hover:underline"
            title="Stage every product in this view for deletion"
          >
            Delete all ({visibleSavedIds.length})
          </button>
        )}
        <div className="ml-auto flex items-center gap-3">
          {dirtyCount > 0 && <span className="text-xs text-amber-700">{dirtyCount} unsaved</span>}
          {msg && <span className="text-sm text-emerald-700">{msg}</span>}
          <button onClick={onSave} disabled={pending || dirtyCount === 0} className="btn-primary disabled:opacity-50">
            {pending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>

      {/* Prominent error banner — DB errors must never be silently swallowed. */}
      {err && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">
          {err}
        </div>
      )}

      <div className="panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-solux-accent text-left">
              <th className="px-2 py-2 text-xs font-semibold text-neutral-700 w-8"></th>
              <th className="px-2 py-2 text-xs font-semibold text-neutral-700 w-12">Image</th>
              <th className="px-2 py-2 text-xs font-semibold text-neutral-700">Name *</th>
              <th className="px-2 py-2 text-xs font-semibold text-neutral-700">SKU</th>
              <th className="px-2 py-2 text-xs font-semibold text-neutral-700">Category *</th>
              <th className="px-2 py-2 text-xs font-semibold text-neutral-700 w-16 text-center">Active</th>
              <th className="px-2 py-2 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-neutral-500">
                  {selectedCat === ALL
                    ? "No products. Add a row or paste from Excel."
                    : `No products in “${editingLabel}” yet. Add a row or paste from Excel — they'll be assigned here.`}
                </td>
              </tr>
            ) : (
              visible.map((r, i) => {
                const textCell = (field: "name" | "sku", col: number, ph = "") => (
                  <td className="px-1 py-0.5">
                    <input
                      ref={(el) => {
                        inputRefs.current[`${r.key}:${col}`] = el;
                      }}
                      value={r[field]}
                      onChange={(e) => update(r.key, { [field]: e.target.value } as Partial<Row>)}
                      onPaste={(e) => onPaste(e, i, col)}
                      placeholder={ph}
                      className="w-full rounded border border-transparent px-2 py-1 hover:border-neutral-200 focus:border-neutral-400"
                    />
                  </td>
                );
                return (
                  <tr key={r.key} className="border-t border-neutral-100">
                    <td className="px-2 py-0.5 text-[11px] text-neutral-400 tabular-nums">{i + 1}</td>
                    <td className="px-2 py-0.5">
                      {/* Read-only thumbnail — images are assigned via Upload images (filename→SKU). */}
                      {r.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={r.imageUrl}
                          alt=""
                          className="h-8 w-8 rounded object-cover border border-neutral-200"
                        />
                      ) : (
                        <div className="h-8 w-8 rounded border border-dashed border-neutral-200 bg-neutral-50" title="No image" />
                      )}
                    </td>
                    {textCell("name", 0, "Product name")}
                    {textCell("sku", 1, "SKU")}
                    <td className="px-1 py-0.5">
                      <select
                        value={r.categoryId}
                        onChange={(e) => update(r.key, { categoryId: e.target.value })}
                        onPaste={(e) => onPaste(e, i, 2)}
                        className={`w-full rounded border px-2 py-1 ${
                          r.categoryId ? "border-transparent hover:border-neutral-200" : "border-amber-300"
                        } focus:border-neutral-400`}
                      >
                        <option value="">—</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-0.5 text-center">
                      <input
                        type="checkbox"
                        checked={r.active}
                        onChange={(e) => update(r.key, { active: e.target.checked })}
                        className="h-4 w-4"
                        title={r.active ? "Active" : "Inactive"}
                      />
                    </td>
                    <td className="px-2 py-0.5 text-right">
                      <button
                        onClick={() => removeRow(r.key)}
                        className="text-neutral-400 hover:text-rose-600"
                        title="Delete row"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-neutral-400">
        Paste a block from Excel (columns: Name, SKU, Category) onto any cell — rows are created as needed and
        inherit the selected category unless a Category column overrides. Images are assigned by filename→SKU under{" "}
        <Link href="/admin/products/images" className="row-link">
          Upload images
        </Link>
        . Costs &amp; prices are managed under Cost Entry / Price Lists.
      </p>
    </div>
  );
}
