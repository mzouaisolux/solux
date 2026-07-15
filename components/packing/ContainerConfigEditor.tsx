"use client";
// =====================================================================
// Container capacity editor — usable CBM is editable, versioned & audited.
// Distinguishes Theoretical vs Operational usable vs Current-calculation
// usable CBM. Every change requires a reason and is written to the audit
// trail; historical calculations keep their snapshot (m174).
// =====================================================================
import { useState, useTransition } from "react";
import { updateContainerConfig } from "@/app/(app)/packing/calculator/actions";

type Container = {
  id: string; code: string; name: string;
  internal_l_mm: number | null; internal_w_mm: number | null; internal_h_mm: number | null;
  door_w_mm: number | null; door_h_mm: number | null;
  theoretical_cbm: number | null; operational_cbm: number | null; max_payload_kg: number | null;
  safety_margin_pct: number; min_unused_reserve_cbm: number;
  applicable_cbm_min: number | null; applicable_cbm_max: number | null;
  rules_validated: boolean; validation_status: string; active: boolean; notes: string | null;
  version_no: number;
};
type Change = { code: string; field: string; old_value: string | null; new_value: string | null; reason: string | null; changed_at: string; effective_date: string | null };

const n = (v: any) => (v == null ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }));
const currentUsable = (c: Container) => {
  if (c.operational_cbm == null) return null;
  return Math.max(c.operational_cbm * (1 - (c.safety_margin_pct ?? 0) / 100) - (c.min_unused_reserve_cbm ?? 0), 0);
};

const FIELDS: [keyof Container, string, string?][] = [
  ["name", "Name", "text"],
  ["internal_l_mm", "Internal L (mm)"], ["internal_w_mm", "Internal W (mm)"], ["internal_h_mm", "Internal H (mm)"],
  ["door_w_mm", "Door W (mm)"], ["door_h_mm", "Door H (mm)"],
  ["theoretical_cbm", "Theoretical CBM"], ["operational_cbm", "Operational usable CBM"],
  ["max_payload_kg", "Max payload (kg)"], ["safety_margin_pct", "Safety margin (%)"],
  ["min_unused_reserve_cbm", "Min unused reserve (CBM)"],
  ["applicable_cbm_min", "Applicable CBM min"], ["applicable_cbm_max", "Applicable CBM max"],
];

export default function ContainerConfigEditor({ containers, changes }: { containers: Container[]; changes: Change[] }) {
  return (
    <div className="space-y-6">
      <p className="text-sm text-neutral-500">
        Usable CBM is editable and versioned. Editing here never changes historical calculations — each
        calculation snapshots the container config it used.
      </p>
      {containers.map((c) => <ContainerCard key={c.id} c={c} changes={changes.filter((ch) => ch.code === c.code)} />)}
    </div>
  );
}

