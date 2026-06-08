"use client";

import { useState } from "react";
import { CountrySelect } from "@/components/forms/CountrySelect";
import { createProjectRequest } from "../actions";
import { toast } from "@/components/feedback/toast-store";
import { SubmitButton } from "@/components/feedback/ActionForm";
import { TRANSPORT_MODES, TRANSPORT_MODE_LABEL } from "@/lib/types";

function isNavError(e: any): boolean {
  const d = e?.digest;
  return typeof d === "string" && (d.startsWith("NEXT_REDIRECT") || d.startsWith("NEXT_NOT_FOUND"));
}

type ClientOption = { id: string; name: string; country: string | null };
type CategoryOption = { id: string; name: string };

/**
 * Create form — General · Information required · Solar Product Configuration ·
 * Pole Configuration (conditional) · Freight Information (conditional) · a
 * pre-submit summary. Built for speed (< 3 min); lands on the detail page.
 */
export default function NewProjectForm({
  clients,
  categories,
}: {
  clients: ClientOption[];
  categories: CategoryOption[];
}) {
  const [name, setName] = useState("");
  const [clientId, setClientId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [countrySeed, setCountrySeed] = useState("");
  const [quantity, setQuantity] = useState("");
  // information required
  const [reqProduct, setReqProduct] = useState(true);
  const [reqPacking, setReqPacking] = useState(false);
  const [reqFreight, setReqFreight] = useState(false);
  // pole
  const [poleRequired, setPoleRequired] = useState(true);
  const [poleQuantity, setPoleQuantity] = useState("");
  const [poleHeight, setPoleHeight] = useState("");
  const [armLength, setArmLength] = useState("");
  // freight brief
  const [transportMode, setTransportMode] = useState("");
  const [freightDestination, setFreightDestination] = useState("");

  const hasQty = quantity.trim() !== "" && Number(quantity) > 0;
  const categoryName = categories.find((c) => c.id === categoryId)?.name ?? null;
  const clientName = clients.find((c) => c.id === clientId)?.name ?? null;

  const label = "block text-[12px] font-medium text-neutral-600";
  const input =
    "mt-1.5 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm focus:border-solux focus:outline-none focus:ring-1 focus:ring-solux/40";
  const section = "text-[11px] font-semibold uppercase tracking-wide text-neutral-400";

  const yn = (b: boolean) => (b ? "Yes" : "No");
  const orDash = (s: string) => (s.trim() ? s : "—");

  return (
    <form
      action={async (fd) => {
        try {
          await createProjectRequest(fd); // redirects on success → ?flash confirms on detail
        } catch (e: any) {
          if (isNavError(e)) throw e;
          toast.error(e?.message ?? "Could not create the project request.");
        }
      }}
      className="space-y-7 rounded-xl border border-neutral-200 bg-white p-6"
    >
      {/* GENERAL */}
      <section className="space-y-3">
        <h2 className={section}>General information</h2>
        <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className={label}>Project name *</span>
            <input name="name" required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Cotonou solar street lighting — Phase 2" className={input} />
          </label>
          <label className="block">
            <span className={label}>Client *</span>
            <select
              name="client_id"
              required
              value={clientId}
              onChange={(e) => {
                setClientId(e.target.value);
                const c = clients.find((x) => x.id === e.target.value);
                if (c?.country) setCountrySeed(c.country);
              }}
              className={input}
            >
              <option value="">— Select a client —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={label}>Product category</span>
            <select name="product_category_id" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={input}>
              <option value="">— Select a product family —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={label}>Country</span>
            <CountrySelect name="country" defaultValue={countrySeed} key={countrySeed || "nocountry"} className="mt-1.5" />
          </label>
          <label className="block">
            <span className={label}>Quantity</span>
            <input name="quantity" type="number" min={0} value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="e.g. 200" className={input} />
          </label>
          <label className="block">
            <span className={label}>Opportunity value (USD, optional)</span>
            <input name="opportunity_value" type="number" min={0} step="0.01" placeholder="e.g. 300000" className={input} />
          </label>
        </div>
      </section>

      {/* INFORMATION REQUIRED */}
      <section className="space-y-3">
        <h2 className={section}>Information required</h2>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input type="checkbox" name="req_product_pricing" checked={reqProduct} onChange={(e) => setReqProduct(e.target.checked)} className="h-4 w-4 rounded border-neutral-300" />
            Product Pricing
          </label>
          <label className={`flex items-center gap-2 text-sm ${hasQty ? "text-neutral-700" : "text-neutral-400"}`}>
            <input type="checkbox" name="req_packing_list" checked={reqPacking && hasQty} disabled={!hasQty} onChange={(e) => setReqPacking(e.target.checked)} className="h-4 w-4 rounded border-neutral-300" />
            Packing List
          </label>
          <label className={`flex items-center gap-2 text-sm ${hasQty ? "text-neutral-700" : "text-neutral-400"}`}>
            <input type="checkbox" name="req_freight" checked={reqFreight && hasQty} disabled={!hasQty} onChange={(e) => setReqFreight(e.target.checked)} className="h-4 w-4 rounded border-neutral-300" />
            Freight Cost Estimate
          </label>
        </div>
        {!hasQty && <p className="text-[11px] text-amber-600">Quantity is required before requesting Packing List or Freight Cost.</p>}
      </section>

      {/* SOLAR PRODUCT CONFIGURATION */}
      <section className="space-y-3">
        <h2 className={section}>Solar product configuration</h2>
        <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-3">
          <label className="block">
            <span className={label}>LED power</span>
            <input name="led_power" placeholder="e.g. 60W" className={input} />
          </label>
          <label className="block">
            <span className={label}>Solar panel size</span>
            <input name="solar_panel_size" placeholder="e.g. 120W" className={input} />
          </label>
          <label className="block">
            <span className={label}>Battery specification</span>
            <input name="battery_spec" placeholder="e.g. 12.8V 60Ah LiFePO4" className={input} />
          </label>
          <label className="block">
            <span className={label}>Controller</span>
            <input name="controller" placeholder="e.g. MPPT 20A" className={input} />
          </label>
          <label className="flex items-center gap-2 pt-6">
            <input name="iot_required" type="checkbox" className="h-4 w-4 rounded border-neutral-300" />
            <span className="text-sm text-neutral-700">IoT required</span>
          </label>
        </div>
      </section>

      {/* POLE CONFIGURATION */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className={section}>Pole configuration</h2>
          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input type="checkbox" name="pole_required" checked={poleRequired} onChange={(e) => setPoleRequired(e.target.checked)} className="h-4 w-4 rounded border-neutral-300" />
            Pole required
          </label>
        </div>
        {poleRequired ? (
          <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-3">
            <label className="block">
              <span className={label}>Pole quantity</span>
              <input name="pole_quantity" type="number" min={0} value={poleQuantity} onChange={(e) => setPoleQuantity(e.target.value)} placeholder="e.g. 200" className={input} />
            </label>
            <label className="block">
              <span className={label}>Pole height</span>
              <input name="pole_height" value={poleHeight} onChange={(e) => setPoleHeight(e.target.value)} placeholder="e.g. 8m" className={input} />
            </label>
            <label className="block">
              <span className={label}>Arm length</span>
              <input name="arm_length" value={armLength} onChange={(e) => setArmLength(e.target.value)} placeholder="e.g. 1.5m" className={input} />
            </label>
            <label className="block sm:col-span-3">
              <span className={label}>Pole notes</span>
              <input name="pole_notes" placeholder="e.g. Single arm galvanized pole" className={input} />
            </label>
          </div>
        ) : (
          <p className="text-[12px] text-neutral-400">No poles in this project.</p>
        )}
      </section>

      {/* FREIGHT INFORMATION — only when a freight estimate is requested */}
      {reqFreight && hasQty && (
        <section className="space-y-3">
          <h2 className={section}>Freight information</h2>
          <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-3">
            <label className="block">
              <span className={label}>Transport mode *</span>
              <select name="freight_transport_mode" required value={transportMode} onChange={(e) => setTransportMode(e.target.value)} className={input}>
                <option value="">— Select —</option>
                {TRANSPORT_MODES.map((m) => (
                  <option key={m} value={m}>{TRANSPORT_MODE_LABEL[m]}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={label}>Destination port / airport *</span>
              <input name="freight_destination" required value={freightDestination} onChange={(e) => setFreightDestination(e.target.value)} placeholder="e.g. Port of Cotonou" className={input} />
            </label>
            <label className="block">
              <span className={label}>Freight notes</span>
              <input name="freight_notes" placeholder="optional" className={input} />
            </label>
          </div>
        </section>
      )}

      {/* ADDITIONAL NOTES */}
      <section className="space-y-3">
        <h2 className={section}>Additional notes</h2>
        <textarea name="additional_notes" rows={3} placeholder="Tender constraints, certifications, deadlines…" className={`${input} resize-y`} />
      </section>

      {/* PROJECT SUMMARY — verify before submitting */}
      <section className="rounded-lg border border-neutral-200 bg-neutral-50/70 p-4">
        <h2 className={`${section} mb-3`}>Summary — verify before submitting</h2>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-4">
          <Summary label="Client" value={clientName ?? "—"} />
          <Summary label="Product category" value={categoryName ?? "—"} />
          <Summary label="Quantity" value={hasQty ? quantity : "—"} />
          <Summary label="Pole" value={yn(poleRequired)} />
          {poleRequired && <Summary label="Pole qty" value={orDash(poleQuantity)} />}
          {poleRequired && <Summary label="Pole height" value={orDash(poleHeight)} />}
          {poleRequired && <Summary label="Arm length" value={orDash(armLength)} />}
          <Summary label="Pricing requested" value={yn(reqProduct)} />
          <Summary label="Packing requested" value={yn(reqPacking && hasQty)} />
          <Summary label="Freight requested" value={yn(reqFreight && hasQty)} />
          {reqFreight && hasQty && <Summary label="Transport mode" value={transportMode ? TRANSPORT_MODE_LABEL[transportMode as keyof typeof TRANSPORT_MODE_LABEL] ?? transportMode : "—"} />}
          {reqFreight && hasQty && <Summary label="Destination" value={orDash(freightDestination)} />}
        </div>
      </section>

      <div className="flex items-center gap-3 border-t border-neutral-100 pt-4">
        <SubmitButton className="btn-primary" pendingLabel="Creating…">Create project request</SubmitButton>
        <span className="text-[11px] text-neutral-400">Saved as a draft — attach documents &amp; submit on the next screen.</span>
      </div>
    </form>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-neutral-400">{label}</div>
      <div className="truncate font-medium text-neutral-800">{value}</div>
    </div>
  );
}
