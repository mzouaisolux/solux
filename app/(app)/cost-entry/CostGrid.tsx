"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveCostBatch, type CostEntry, type CostEntryProduct } from "../admin/pricing/actions";

const ALL = "__all__";
const UNCAT = "__uncat__";

type Category = { id: string; name: string; count: number };

/**
 * Parse a pasted/typed cost cell into a number. Tolerant of Excel currency
 * formatting: strips currency symbols / letters / spaces (incl. non-breaking),
 * then resolves comma vs dot as decimal or thousands separator.
 *   "CN¥ 1 440"  → 1440      "¥1,440.00" → 1440
 *   "1.440,50"   → 1440.5    "1440,50"   → 1440.5    "1,440" → 1440
 */
function parseCost(raw: string): number {
  let s = String(raw ?? "").trim();
  if (!s) return 0;
  s = s.replace(/[^\d.,]/g, ""); // drop ¥, CN, $, spaces, letters, minus
  if (!s) return 0;
  const hasDot = s.includes(".");
  const hasComma = s.includes(",");
  if (hasDot && hasComma) {
    // The last separator is the decimal point; the other groups thousands.
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (hasComma) {
    const parts = s.split(",");
    // one comma with ≤2 trailing digits = decimal; otherwise thousands grouping
    s = parts.length === 2 && parts[1].length <= 2 ? `${parts[0]}.${parts[1]}` : s.replace(/,/g, "");
  } else if (hasDot) {
    const parts = s.split(".");
    if (parts.length > 2) {
      const last = parts.pop() as string;
      s = parts.join("") + "." + last;
    }
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

/**
 * Finance cost grid — cost data only, by category. Current cost + editable new
 * cost + last-updated. Tab/Enter to move down; paste a column from Excel.
 */
export default function CostGrid({
  products,
  categories,
  initialCategoryId = ALL,
}: {
  products: CostEntryProduct[];
  categories: Category[];
  initialCategoryId?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [selectedCat, setSelectedCat] = useState(initialCategoryId);
  const [filter, setFilter] = useState("");
  const [note, setNote] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");

  // Editable "new cost" strings keyed by product id; seeded from current cost.
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const d: Record<string, string> = {};
    for (const p of products) d[p.id] = p.costRmb ? String(p.costRmb) : "";
    return d;
  });
  const baseline = useMemo(() => {
    const b: Record<string, number> = {};
    for (const p of products) b[p.id] = p.costRmb ?? 0;
    return b;
  }, [products]);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const uncatCount = useMemo(() => products.filter((p) => !p.categoryId).length, [products]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return products.filter((p) => {
      if (selectedCat === UNCAT) {
        if (p.categoryId) return false;
      } else if (selectedCat !== ALL) {
        if (p.categoryId !== selectedCat) return false;
      }
      if (q && !(p.name.toLowerCase().includes(q) || (p.sku ?? "").toLowerCase().includes(q))) return false;
      return true;
    });
  }, [products, selectedCat, filter]);

  const dirtyIds = useMemo(
    () => products.filter((p) => parseCost(draft[p.id] ?? "") !== baseline[p.id]).map((p) => p.id),
    [products, draft, baseline]
  );

  function setCost(id: string, value: string) {
    setDraft((d) => ({ ...d, [id]: value }));
  }
  function focusRow(i: number) {
    const el = inputRefs.current[i];
    if (el) {
      el.focus();
      el.select();
    }
  }
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>, i: number) {
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      focusRow(i + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusRow(i - 1);
    }
  }
  function onPaste(e: React.ClipboardEvent<HTMLInputElement>, startIndex: number) {
    const text = e.clipboardData.getData("text");
    if (!text.includes("\n") && !text.includes("\t")) return;
    e.preventDefault();
    const values = text
      .split(/\r?\n/)
      .map((line) => line.split("\t")[0])
      .filter((v, i, arr) => !(i === arr.length - 1 && v.trim() === ""));
    setDraft((d) => {
      const next = { ...d };
      for (let k = 0; k < values.length; k++) {
        const row = visible[startIndex + k];
        if (!row) break;
        // Normalize formatted/currency cells to a clean number for display;
        // keep the raw text if it doesn't parse so the user can spot it.
        const raw = values[k].trim();
        const parsed = parseCost(raw);
        next[row.id] = parsed ? String(parsed) : raw;
      }
      return next;
    });
  }

  function onSave() {
    setErr(null);
    setMsg(null);
    const entries: CostEntry[] = dirtyIds.map((id) => ({ productId: id, costRmb: parseCost(draft[id] ?? "") }));
    if (entries.length === 0) {
      setMsg("Nothing changed to save.");
      return;
    }
    const categoryId = selectedCat !== ALL && selectedCat !== UNCAT ? selectedCat : null;
    startTransition(async () => {
      try {
        const res = await saveCostBatch(entries, { categoryId, effectiveDate: effectiveDate || null, note: note || null });
        setMsg(`Saved ${res?.changed ?? entries.length} cost change(s).`);
        setNote("");
        router.refresh();
      } catch (e: any) {
        setErr(e?.message ?? "Save failed.");
      }
    });
  }

  const chip = (id: string, label: string, count: number) => (
    <button
      key={id}
      onClick={() => setSelectedCat(id)}
      className={`rounded-full px-3 py-1 text-sm border whitespace-nowrap ${
        id === selectedCat ? "bg-solux-accent border-neutral-400 font-medium" : "bg-white border-neutral-200 text-neutral-600 hover:bg-neutral-50"
      }`}
    >
      {label} <span className="text-neutral-400">({count})</span>
    </button>
  );

  const editingLabel =
    selectedCat === ALL ? "All categories" : selectedCat === UNCAT ? "Uncategorized" : categories.find((c) => c.id === selectedCat)?.name ?? "—";

  return (
    <div className="space-y-4">
      {/* category selector */}
      <div className="flex flex-wrap gap-2">
        {chip(ALL, "All categories", products.length)}
        {categories.map((c) => chip(c.id, c.name, c.count))}
        {uncatCount > 0 && chip(UNCAT, "Uncategorized", uncatCount)}
      </div>

      <div className="text-sm">
        <span className="text-neutral-500">Entering costs for: </span>
        <span className="font-semibold">{editingLabel}</span>
      </div>

      {/* toolbar */}
      <div className="flex flex-wrap items-end gap-3">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name / SKU…"
          className="rounded border px-3 py-1.5 text-sm w-56"
        />
        <label className="block">
          <span className="text-[11px] text-neutral-500">Effective date</span>
          <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className="mt-0.5 block rounded border px-2 py-1 text-sm" />
        </label>
        <label className="block flex-1 min-w-[10rem]">
          <span className="text-[11px] text-neutral-500">Version note (optional)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Q3 supplier update" className="mt-0.5 block w-full rounded border px-2 py-1 text-sm" />
        </label>
        <div className="ml-auto flex items-center gap-3">
          {dirtyIds.length > 0 && <span className="text-xs text-amber-700">{dirtyIds.length} unsaved</span>}
          {msg && <span className="text-sm text-emerald-700">{msg}</span>}
          {err && <span className="text-sm text-rose-700">{err}</span>}
          <button onClick={onSave} disabled={pending || dirtyIds.length === 0} className="btn-primary disabled:opacity-50">
            {pending ? "Saving…" : "Save cost version"}
          </button>
        </div>
      </div>

      <div className="panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-solux-accent text-left">
              <th className="px-3 py-2 text-xs font-semibold text-neutral-700">Product</th>
              <th className="px-3 py-2 text-xs font-semibold text-neutral-700">SKU</th>
              <th className="px-3 py-2 text-xs font-semibold text-neutral-700">Category</th>
              <th className="px-3 py-2 text-xs font-semibold text-neutral-700 text-right">Current RMB</th>
              <th className="px-3 py-2 text-xs font-semibold text-neutral-700 text-right w-40">New cost RMB</th>
              <th className="px-3 py-2 text-xs font-semibold text-neutral-700">Last updated</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-neutral-500">
                  No products in {editingLabel}.
                </td>
              </tr>
            ) : (
              visible.map((p, i) => {
                const newCost = parseCost(draft[p.id] ?? "");
                const dirty = newCost !== baseline[p.id];
                return (
                  <tr key={p.id} className={`border-t border-neutral-100 ${dirty ? "bg-amber-50/50" : ""}`}>
                    <td className="px-3 py-1.5 font-medium">{p.name}</td>
                    <td className="px-3 py-1.5 font-mono text-[11px] text-neutral-500">{p.sku ?? "—"}</td>
                    <td className="px-3 py-1.5 text-xs text-neutral-500">{p.categoryName ?? "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-neutral-500">{p.costRmb ? p.costRmb.toFixed(2) : "—"}</td>
                    <td className="px-3 py-1.5 text-right">
                      <input
                        ref={(el) => {
                          inputRefs.current[i] = el;
                        }}
                        value={draft[p.id] ?? ""}
                        onChange={(e) => setCost(p.id, e.target.value)}
                        onKeyDown={(e) => onKeyDown(e, i)}
                        onPaste={(e) => onPaste(e, i)}
                        onFocus={(e) => e.target.select()}
                        inputMode="decimal"
                        placeholder="0.00"
                        className={`w-32 rounded border px-2 py-1 text-right tabular-nums ${dirty ? "border-amber-400" : ""}`}
                      />
                    </td>
                    <td className="px-3 py-1.5 text-xs text-neutral-400">{fmtDate(p.updatedAt)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-neutral-400">
        Cost entry stores RMB costs only. Selling prices &amp; margins are configured by category under Pricing.
      </p>
    </div>
  );
}
