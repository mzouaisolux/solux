"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { computeSectionPrice, sellingPriceToMarginPct, fmtMarginPct } from "@/lib/project-pricing";
import { NumericField } from "@/components/forms/NumericField";
import { setProjectPricing } from "../actions";
import { toast } from "@/components/feedback/toast-store";

const inputCls =
  "w-full rounded border border-neutral-200 px-2 py-1 text-sm tabular-nums disabled:bg-neutral-50 disabled:text-neutral-500";
const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

type PricingMode = "margin" | "selling";

function PricingSubmit({ ready }: { ready: boolean }) {
  const { pending } = useFormStatus();
  // `ready` guards the brief pre-hydration window: a <form action={fn}> with a
  // CLIENT function isn't wired until React hydrates, so an early click would
  // submit natively and silently do nothing (the first-click no-op bug).
  const disabled = pending || !ready;
  return (
    <button disabled={disabled} className="sx-btn sx-btn-go disabled:opacity-60">
      {pending ? "Approving…" : ready ? "Approve pricing →" : "Preparing…"}
    </button>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-neutral-400">{label}</div>
      <div className="truncate text-sm text-neutral-800">{value}</div>
    </div>
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

/**
 * One priced section (Product or Pole). Module-level so it is NOT recreated on
 * every keystroke — that recreation was what stole the caret / focus. In
 * "margin" mode the Director types a margin %; in "selling" mode they type the
 * customer price and the margin % is derived + shown read-only. Commission is
 * always editable. Every numeric input is a NumericField (Excel-like).
 */
function SectionControls({
  title,
  costRmb,
  usdCost,
  mode,
  canEdit,
  marginPct, // number 0–99
  onMargin,
  commissionPct, // number 0–…
  onComm,
  sellingUnit, // number — current finalUnitPrice (derived)
  onSelling,
  computedMarginFrac, // 0–1, for the read-only display in selling mode
}: {
  title: string;
  costRmb: number | null;
  usdCost: number;
  mode: PricingMode;
  canEdit: boolean;
  marginPct: number;
  onMargin: (n: number | null) => void;
  commissionPct: number;
  onComm: (n: number | null) => void;
  sellingUnit: number;
  onSelling: (n: number | null) => void;
  computedMarginFrac: number;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[12px] font-semibold text-neutral-700">{title}</div>
        <div className="text-[11px] text-neutral-400">
          {costRmb != null ? `${costRmb.toLocaleString()} RMB ≈ ${money(usdCost)}` : "no cost"}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {mode === "margin" ? (
          <label className="block">
            <span className="text-[10px] uppercase text-neutral-400">Margin %</span>
            <NumericField
              value={marginPct}
              onCommit={onMargin}
              disabled={!canEdit}
              min={0}
              max={99}
              ariaLabel={`${title} margin percent`}
              className={inputCls}
            />
          </label>
        ) : (
          <>
            <label className="block">
              <span className="text-[10px] uppercase text-neutral-400">Selling price / unit</span>
              <NumericField
                value={Math.round(sellingUnit * 100) / 100}
                onCommit={onSelling}
                disabled={!canEdit}
                min={0}
                prefix="$"
                ariaLabel={`${title} selling price per unit`}
                className={inputCls + " pl-5"}
              />
            </label>
            <label className="block">
              <span className="text-[10px] uppercase text-neutral-400">Calculated margin</span>
              <div className="w-full rounded border border-neutral-100 bg-neutral-50 px-2 py-1 text-sm tabular-nums text-neutral-500">
                {fmtMarginPct(computedMarginFrac)}
              </div>
            </label>
          </>
        )}
        <label className="block">
          <span className="text-[10px] uppercase text-neutral-400">Commission %</span>
          <NumericField
            value={commissionPct}
            onCommit={onComm}
            disabled={!canEdit}
            min={0}
            ariaLabel={`${title} commission percent`}
            className={inputCls}
          />
        </label>
      </div>
    </div>
  );
}

/**
 * Pricing workspace (Sales Director). Surfaces the FINANCIALS — revenue, margin
 * value, profit, total project value. Two entry modes (m172): reason in margin
 * % OR type the selling price directly; switching converts losslessly.
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
  // Margin % + commission % remain the SOURCE OF TRUTH submitted to the server
  // (setProjectPricing is unchanged). Selling mode just converts price→margin.
  const [pm, setPm] = useState<number>(defaults.productMargin ?? 30);
  const [pc, setPc] = useState<number>(defaults.productCommission ?? 0);
  const [polem, setPolem] = useState<number>(defaults.poleMargin ?? 12);
  const [polec, setPolec] = useState<number>(defaults.poleCommission ?? 0);
  const [mode, setMode] = useState<PricingMode>("margin");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const productQty = Math.max(0, Number(quantity ?? 0));
  const poleQty = Math.max(0, Number(poleQuantity ?? quantity ?? 0));
  const product = computeSectionPrice({ costRmb: productCostRmb, exchangeRate, taxRebate, marginPct: pm, commissionPct: pc });
  const pole = computeSectionPrice({ costRmb: poleCostRmb, exchangeRate, taxRebate, marginPct: polem, commissionPct: polec });
  const freightRev = Number(freightTotal ?? 0);

  // Selling mode: convert a typed customer price back into the margin % we store.
  const setProductSelling = (v: number | null) =>
    setPm(sellingPriceToMarginPct({ costRmb: productCostRmb, exchangeRate, taxRebate, sellingUnitPrice: v ?? 0, commissionPct: pc }));
  const setPoleSelling = (v: number | null) =>
    setPolem(sellingPriceToMarginPct({ costRmb: poleCostRmb, exchangeRate, taxRebate, sellingUnitPrice: v ?? 0, commissionPct: polec }));

  const productRev = product.finalUnitPrice * productQty;
  const productMargin = product.marginValuePerUnit * productQty;
  const poleRev = poleRequired ? pole.finalUnitPrice * poleQty : 0;
  const poleMargin = poleRequired ? pole.marginValuePerUnit * poleQty : 0;

  const totalRevenue = productRev + poleRev + freightRev;
  const totalMargin = productMargin + poleMargin;
  const overallPct = totalRevenue > 0 ? totalMargin / totalRevenue : 0;

  type Row = { item: string; qty: string; costUnit: string; sellUnit: string; marginUnit: string; revenue: string; margin: string };
  const rows: Row[] = [
    { item: "Product", qty: String(productQty), costUnit: money(product.usdCost), sellUnit: money(product.finalUnitPrice), marginUnit: `${money(product.marginValuePerUnit)} · ${fmtMarginPct(product.marginPct)}`, revenue: money(productRev), margin: money(productMargin) },
    ...(poleRequired ? [{ item: "Pole", qty: String(poleQty), costUnit: money(pole.usdCost), sellUnit: money(pole.finalUnitPrice), marginUnit: `${money(pole.marginValuePerUnit)} · ${fmtMarginPct(pole.marginPct)}`, revenue: money(poleRev), margin: money(poleMargin) } as Row] : []),
    ...(freightRev > 0 ? [{ item: "Freight", qty: "—", costUnit: "—", sellUnit: "—", marginUnit: "pass-through", revenue: money(freightRev), margin: money(0) } as Row] : []),
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

      {/* PROJECT SUMMARY */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-neutral-200 bg-neutral-50/60 p-3 sm:grid-cols-3 lg:grid-cols-6">
        <Summary label="Project" value={projectName} />
        <Summary label="Client" value={clientName ?? "—"} />
        <Summary label="Country" value={country ?? "—"} />
        <Summary label="Category" value={categoryName ?? "—"} />
        <Summary label="Quantity" value={poleRequired ? `${productQty} + ${poleQty} poles` : String(productQty)} />
        <Summary label="Freight" value={freightType ?? "—"} />
      </div>

      {/* PRICING METHOD toggle (m172) */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-neutral-200 bg-white px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Pricing method</span>
        {(["margin", "selling"] as PricingMode[]).map((m) => (
          <label key={m} className={`flex cursor-pointer items-center gap-1.5 text-sm ${mode === m ? "font-semibold text-neutral-900" : "text-neutral-500"}`}>
            <input type="radio" name="pricing_method" value={m} checked={mode === m} disabled={!canEdit} onChange={() => setMode(m)} />
            {m === "margin" ? "Margin %" : "Selling price"}
          </label>
        ))}
        <span className="ml-auto text-[11px] text-neutral-400">
          {mode === "margin" ? "Type the margin — price is computed." : "Type the customer price — margin is computed."}
        </span>
      </div>

      {/* SECTION CONTROLS */}
      <div className={`grid grid-cols-1 gap-3 ${poleRequired ? "sm:grid-cols-2" : ""}`}>
        <SectionControls
          title="Product" costRmb={productCostRmb} usdCost={product.usdCost} mode={mode} canEdit={canEdit}
          marginPct={pm} onMargin={(n) => setPm(n ?? 0)}
          commissionPct={pc} onComm={(n) => setPc(n ?? 0)}
          sellingUnit={product.finalUnitPrice} onSelling={setProductSelling}
          computedMarginFrac={product.marginPct}
        />
        {poleRequired && (
          <SectionControls
            title="Pole" costRmb={poleCostRmb} usdCost={pole.usdCost} mode={mode} canEdit={canEdit}
            marginPct={polem} onMargin={(n) => setPolem(n ?? 0)}
            commissionPct={polec} onComm={(n) => setPolec(n ?? 0)}
            sellingUnit={pole.finalUnitPrice} onSelling={setPoleSelling}
            computedMarginFrac={pole.marginPct}
          />
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

      {/* FINANCIAL SUMMARY BLOCK */}
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

      {/* Headline */}
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
            <PricingSubmit ready={mounted} />
            {err && <p className="text-sm text-rose-600">{err}</p>}
          </div>
        ))}
      <p className="text-[11px] text-neutral-400">Margin includes the export tax rebate, so it matches the target margin % you set. Freight is passed through at cost.</p>
    </form>
  );
}
