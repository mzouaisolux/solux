"use client";
// =====================================================================
// Packing Calculator — client UI over the pure engine (via server actions).
// Shows the FULL breakdown: per-line carton math (§11, nothing hidden),
// packages, totals, and a VOLUME-BASED container recommendation that is
// always marked "Operations review required".
// =====================================================================
import { useState, useTransition } from "react";
import type { PackingResult, FillResult, FillObjective } from "@/lib/packing-core/index.ts";
import { CALC_METHOD_LABEL, CALC_METHOD_CAUTION } from "@/lib/packing-core/index.ts";
import { runCalculation, saveCalculation, runFill } from "@/app/(app)/packing/calculator/actions";

type Item = { id: string; reference: string; family: string | null; is_lamp_pole: boolean };
type Line = { key: string; product_id: string; quantity: number; pole: boolean; pole_reference: string };

let counter = 0;
const newLine = (): Line => ({ key: `l${++counter}`, product_id: "", quantity: 1, pole: false, pole_reference: "" });
const n = (v: number | null | undefined, dp = 3) => (v == null ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: dp }));

export default function CalculatorClient({ items }: { items: Item[] }) {
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [result, setResult] = useState<PackingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [meta, setMeta] = useState({ customer: "", project: "", destination: "", incoterm: "" });
  const [pending, start] = useTransition();

  // Fill / "products you could add" panel state
  const [fill, setFill] = useState<FillResult | null>(null);
  const [fillContainer, setFillContainer] = useState<string>("");
  const [objective, setObjective] = useState<FillObjective>("max_cbm_utilization");
  const [fillScope, setFillScope] = useState<"all" | "same_family" | "in_request">("all");
  const [reserve, setReserve] = useState<number>(0);
  const [minUtil, setMinUtil] = useState<number>(0);
  const [excludePoles, setExcludePoles] = useState(false);
  const [excludeFragile, setExcludeFragile] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(0);

  const poles = items.filter((i) => i.is_lamp_pole);

  const runFillNow = (containerCode?: string) => {
    const code = containerCode ?? fillContainer;
    if (!result || !code) return;
    setError(null);
    start(async () => {
      try {
        const r = await runFill({
          container_code: code,
          currentCbm: result.total_cbm,
          currentGross: result.gross_weight,
          objective,
          constraints: {
            min_safety_reserve_cbm: reserve || undefined,
            min_final_utilization_pct: minUtil || undefined,
            exclude_poles: excludePoles,
            exclude_fragile: excludeFragile,
          },
          scope: fillScope,
          current_item_ids: payload().map((i) => i.product_id),
        });
        setFill(r);
      } catch (e: any) { setError(e.message ?? "Fill failed"); }
    });
  };

  const update = (key: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const payload = () =>
    lines
      .filter((l) => l.product_id && l.quantity > 0)
      .map((l) => ({
        product_id: l.product_id,
        quantity: Number(l.quantity),
        options: l.pole && l.pole_reference ? { pole: true, pole_reference: l.pole_reference } : {},
      }));

  const run = () => {
    setError(null); setSaved(null);
    const items = payload();
    if (!items.length) { setError("Add at least one product with a quantity."); return; }
    start(async () => {
      try { setResult(await runCalculation(items)); }
      catch (e: any) { setError(e.message ?? "Calculation failed"); }
    });
  };

  const save = () => {
    start(async () => {
      try {
        const r = await saveCalculation({ meta, items: payload() });
        setSaved(r.reference);
      } catch (e: any) { setError(e.message ?? "Save failed"); }
    });
  };

  const exportFile = async (format: "xlsx" | "pdf") => {
    if (!result) return;
    setError(null);
    try {
      const res = await fetch("/packing/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format, result, meta: { ...meta, reference: saved ?? undefined } }),
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `packing-list.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) { setError(e.message ?? "Export failed"); }
  };

  return (
    <div className="space-y-6">
      {/* ---- Line editor ---- */}
      <section className="border border-neutral-200 rounded-sm p-4 space-y-3">
        <h2 className="font-medium">Products &amp; quantities</h2>
        {lines.map((l) => (
          <div key={l.key} className="flex flex-wrap gap-2 items-end">
            <div className="grow min-w-[240px]">
              <label className="block text-[11px] text-neutral-500 mb-0.5">Product</label>
              <select
                value={l.product_id}
                onChange={(e) => update(l.key, { product_id: e.target.value })}
                className="w-full border border-neutral-300 rounded-sm px-2 py-1 text-sm"
              >
                <option value="">Select a packaging item…</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>{i.reference}{i.family ? ` · ${i.family}` : ""}</option>
                ))}
              </select>
            </div>
            <div className="w-24">
              <label className="block text-[11px] text-neutral-500 mb-0.5">Qty</label>
              <input
                type="number" min={1} value={l.quantity}
                onChange={(e) => update(l.key, { quantity: Number(e.target.value) })}
                className="w-full border border-neutral-300 rounded-sm px-2 py-1 text-sm"
              />
            </div>
            <label className="flex items-center gap-1 text-xs text-neutral-600 pb-1.5">
              <input type="checkbox" checked={l.pole} onChange={(e) => update(l.key, { pole: e.target.checked })} />
              + pole
            </label>
            {l.pole && (
              <select
                value={l.pole_reference}
                onChange={(e) => update(l.key, { pole_reference: e.target.value })}
                className="border border-neutral-300 rounded-sm px-2 py-1 text-sm"
              >
                <option value="">pole…</option>
                {poles.map((p) => <option key={p.id} value={p.id}>{p.reference}</option>)}
              </select>
            )}
            <button
              onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))}
              className="text-neutral-400 hover:text-red-600 text-sm pb-1.5"
              title="Remove"
            >✕</button>
          </div>
        ))}
        <div className="flex gap-2">
          <button onClick={() => setLines((ls) => [...ls, newLine()])} className="text-sm px-3 py-1.5 border border-neutral-300 rounded-sm">
            + Add product
          </button>
          <button onClick={run} disabled={pending} className="text-sm px-4 py-1.5 bg-neutral-900 text-white rounded-sm disabled:opacity-50">
            {pending ? "Calculating…" : "Calculate"}
          </button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </section>

      {result && (
        <>
          {/* ---- Validation banner + calculation method (prominent) ---- */}
          <div className="border border-amber-300 bg-amber-50 text-amber-800 rounded-sm px-4 py-2 text-sm flex flex-wrap items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 bg-amber-600 text-white rounded-sm">
              {CALC_METHOD_LABEL[result.calculation_method]}
            </span>
            <strong>Auto-calculated — Operations review required.</strong>
            <span>{CALC_METHOD_CAUTION[result.calculation_method]}</span>
          </div>

          {/* ---- Totals ---- */}
          <section className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <Stat label="Total packages" value={n(result.total_packages, 0)} />
            <Stat label="Total CBM" value={n(result.total_cbm, 3)} />
            <Stat label="Net weight (kg)" value={n(result.net_weight, 1)} />
            <Stat label="Gross weight (kg)" value={n(result.gross_weight, 1)} />
            <Stat label="Volumetric (kg)" value={n(result.volumetric_weight, 0)} />
          </section>

          {/* ---- Container recommendation ---- */}
          <section>
            <h2 className="font-medium mb-2">Container recommendation <span className="text-xs text-neutral-400">(volume-based)</span></h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
              {result.container_recommendations.map((r) => (
                <div key={r.container_code} className={`border rounded-sm p-3 ${r.recommended ? "border-green-500 bg-green-50" : "border-neutral-200"}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{r.count} × {r.container_code}</span>
                    {r.recommended && <span className="text-[10px] px-1.5 py-0.5 bg-green-600 text-white rounded-sm">RECOMMENDED</span>}
                    {!r.rules_validated && <span className="text-[10px] px-1.5 py-0.5 border border-amber-400 text-amber-700 rounded-sm">rules N/A</span>}
                  </div>
                  <div className="text-xs text-neutral-500 mt-1">{r.container_name}</div>
                  <div className="text-[10px] mt-1 flex gap-1 flex-wrap">
                    <span className="px-1.5 py-0.5 border border-neutral-300 rounded-sm text-neutral-600">{CALC_METHOD_LABEL[r.method]}</span>
                    <span className="px-1.5 py-0.5 border border-neutral-300 rounded-sm text-neutral-500">confidence: {r.confidence}</span>
                  </div>
                  <dl className="text-xs mt-2 space-y-0.5">
                    <Kv k="Utilization" v={r.utilization_pct != null ? `${r.utilization_pct}%` : "—"} />
                    <Kv k="Used / usable CBM" v={`${n(r.used_cbm, 2)} / ${r.usable_cbm != null ? n(r.usable_cbm, 2) : "—"}`} />
                    <Kv k="Remaining CBM" v={r.unused_cbm != null ? n(r.unused_cbm, 2) : "—"} />
                    <Kv k="Weight use" v={r.weight_utilization_pct != null ? `${r.weight_utilization_pct}%` : "—"} />
                    <Kv k="Remaining payload (kg)" v={r.remaining_payload_kg != null ? n(r.remaining_payload_kg, 0) : "—"} />
                  </dl>
                  <button
                    onClick={() => { setFillContainer(r.container_code); runFillNow(r.container_code); }}
                    className="mt-2 text-xs px-2 py-1 border border-neutral-300 rounded-sm hover:bg-white"
                  >
                    Suggest products to add →
                  </button>
                  {!!r.warnings.length && (
                    <ul className="mt-2 text-[11px] text-amber-700 list-disc pl-4">
                      {r.warnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* ---- Fill: products you could add (RULE_BASED estimate) ---- */}
          <section className="border border-neutral-200 rounded-sm p-4">
            <h2 className="font-medium mb-1">
              Products you could add <span className="text-xs text-neutral-400">— estimated additional quantity, NOT a physical fit</span>
            </h2>
            <div className="flex flex-wrap gap-2 items-end mb-3">
              <Field label="Container">
                <select value={fillContainer} onChange={(e) => setFillContainer(e.target.value)} className="border border-neutral-300 rounded-sm px-2 py-1 text-sm">
                  <option value="">choose…</option>
                  {result.container_recommendations.map((r) => (
                    <option key={r.container_code} value={r.container_code}>{r.count} × {r.container_code}</option>
                  ))}
                </select>
              </Field>
              <Field label="Objective">
                <select value={objective} onChange={(e) => setObjective(e.target.value as FillObjective)} className="border border-neutral-300 rounded-sm px-2 py-1 text-sm">
                  <option value="max_cbm_utilization">Max space utilization</option>
                  <option value="max_products">Max products</option>
                  <option value="min_remaining_cbm">Min remaining CBM</option>
                  <option value="balanced_mix">Balanced mix</option>
                  <option value="only_present">Only products in request</option>
                </select>
              </Field>
              <Field label="Catalogue">
                <select value={fillScope} onChange={(e) => setFillScope(e.target.value as any)} className="border border-neutral-300 rounded-sm px-2 py-1 text-sm">
                  <option value="all">All products</option>
                  <option value="in_request">In this request</option>
                  <option value="same_family">Same families</option>
                </select>
              </Field>
              <Field label="Reserve CBM">
                <input type="number" min={0} value={reserve} onChange={(e) => setReserve(Number(e.target.value))} className="w-20 border border-neutral-300 rounded-sm px-2 py-1 text-sm" />
              </Field>
              <Field label="Min final %">
                <input type="number" min={0} max={100} value={minUtil} onChange={(e) => setMinUtil(Number(e.target.value))} className="w-20 border border-neutral-300 rounded-sm px-2 py-1 text-sm" />
              </Field>
              <label className="flex items-center gap-1 text-xs text-neutral-600 pb-1.5">
                <input type="checkbox" checked={excludePoles} onChange={(e) => setExcludePoles(e.target.checked)} /> no poles
              </label>
              <label className="flex items-center gap-1 text-xs text-neutral-600 pb-1.5">
                <input type="checkbox" checked={excludeFragile} onChange={(e) => setExcludeFragile(e.target.checked)} /> no fragile
              </label>
              <button onClick={() => runFillNow()} disabled={pending || !fillContainer} className="text-sm px-4 py-1.5 bg-neutral-900 text-white rounded-sm disabled:opacity-50">
                {pending ? "…" : "Suggest"}
              </button>
            </div>

            {fill && (
              <div className="space-y-2">
                <div className="text-xs text-neutral-500">
                  {fill.container_code}: remaining {n(fill.remaining_cbm, 2)} CBM
                  {fill.remaining_payload_kg != null ? `, ${n(fill.remaining_payload_kg, 0)} kg payload` : ""} ·
                  method <strong>{CALC_METHOD_LABEL[fill.method]}</strong>
                </div>
                {fill.warnings.map((w, i) => <p key={i} className="text-xs text-amber-700">{w}</p>)}
                {!fill.options.length && <p className="text-sm text-neutral-400">No option matches — try another objective, a wider catalogue, or a lower minimum utilization.</p>}
                {fill.options.map((o, i) => (
                  <div key={i} className="border border-neutral-200 rounded-sm">
                    <button onClick={() => setExpanded(expanded === i ? null : i)} className="w-full flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-left hover:bg-neutral-50">
                      <span className="font-medium text-sm">{o.label}</span>
                      <span className="text-xs text-neutral-500">
                        +{n(o.additional_cbm, 2)} CBM · final {o.final_utilization_pct}% · remaining {n(o.remaining_cbm, 2)} CBM
                        <span className="ml-2 px-1.5 py-0.5 border border-neutral-300 rounded-sm text-[10px]">{CALC_METHOD_LABEL[o.method]}</span>
                      </span>
                    </button>
                    {expanded === i && (
                      <div className="px-3 pb-3 text-xs">
                        <table className="w-full mb-2">
                          <thead className="text-left text-neutral-500">
                            <tr><th className="py-1">Product</th><th className="text-right">Qty</th><th className="text-right">+CBM</th><th className="text-right">+Gross</th><th>Packages</th></tr>
                          </thead>
                          <tbody>
                            {o.lines.map((l, j) => (
                              <tr key={j} className="border-t border-neutral-100">
                                <td className="py-1">{l.reference}</td>
                                <td className="text-right tabular-nums font-medium">{l.quantity}</td>
                                <td className="text-right tabular-nums">{n(l.added_cbm, 2)}</td>
                                <td className="text-right tabular-nums">{n(l.added_gross, 0)}</td>
                                <td className="text-neutral-500">{l.packages_summary}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-0.5 text-neutral-600">
                          <Kv k="Final CBM / usable" v={`${n(o.final_cbm, 2)} / ${n(o.usable_cbm, 2)}`} />
                          <Kv k="Final utilization" v={`${o.final_utilization_pct}%`} />
                          <Kv k="Remaining CBM" v={n(o.remaining_cbm, 2)} />
                          <Kv k="Remaining payload" v={o.remaining_payload_kg != null ? `${n(o.remaining_payload_kg, 0)} kg` : "—"} />
                        </dl>
                        <p className="text-amber-700 mt-2">{o.caution}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ---- Warnings & assumptions ---- */}
          {(result.warnings.length > 0 || result.assumptions.length > 0) && (
            <section className="grid md:grid-cols-2 gap-3 text-sm">
              {result.warnings.length > 0 && (
                <div className="border border-amber-200 bg-amber-50 rounded-sm p-3">
                  <div className="font-medium text-amber-800 mb-1">Warnings</div>
                  <ul className="list-disc pl-4 text-amber-800 space-y-0.5">{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                </div>
              )}
              {result.assumptions.length > 0 && (
                <div className="border border-neutral-200 rounded-sm p-3">
                  <div className="font-medium mb-1">Assumptions</div>
                  <ul className="list-disc pl-4 text-neutral-600 space-y-0.5">{result.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>
                </div>
              )}
            </section>
          )}

          {/* ---- Per-line breakdown (§11 — nothing hidden) ---- */}
          <section>
            <h2 className="font-medium mb-2">Carton breakdown</h2>
            <div className="overflow-x-auto border border-neutral-200 rounded-sm">
              <table className="w-full text-xs">
                <thead className="bg-neutral-50 text-left text-[10px] uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="p-2">Ref</th><th className="p-2 text-right">Ordered</th>
                    <th className="p-2 text-right">/outside</th><th className="p-2 text-right">Complete cartons</th>
                    <th className="p-2 text-right">Rem. units</th><th className="p-2 text-right">Rem. indiv.</th>
                    <th className="p-2 text-right">Packages</th><th className="p-2 text-right">CBM</th>
                    <th className="p-2 text-right">Net</th><th className="p-2 text-right">Gross</th>
                  </tr>
                </thead>
                <tbody>
                  {result.lines.map((l, i) => (
                    <tr key={i} className="border-t border-neutral-100">
                      <td className="p-2 text-neutral-700">{l.reference}</td>
                      <td className="p-2 text-right tabular-nums">{l.ordered_quantity}</td>
                      <td className="p-2 text-right tabular-nums">{l.units_per_outside_carton ?? "—"}</td>
                      <td className="p-2 text-right tabular-nums">{l.complete_outside_cartons}</td>
                      <td className="p-2 text-right tabular-nums">{l.remaining_units}</td>
                      <td className="p-2 text-right tabular-nums">{l.remaining_individual_cartons}</td>
                      <td className="p-2 text-right tabular-nums font-medium">{l.total_packages}</td>
                      <td className="p-2 text-right tabular-nums">{n(l.total_cbm, 3)}</td>
                      <td className="p-2 text-right tabular-nums">{n(l.net_weight, 1)}</td>
                      <td className="p-2 text-right tabular-nums">{n(l.gross_weight, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-neutral-400 mt-1">
              Incomplete-carton policy: <strong>{result.lines[0]?.incomplete_carton_policy?.replace(/_/g, " ")}</strong> — rounding is explicit, never hidden.
            </p>
          </section>

          {/* ---- Save ---- */}
          <section className="border border-neutral-200 rounded-sm p-4">
            <h2 className="font-medium mb-2">Save calculation</h2>
            <div className="grid sm:grid-cols-4 gap-2 mb-2">
              {(["customer", "project", "destination", "incoterm"] as const).map((k) => (
                <input key={k} placeholder={k} value={(meta as any)[k]}
                  onChange={(e) => setMeta((m) => ({ ...m, [k]: e.target.value }))}
                  className="border border-neutral-300 rounded-sm px-2 py-1 text-sm" />
              ))}
            </div>
            <div className="flex gap-2 flex-wrap items-center">
              <button onClick={save} disabled={pending} className="text-sm px-4 py-1.5 border border-neutral-300 rounded-sm disabled:opacity-50">
                Save as calculation (snapshot)
              </button>
              <button onClick={() => exportFile("xlsx")} className="text-sm px-4 py-1.5 border border-neutral-300 rounded-sm">
                Export Excel
              </button>
              <button onClick={() => exportFile("pdf")} className="text-sm px-4 py-1.5 border border-neutral-300 rounded-sm">
                Export PDF
              </button>
              {saved && <span className="text-sm text-green-700">Saved as {saved} (packaging-version snapshot kept).</span>}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="border border-neutral-200 rounded-sm p-3">
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-neutral-500">{label}</div>
    </div>
  );
}
function Kv({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between"><dt className="text-neutral-500">{k}</dt><dd className="tabular-nums">{v}</dd></div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] text-neutral-500 mb-0.5">{label}</label>
      {children}
    </div>
  );
}
