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
    <form action={createPriceList} className="card sec space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <label className="block">
          <span className="px-flabel">Product category *</span>
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
          <span className="px-flabel">Cost version</span>
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
          <span className="px-flabel">Price list name *</span>
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
            <span className="px-flabel">{label}</span>
            <input
              type="number"
              step="0.5"
              min="0"
              max="99"
              value={val}
              onChange={(e) => setter(Number(e.target.value))}
              className="mt-1 w-full tabular-nums"
              style={{ textAlign: "right", ...(tierThin[i] ? { borderColor: "var(--sx-amber-line)", color: "var(--sx-amber-deep)" } : {}) }}
            />
            <span className={`mt-0.5 block text-[11px] ${tierThin[i] ? "text-[color:var(--sx-amber-deep)]" : "text-neutral-400"}`}>{hint} pcs{tierThin[i] ? " · thin margin" : ""}</span>
          </label>
        ))}
        <label className="block">
          <span className="px-flabel">Effective date</span>
          <input name="effectiveDate" type="date" className="mt-1 w-full rounded border px-3 py-2" />
        </label>
        <label className="block">
          <span className="px-flabel">Notes</span>
          <input name="notes" placeholder="optional" className="mt-1 w-full rounded border px-3 py-2" />
        </label>
      </div>

      {/* hidden fraction values for the server action */}
      <input type="hidden" name="targetMargin1" value={m1 / 100} />
      <input type="hidden" name="targetMargin2" value={m2 / 100} />
      <input type="hidden" name="targetMargin3" value={m3 / 100} />

      {/* live preview */}
      {categoryId && (
        <div>
          {missingCount > 0 && (
            <div className="px-notice amber" style={{ marginTop: 4 }}>
              <b>{missingCount} of {catProducts.length} product{catProducts.length === 1 ? "" : "s"} {missingCount === 1 ? "has" : "have"} no active cost</b> and {missingCount === 1 ? "is" : "are"} shown as <b>Missing cost</b> below. The list will save fine and the other {costedCount} calculate normally — enter a cost in Cost entry, then publish to price {missingCount === 1 ? "it" : "them"}.
            </div>
          )}
          <div className="px-preview" style={{ marginTop: 12 }}>
            Average profit per unit (after rebate — realised margin = your target):{" "}
            T1 <b style={{ color: "var(--sx-green-deep)" }}>${money(avgProfit[0])}</b> <span style={{ color: "var(--sx-mute-2)" }}>({m1.toFixed(1)}%)</span> ·{" "}
            T2 <b style={{ color: "var(--sx-green-deep)" }}>${money(avgProfit[1])}</b> <span style={{ color: "var(--sx-mute-2)" }}>({m2.toFixed(1)}%)</span> ·{" "}
            T3 <b style={{ color: "var(--sx-green-deep)" }}>${money(avgProfit[2])}</b> <span style={{ color: "var(--sx-mute-2)" }}>({m3.toFixed(1)}%)</span>
          </div>
          <div className="card" style={{ marginTop: 8, padding: 0, boxShadow: "none" }}>
            <div style={{ overflowX: "auto" }}>
              <table className="px-grid">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="num">Cost RMB</th>
                    <th className="num">USD</th>
                    <th className="num" style={tierThin[0] ? { color: "var(--sx-amber-deep)" } : undefined}>T1 ({fmtPct(margins.targetMargin1, 0)})</th>
                    <th className="num" style={tierThin[1] ? { color: "var(--sx-amber-deep)" } : undefined}>T2 ({fmtPct(margins.targetMargin2, 0)})</th>
                    <th className="num" style={tierThin[2] ? { color: "var(--sx-amber-deep)" } : undefined}>T3 ({fmtPct(margins.targetMargin3, 0)})</th>
                  </tr>
                </thead>
                <tbody>
                  {catProducts.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: "center", padding: "28px 12px", color: "var(--sx-mute)" }}>No products in this category.</td>
                    </tr>
                  ) : (
                    catProducts.map((p) => {
                      const r = computePricing(p.costRmb, settings, margins);
                      const tiers = [r.tier1, r.tier2, r.tier3];
                      const noCost = p.costRmb <= 0;
                      return (
                        <tr key={p.id}>
                          <td>
                            <span className="px-pname">{p.name}</span>
                            <span className="px-sku">{p.sku ?? "—"}</span>
                            {noCost && <span className="px-sbadge missing" style={{ marginLeft: 8 }}>Missing cost</span>}
                          </td>
                          <td className="num">{noCost ? <span className="px-muteit">—</span> : money(p.costRmb)}</td>
                          <td className="num">{noCost ? <span className="px-muteit">—</span> : money(p.usdCost)}</td>
                          {tiers.map((t, i) => {
                            const loss = !noCost && t.price <= p.usdCost;
                            const profit = t.marginValueAfterTax;
                            return (
                              <td key={i} className={`num ${tierThin[i] || loss ? "thincell" : ""}`}>
                                {noCost ? (
                                  <span className="px-muteit">—</span>
                                ) : (
                                  <span className="px-cellprice">
                                    {money(round(t.price))}
                                    <span className="mg" style={{ color: profit > 0 ? "var(--sx-green-deep)" : "var(--sx-amber-deep)" }}>${money(round(profit))}</span>
                                  </span>
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
        </div>
      )}

      <div className="savebar">
        <button type="submit" disabled={!categoryId || !name.trim()} className="sx-btn sx-btn-go disabled:opacity-50">
          Create price list (draft)
        </button>
        <span className="px-sub">Saved as a draft — publish it from the library when ready.</span>
      </div>
    </form>
  );
}
