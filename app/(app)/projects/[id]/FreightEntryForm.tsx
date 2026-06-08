"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { enterFreight } from "../actions";
import { toast } from "@/components/feedback/toast-store";
import { SubmitButton } from "@/components/feedback/ActionForm";
import { computeFreightTotal } from "@/lib/project-pricing";
import { validityFromPeriod } from "@/lib/freight-validity";
import {
  TRANSPORT_MODES,
  TRANSPORT_MODE_LABEL,
  FREIGHT_VALIDITY_PERIODS,
  type PackingContainer,
  type FreightContainer,
} from "@/lib/types";

const TYPE_LABEL: Record<string, string> = {
  "20GP": "20GP",
  "40GP": "40GP",
  "40HQ": "40HQ",
  LCL: "LCL / Groupage",
};

/**
 * Freight cost entry — the container rows are GENERATED from the Packing List
 * (single source of truth). Operations only enters the per-unit freight rate;
 * the per-row total and the overall total are computed automatically. Types
 * and quantities are never re-entered here.
 */
export default function FreightEntryForm({
  projectId,
  packingContainers,
  freightContainers,
  defaults,
  countryFallback,
  completed,
}: {
  projectId: string;
  packingContainers: PackingContainer[];
  freightContainers: FreightContainer[];
  defaults: {
    transport_mode: string | null;
    incoterm: string | null;
    port_of_destination: string | null;
    destination_country: string | null;
    notes: string | null;
    valid_until: string | null;
  };
  countryFallback: string | null;
  completed: boolean;
}) {
  const router = useRouter();
  const todayISO = new Date().toISOString().slice(0, 10);
  const [validUntil, setValidUntil] = useState<string>(defaults.valid_until ?? "");
  // Prefill the per-unit rate from any existing freight row of the same type.
  const seededByType = new Map<string, number>();
  for (const f of freightContainers ?? []) {
    if (f.type && f.freight_per_unit != null && !seededByType.has(f.type)) seededByType.set(f.type, f.freight_per_unit);
  }
  const [perUnit, setPerUnit] = useState<string[]>(() =>
    packingContainers.map((c) => {
      const v = seededByType.get(c.type);
      return v != null ? String(v) : "";
    })
  );

  const num = (s: string) => Math.max(0, Number((s || "").replace(",", ".")) || 0);
  const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

  const lines = packingContainers.map((c, i) => ({
    type: c.type,
    quantity: c.quantity,
    freight_per_unit: num(perUnit[i] ?? ""),
  }));
  const total = computeFreightTotal(lines);

  return (
    <form
      action={async (fd) => {
        try {
          await enterFreight(fd);
          toast.success("✓ Freight cost saved");
          router.refresh();
        } catch (e: any) {
          toast.error(e?.message ?? "Could not save freight cost.");
        }
      }}
      className="space-y-2 border-t border-neutral-100 pt-3"
    >
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="containers_json" value={JSON.stringify(lines)} />

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[11px] text-neutral-500">Transport mode</span>
          <select name="transport_mode" defaultValue={defaults.transport_mode ?? ""} className="mt-0.5 w-full rounded border px-2 py-1.5 text-sm">
            <option value="">—</option>
            {TRANSPORT_MODES.map((m) => (
              <option key={m} value={m}>{TRANSPORT_MODE_LABEL[m]}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] text-neutral-500">Incoterm</span>
          <select name="incoterm" defaultValue={defaults.incoterm ?? ""} className="mt-0.5 w-full rounded border px-2 py-1.5 text-sm">
            <option value="">—</option>
            {["EXW", "FOB", "CFR", "CIF", "DDP", "DDU"].map((it) => (
              <option key={it} value={it}>{it}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] text-neutral-500">Port of destination</span>
          <input name="port_of_destination" defaultValue={defaults.port_of_destination ?? ""} placeholder="e.g. Cotonou" className="mt-0.5 w-full rounded border px-2 py-1.5 text-sm" />
        </label>
        <label className="block">
          <span className="text-[11px] text-neutral-500">Destination country</span>
          <input name="destination_country" defaultValue={defaults.destination_country ?? countryFallback ?? ""} className="mt-0.5 w-full rounded border px-2 py-1.5 text-sm" />
        </label>
      </div>

      {/* Per-container freight — rows come from the Packing List (read-only). */}
      <div className="rounded border border-neutral-200">
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 border-b border-neutral-100 px-2 py-1 text-[10px] uppercase tracking-wide text-neutral-400">
          <span>Container (from packing)</span>
          <span className="text-right">Qty</span>
          <span className="text-right">Freight / unit</span>
          <span className="text-right">Total</span>
        </div>
        {packingContainers.map((c, i) => {
          const lineTotal = c.quantity * num(perUnit[i] ?? "");
          return (
            <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 px-2 py-1.5 text-sm">
              <span className="font-medium text-neutral-700">{TYPE_LABEL[c.type] ?? c.type}</span>
              <span className="text-right tabular-nums text-neutral-600">{c.quantity}</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={perUnit[i] ?? ""}
                onChange={(e) => setPerUnit((prev) => prev.map((v, idx) => (idx === i ? e.target.value : v)))}
                placeholder="0.00"
                className="w-28 justify-self-end rounded border border-neutral-200 px-2 py-1 text-right text-sm tabular-nums"
                aria-label={`Freight per unit for ${c.type}`}
              />
              <span className="w-24 text-right tabular-nums font-medium">{money(lineTotal)}</span>
            </div>
          );
        })}
        <div className="flex items-center justify-between border-t border-neutral-100 bg-neutral-50 px-2 py-1.5 text-sm">
          <span className="text-neutral-500">Total freight</span>
          <span className="font-semibold tabular-nums">{money(total)}</span>
        </div>
      </div>

      {/* Freight validity (m098) — freight is volatile; stamp an expiry. */}
      <div className="rounded border border-amber-200 bg-amber-50/40 p-2">
        <div className="mb-1 text-[11px] font-medium text-neutral-600">Freight valid until</div>
        <div className="flex flex-wrap items-center gap-2">
          {FREIGHT_VALIDITY_PERIODS.map((d) => {
            const date = validityFromPeriod(todayISO, d);
            const active = validUntil === date;
            return (
              <button
                type="button"
                key={d}
                onClick={() => setValidUntil(date)}
                className={`rounded-full border px-2.5 py-1 text-xs ${active ? "border-amber-500 bg-amber-500 text-white" : "bg-white"}`}
              >
                {d} days
              </button>
            );
          })}
          <label className="flex items-center gap-1 text-xs text-neutral-600">
            until
            <input
              type="date"
              value={validUntil}
              min={todayISO}
              onChange={(e) => setValidUntil(e.target.value)}
              className="rounded border px-2 py-1 text-sm"
            />
          </label>
          {validUntil && (
            <button type="button" onClick={() => setValidUntil("")} className="text-xs text-neutral-400 hover:text-neutral-700">
              clear
            </button>
          )}
        </div>
      </div>
      <input type="hidden" name="valid_until" value={validUntil} />

      <label className="block">
        <span className="text-[11px] text-neutral-500">Freight notes</span>
        <input name="notes" defaultValue={defaults.notes ?? ""} className="mt-0.5 w-full rounded border px-2 py-1.5 text-sm" />
      </label>
      <SubmitButton className="btn-secondary text-sm" pendingLabel="Saving…">
        {completed ? "Update freight" : "Save freight"}
      </SubmitButton>
    </form>
  );
}