function ContainerCard({ c, changes }: { c: Container; changes: Change[] }) {
  const [form, setForm] = useState<Record<string, any>>(() =>
    Object.fromEntries(FIELDS.map(([k]) => [k, (c as any)[k] ?? ""])).valueOf() as any
  );
  const [validation, setValidation] = useState(c.validation_status);
  const [active, setActive] = useState(c.active);
  const [reason, setReason] = useState("");
  const [effective, setEffective] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const usable = currentUsable(c);

  const save = () => {
    if (!reason.trim()) { setMsg("A reason is required for any capacity change."); return; }
    setMsg(null);
    const patch: Record<string, unknown> = { ...form, validation_status: validation, active };
    for (const [k, v] of Object.entries(patch)) if (v === "") patch[k] = null;
    start(async () => {
      try {
        await updateContainerConfig(c.code, patch, reason, effective || undefined);
        setMsg("Saved — audited. Reload to see the new version & audit line.");
        setReason("");
      } catch (e: any) { setMsg(e.message ?? "Save failed"); }
    });
  };

  return (
    <section className="border border-neutral-200 rounded-sm p-4">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <h2 className="font-semibold">{c.code}</h2>
        <span className="text-xs text-neutral-500">v{c.version_no}</span>
        <span className={`text-[10px] px-1.5 py-0.5 border rounded-sm ${c.rules_validated ? "border-green-300 text-green-700 bg-green-50" : "border-amber-300 text-amber-700 bg-amber-50"}`}>
          {c.rules_validated ? "rules validated" : "rules NOT validated"}
        </span>
      </div>

      {/* Three CBM distinctions */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <Cbm label="Theoretical CBM" value={n(c.theoretical_cbm)} hint="internal L×W×H" />
        <Cbm label="Operational usable CBM" value={n(c.operational_cbm)} hint="configured, real-world" />
        <Cbm label="Current-calc usable CBM" value={usable == null ? "—" : n(usable)} hint={`operational −${c.safety_margin_pct}% −${c.min_unused_reserve_cbm} reserve`} highlight />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {FIELDS.map(([k, label, type]) => (
          <label key={k as string} className="block">
            <span className="block text-[11px] text-neutral-500 mb-0.5">{label}</span>
            <input
              type={type === "text" ? "text" : "number"}
              value={form[k as string] ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, [k]: type === "text" ? e.target.value : e.target.value === "" ? "" : Number(e.target.value) }))}
              className="w-full border border-neutral-300 rounded-sm px-2 py-1 text-sm"
            />
          </label>
        ))}
        <label className="block">
          <span className="block text-[11px] text-neutral-500 mb-0.5">Validation status</span>
          <select value={validation} onChange={(e) => setValidation(e.target.value)} className="w-full border border-neutral-300 rounded-sm px-2 py-1 text-sm">
            {["draft", "needs_validation", "validated", "deprecated"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1 text-sm pt-5">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> active
        </label>
      </div>

      <div className="flex flex-wrap gap-2 items-end mt-3">
        <label className="grow min-w-[220px]">
          <span className="block text-[11px] text-neutral-500 mb-0.5">Reason for change (required)</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} className="w-full border border-neutral-300 rounded-sm px-2 py-1 text-sm" />
        </label>
        <label>
          <span className="block text-[11px] text-neutral-500 mb-0.5">Effective date</span>
          <input type="date" value={effective} onChange={(e) => setEffective(e.target.value)} className="border border-neutral-300 rounded-sm px-2 py-1 text-sm" />
        </label>
        <button onClick={save} disabled={pending} className="text-sm px-4 py-1.5 bg-neutral-900 text-white rounded-sm disabled:opacity-50">
          {pending ? "Saving…" : "Save (audited)"}
        </button>
        {msg && <span className="text-sm text-neutral-600">{msg}</span>}
      </div>

      {changes.length > 0 && (
        <details className="mt-3">
          <summary className="text-sm text-neutral-600 cursor-pointer">Audit trail ({changes.length})</summary>
          <table className="w-full text-xs mt-2">
            <thead className="text-left text-neutral-500"><tr><th>When</th><th>Field</th><th>Before</th><th>After</th><th>Reason</th></tr></thead>
            <tbody>
              {changes.map((ch, i) => (
                <tr key={i} className="border-t border-neutral-100">
                  <td className="py-1">{new Date(ch.changed_at).toLocaleString()}</td>
                  <td>{ch.field}</td>
                  <td className="text-neutral-500">{ch.old_value ?? "—"}</td>
                  <td className="font-medium">{ch.new_value ?? "—"}</td>
                  <td className="text-neutral-500">{ch.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}

function Cbm({ label, value, hint, highlight }: { label: string; value: string; hint: string; highlight?: boolean }) {
  return (
    <div className={`border rounded-sm p-2 ${highlight ? "border-green-400 bg-green-50" : "border-neutral-200"}`}>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] text-neutral-600">{label}</div>
      <div className="text-[10px] text-neutral-400">{hint}</div>
    </div>
  );
}
