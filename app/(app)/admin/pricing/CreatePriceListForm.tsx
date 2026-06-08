"use client";

import { useMemo, useState } from "react";
import { computePricing, round, fmtPct, type PricingSettings } from "@/lib/pricing-engine";
import { createPriceList } from "./actions";

type Category = { id: string; name: string; count: number };
type CostVersion = { id: string; label: string };
type CreateProduct = { id: string; name: string; sku: string | null; categoryId: string | null; costRmb: number; usdCost: number };

/**
 * Step A — create a price list from a category's current costs. Pick category,
 * cost version, and tier margins; preview selling prices live; save as a draft.
 */
export default function CreatePriceListForm({
  categories,
  costVersions,
  settings,
  thinThreshold,
  products,
}: {
  categories: Category[];
  costVersions: CostVersion[];
  settings: PricingSettings;
  thinThreshold: number;
  products: CreateProduct[];
}) {
  const [categoryId, setCategoryId] = useState("");
  const [m1, setM1] = useState(38);
  const [m2, setM2] = useState(36);
  const [m3, setM3] = useState(25);
  const [name, setName] = useState("");

  const margins = { targetMargin1: m1 / 100, targetMargin2: m2 / 100, targetMargin3: m3 / 100 };
  const tierThin = [margins.targetMargin1 < thinThreshold, margins.targetMargin2 < thinThreshold, margins.targetMargin3 < thinThreshold];

  const catProducts = useMemo(
    () => (categoryId ? products.filter((p) => p.categoryId === categoryId) : []),
    [products, categoryId]
  );
  const missingCount = useMemo(() => catProducts.filter((p) => p.costRmb <= 0).length, [catProducts]);
  const costedCount = catProducts.length - missingCount;
  const money = (n: number) => n.toFixed(2);

  // Average AFTER-TAX profit ($ = price − usdCost + rebate) per tier, across
  // products that have a cost. This MUST use the after-tax figure so it matches
  // the price formula (price = usdCost*(1-rebate)/(1-m)); the realised margin
  // then equals the target margin the user typed. Using marginValueBeforeTax
  // here was the bug — it dropped the rebate and showed a margin below target.
  const avgProfit = useMemo<[number, number, number]>(() => {
    const costed = catProducts.filter((p) => p.costRmb > 0);
    if (!costed.length) return [0, 0, 0];
    const sums: [number, number, number] = [0, 0, 0];
    for (const p of costed) {
      const r = computePricing(p.costRmb, settings, {
        targetMargin1: m1 / 100,
        targetMargin2: m2 / 100,
        targetMargin3: m3 / 100,
      });
      sums[0] += r.tier1.marginValueAfterTax;
      sums[1] += r.tier2.marginValueAfterTax;
      sums[2] += r.tier3.marginValueAfterTax;
    }
    return [sums[0] / costed.length, sums[1] / costed.length, sums[2] / costed.length];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catProducts, m1, m2, m3]);

  return (
    <form action={createPriceList} className="rounded-lg border border-neutral-200 bg-white p-4 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <label className="block">
          <span className="text-xs font-medium text-neutral-600">Product category *</span>
          <select
            name="categoryId"
            required
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="mt-1 w-full rounded border px-3 py-2"
          >
            <option value="" disabled>
              Select a category…
            </option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.count})
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-neutral-600">Cost version</span>
          <select name="costBatchId" defaultValue={costVersions[0]?.id ?? ""} className="mt-1 w-full rounded border px-3 py-2">
            <option value="">Latest active cost</option>
            {costVersions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
          <span className="mt-0.5 block text-[11px] text-neutral-400">prices use the current active cost</span>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-neutral-600">Price list name *</span>
          <input
            name="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Fadel SSLX PRO June 2026"
            className="mt-1 w-full rounded border px-3 py-2"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {(
          [
            ["Tier 1 %", m1, setM1, "under 50", 0],
            ["Tier 2 %", m2, setM2, "50–150", 1],
            ["Tier 3 %", m3, setM3, "over 150", 2],
          ] as const
        ).map(([label, val, setter, hint, i]) => (
          <label key={label} className="block">
            <span className="text-xs font-medium text-neutral-600">{label}</span>
            <input
              type="number"
              step="0.5"
              min="0"
              max="99"
              value={val}
              onChange={(e) => setter(Number(e.target.value))}
              className={`mt-1 w-full rounded border px-3 py-2 tabular-nums ${tierThin[i] ? "border-rose-400 text-rose-700" : ""}`}
            />
            <span className="mt-0.5 block text-[11px] text-neutral-400">{hint} pcs</span>
          </label>
        ))}
        <label className="block">
          <span className="text-xs font-medium text-neutral-600">Effective date</span>
          <input name="effectiveDate" type="date" className="mt-1 w-full rounded border px-3 py-2" />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-neutral-600">Notes</span>
          <input name="notes" placeholder="optional" className="mt-1 w-full rounded border px-3 py-2" />
        </label>
      </div>

      {/* hidden fraction values for the server action */}
      <input type="hidden" name="targetMargin1" value={m1 / 100} />
      <input type="hidden" name="targetMargin2" value={m2 / 100} />
      <input type="hidden" name="targetMargin3" value={m3 / 100} />

      {/* live preview */}
      {categoryId && (
        <div className="space-y-2">
          {missingCount > 0 && (
            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
              <span className="font-semibold">
                {missingCount} of {catProducts.length} product{catProducts.length === 1 ? "" : "s"}{" "}
                {missingCount === 1 ? "has" : "have"} no active cost
              </span>{" "}
              and {missingCount === 1 ? "is" : "are"} shown as{" "}
              <span className="font-medium">Missing cost</span> below. The list will save fine and the
              other {costedCount} calculate normally — enter a cost in Cost entry, then publish to price{" "}
              {missingCount === 1 ? "it" : "them"}.
            </div>
          )}
          <div className="text-[11px] text-neutral-500">
            Average profit per unit (after rebate — realised margin = your target):{" "}
            T1 <span className="font-medium text-emerald-600">${money(avgProfit[0])}</span>{" "}
            <span className="text-neutral-400">({m1.toFixed(1)}%)</span> ·{" "}
            T2 <span className="font-medium text-emerald-600">${money(avgProfit[1])}</span>{" "}
            <span className="text-neutral-400">({m2.toFixed(1)}%)</span> ·{" "}
            T3 <span className="font-medium text-emerald-600">${money(avgProfit[2])}</span>{" "}
            <span className="text-neutral-400">({m3.toFixed(1)}%)</span>
          </div>
          <div className="rounded border border-neutral-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-solux-accent text-left">
                <th className="px-3 py-2 text-xs font-semibold text-neutral-700">Product</th>
                <th className="px-3 py-2 text-xs font-semibold text-neutral-700 text-right">Cost RMB</th>
                <th className="px-3 py-2 text-xs font-semibold text-neutral-700 text-right">USD</th>
                <th className={`px-3 py-2 text-xs font-semibold text-right ${tierThin[0] ? "text-rose-700" : "text-neutral-700"}`}>T1 ({fmtPct(margins.targetMargin1, 0)})</th>
                <th className={`px-3 py-2 text-xs font-semibold text-right ${tierThin[1] ? "text-rose-700" : "text-neutral-700"}`}>T2 ({fmtPct(margins.targetMargin2, 0)})</th>
                <th className={`px-3 py-2 text-xs font-semibold text-right ${tierThin[2] ? "text-rose-700" : "text-neutral-700"}`}>T3 ({fmtPct(margins.targetMargin3, 0)})</th>
              </tr>
            </thead>
            <tbody>
              {catProducts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-neutral-500">No products in this category.</td>
                </tr>
              ) : (
                catProducts.map((p) => {
                  const r = computePricing(p.costRmb, settings, margins);
                  const tiers = [r.tier1, r.tier2, r.tier3];
                  const noCost = p.costRmb <= 0;
                  return (
                    <tr key={p.id} className="border-t border-neutral-100">
                      <td className="px-3 py-1.5">
                        <span className="font-medium">{p.name}</span>
                        <span className="ml-2 font-mono text-[11px] text-neutral-400">{p.sku ?? "—"}</span>
                        {noCost && (
                          <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                            Missing cost
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{noCost ? "—" : money(p.costRmb)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{noCost ? "—" : money(p.usdCost)}</td>
                      {tiers.map((t, i) => {
                        const loss = !noCost && t.price <= p.usdCost;
                        // After-tax profit (price − usdCost + rebate) so profit/price
                        // equals the tier's target margin shown in the header.
                        const profit = t.marginValueAfterTax;
                        return (
                          <td key={i} className={`px-3 py-1.5 text-right tabular-nums ${tierThin[i] || loss ? "bg-rose-50/60" : ""}`}>
                            {noCost ? (
                              <span className="text-neutral-300">—</span>
                            ) : (
                              <>
                                <span className={loss ? "text-rose-700 font-medium" : "font-medium"}>{money(round(t.price))}</span>
                                <span className={`block text-[10px] ${profit > 0 ? "text-emerald-600" : "text-rose-600"}`}>
                                  ${money(round(profit))}
                                </span>
                              </>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={!categoryId || !name.trim()} className="btn-primary disabled:opacity-50">
          Create price list (draft)
        </button>
        <span className="text-[11px] text-neutral-400">Saved as a draft — publish it from the library when ready.</span>
      </div>
    </form>
  );
}
