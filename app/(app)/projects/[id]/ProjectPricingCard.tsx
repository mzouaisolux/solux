"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { computeSectionPrice, fmtMarginPct } from "@/lib/project-pricing";
import { setProjectPricing } from "../actions";
import { toast } from "@/components/feedback/toast-store";

function PricingSubmit() {
  const { pending } = useFormStatus();
  return (
    <button disabled={pending} className="btn-primary disabled:opacity-60">
      {pending ? "Approving…" : "Approve pricing →"}
    </button>
  );
}

/**
 * Pricing workspace (Sales Director). Surfaces the FINANCIALS — revenue, margin
 * value, profit, total project value — not just percentages, so profitability
 * reads in seconds. Independent Product + Pole pricing via the existing engine
 * (computeSectionPrice → computePricing); freight is a pass-through line.
 */
export default function ProjectPricingCard({
  projectId,
  projectName,
  clientName,
  country,
  categoryName,
  freightType,
  exchangeRate,
  taxRebate,
  poleRequired = true,
  productCostRmb,
  poleCostRmb,
  quantity,
  poleQuantity,
  freightTotal,
  defaults,
  defaultNotes,
  canEdit,
}: {
  projectId: string;
  projectName: string;
  clientName: string | null;
  country: string | null;
  categoryName: string | null;
  freightType: string | null;
  exchangeRate: number;
  taxRebate: number;
  poleRequired?: boolean;
  productCostRmb: number | null;
  poleCostRmb: number | null;
  quantity: number | null;
  poleQuantity: number | null;
  freightTotal: number | null;
  defaults: {
    productMargin: number | null;
    productCommission: number | null;
    poleMargin: number | null;
    poleCommission: number | null;
  };
  defaultNotes: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pm, setPm] = useState(defaults.productMargin != null ? String(defaults.productMargin) : "30");
  const [pc, setPc] = useState(defaults.productCommission != null ? String(defaults.productCommission) : "0");
  const [polem, setPolem] = useState(defaults.poleMargin != null ? String(defaults.poleMargin) : "12");
  const [polec, setPolec] = useState(defaults.poleCommission != null ? String(defaults.poleCommission) : "0");

  const num = (s: string) => Number((s || "").replace(",", ".")) || 0;
  const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

  const productQty = Math.max(0, Number(quantity ?? 0));
  const poleQty = Math.max(0, Number(poleQuantity ?? quantity ?? 0));
  const product = computeSectionPrice({ costRmb: productCostRmb, exchangeRate, taxRebate, marginPct: num(pm), commissionPct: num(pc) });
  const pole = computeSectionPrice({ costRmb: poleCostRmb, exchangeRate, taxRebate, marginPct: num(polem), commissionPct: num(polec) });
  const freightRev = Number(freightTotal ?? 0);

  // Per-section financials (revenue = what the customer pays; margin = profit).
  const productRev = product.finalUnitPrice * productQty;
  const productMargin = product.marginValuePerUnit * productQty;
  const poleRev = poleRequired ? pole.finalUnitPrice * poleQty : 0;
  const poleMargin = poleRequired ? pole.marginValuePerUnit * poleQty : 0;
  const freightMargin = 0; // freight is passed through to the customer at cost

  const totalRevenue = productRev + poleRev + freightRev;
  const totalMargin = productMargin + poleMargin + freightMargin;
  const overallPct = totalRevenue > 0 ? totalMargin / totalRevenue : 0;

  const inputCls = "w-full rounded border border-neutral-200 px-2 py-1 text-sm tabular-nums disabled:bg-neutral-50 disabled:text-neutral-500";

  const Summary = ({ label, value }: { label: string; value: string }) => (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-neutral-400">{label}</div>
      <div className="truncate text-sm text-neutral-800">{value}</div>
    </div>
  );

  // Editable margin/commission inputs for a section.
  const Controls = ({ title, costRmb, usdCost, marginVal, setMargin, commVal, setComm }: {
    title: string; costRmb: number | null; usdCost: number; marginVal: string; setMargin: (v: string) => void; commVal: string; setComm: (v: string) => void;
  }) => (
    <div className="rounded-lg border border-neutral-200 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[12px] font-semibold text-neutral-700">{title}</div>
        <div className="text-[11px] text-neutral-400">{costRmb != null ? `${costRmb.toLocaleString()} RMB ≈ ${money(usdCost)}` : "no cost"}</div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[10px] uppercase text-neutral-400">Margin %</span>
          <input type="number" min={0} max={99} step="0.5" value={marginVal} onChange={(e) => setMargin(e.target.value)} disabled={!canEdit} className={inputCls} />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase text-neutral-400">Commission %</span>
          <input type="number" min={0} step="0.5" value={commVal} onChange={(e) => setComm(e.target.value)} disabled={!canEdit} className={inputCls} />
        </label>
      </div>
    </div>
  );

  type Row = { item: string; qty: string; costUnit: string; sellUnit: string; marginUnit: string; revenue: string; margin: string };
  const rows: Row[] = [
    {
      item: "Product",
      qty: String(productQty),
      costUnit: money(product.usdCost),
      sellUnit: money(product.finalUnitPrice),
      marginUnit: `${money(product.marginValuePerUnit)} · ${fmtMarginPct(product.marginPct)}`,
      revenue: money(productRev),
      margin: money(productMargin),
    },
    ...(poleRequired
      ? [
          {
            item: "Pole",
            qty: String(poleQty),
            costUnit: money(pole.usdCost),
            sellUnit: money(pole.finalUnitPrice),
            marginUnit: `${money(pole.marginValuePerUnit)} · ${fmtMarginPct(pole.marginPct)}`,
            revenue: money(poleRev),
            margin: money(poleMargin),
          } as Row,
        ]
      : []),
    ...(freightRev > 0
      ? [{ item: "Freight", qty: "—", costUnit: "—", sellUnit: "—", marginUnit: "pass-through", revenue: money(freightRev), margin: money(0) } as Row]
      : []),
  ];

  return (
    <form
      action={async (fd) => {
        setErr(null);
        try {
          await setProjectPricing(fd);
          setOk(true);
          toast.success("✓ Pricing approved — Sales notified");
          router.refresh();
        } catch (e: any) {
          setErr(e?.message ?? "Could not approve pricing.");
        }
      }}
      className="space-y-4"
    >
      <input type="hidden" name="id" value={projectId} />
      <input type="hidden" name="product_margin_pct" value={pm} />
      <input type="hidden" name="product_commission_pct" value={pc} />
      <input type="hidden" name="pole_margin_pct" value={polem} />
      <input type="hidden" name="pole_commission_pct" value={polec} />

      {/* PROJECT SUMMARY — always visible while pricing */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-neutral-200 bg-neutral-50/60 p-3 sm:grid-cols-3 lg:grid-cols-6">
        <Summary label="Project" value={projectName} />
        <Summary label="Client" value={clientName ?? "—"} />
        <Summary label="Country" value={country ?? "—"} />
        <Summary label="Category" value={categoryName ?? "—"} />
        <Summary label="Quantity" value={poleRequired ? `${productQty} + ${poleQty} poles` : String(productQty)} />
        <Summary label="Freight" value={freightType ?? "—"} />
      </div>

      {/* MARGIN / COMMISSION controls */}
      <div className={`grid grid-cols-1 gap-3 ${poleRequired ? "sm:grid-cols-2" : ""}`}>
        <Controls title="Product" costRmb={productCostRmb} usdCost={product.usdCost} marginVal={pm} setMargin={setPm} commVal={pc} setComm={setPc} />
        {poleRequired && (
          <Controls title="Pole" costRmb={poleCostRmb} usdCost={pole.usdCost} marginVal={polem} setMargin={setPolem} commVal={polec} setComm={setPolec} />
        )}
      </div>

      {/* FINANCIAL SUMMARY TABLE */}
      <div className="overflow-x-auto rounded-lg border border-neutral-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-neutral-50 text-left text-[10px] uppercase tracking-wide text-neutral-400">
              <th className="px-3 py-2 font-semibold">Item</th>
              <th className="px-3 py-2 text-right font-semibold">Qty</th>
              <th className="px-3 py-2 text-right font-semibold">Cost / unit</th>
              <th className="px-3 py-2 text-right font-semibold">Selling / unit</th>
              <th className="px-3 py-2 text-right font-semibold">Margin / unit</th>
              <th className="px-3 py-2 text-right font-semibold">Total revenue</th>
              <th className="px-3 py-2 text-right font-semibold">Total margin</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.item} className="border-t border-neutral-100">
                <td className="px-3 py-2 font-medium text-neutral-800">{r.item}</td>
                <td className="px-3 py-2 text-right tabular-nums text-neutral-600">{r.qty}</td>
                <td className="px-3 py-2 text-right tabular-nums text-neutral-600">{r.costUnit}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.sellUnit}</td>
                <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{r.marginUnit}</td>
                <td className="px-3 py-2 text-right tabular-nums font-medium">{r.revenue}</td>
                <td className="px-3 py-2 text-right tabular-nums font-medium text-emerald-700">{r.margin}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-neutral-200 bg-neutral-50 font-semibold">
              <td className="px-3 py-2" colSpan={5}>Total</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(totalRevenue)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{money(totalMargin)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* FINANCIAL SUMMARY BLOCK + headline */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-neutral-200 p-3">
          <div className="eyebrow mb-2">Revenue</div>
          <dl className="space-y-1 text-sm">
            <Line label="Product" value={money(productRev)} />
            {poleRequired && <Line label="Pole" value={money(poleRev)} />}
            {freightRev > 0 && <Line label="Freight" value={money(freightRev)} />}
            <Line label="Total revenue" value={money(totalRevenue)} bold />
          </dl>
        </div>
        <div className="rounded-lg border border-neutral-200 p-3">
          <div className="eyebrow mb-2">Margin (profit)</div>
          <dl className="space-y-1 text-sm">
            <Line label="Product" value={`${money(productMargin)} · ${fmtMarginPct(product.marginPct)}`} />
            {poleRequired && <Line label="Pole" value={`${money(poleMargin)} · ${fmtMarginPct(pole.marginPct)}`} />}
            {freightRev > 0 && <Line label="Freight" value="$0 (pass-through)" />}
            <Line label="Total margin" value={money(totalMargin)} bold />
          </dl>
        </div>
      </div>

      {/* Headline — % AND value, profitability at a glance */}
      <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
        <div className="text-sm text-emerald-900">
          <span className="text-2xl font-bold tabular-nums">{fmtMarginPct(overallPct)}</span>
          <span className="mx-2 text-emerald-700">=</span>
          <span className="text-lg font-semibold tabular-nums">{money(totalMargin)}</span> profit
        </div>
        <div className="text-sm text-emerald-900">
          Total project value: <span className="text-lg font-bold tabular-nums">{money(totalRevenue)}</span>
        </div>
      </div>

      <label className="block">
        <span className="text-[11px] text-neutral-500">Margin notes</span>
        <input name="margin_notes" defaultValue={defaultNotes ?? ""} disabled={!canEdit} placeholder="Rationale, competitor price, risk…" className="mt-1 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm disabled:bg-neutral-50" />
      </label>

      {canEdit &&
        (ok ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            ✓ Pricing approved · project moved to <b>Priced</b> · Sales notified.
          </div>
        ) : (
          <div className="space-y-1">
            <PricingSubmit />
            {err && <p className="text-sm text-rose-600">{err}</p>}
          </div>
        ))}
      <p className="text-[11px] text-neutral-400">Margin includes the export tax rebate, so it matches the target margin % you set. Freight is passed through at cost.</p>
    </form>
  );
}

function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 ${bold ? "border-t border-neutral-100 pt-1 font-semibold" : ""}`}>
      <dt className="text-neutral-500">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
