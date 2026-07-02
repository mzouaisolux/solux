"use client";

// =====================================================================
// SALES REGISTER — the editable grid ("online Excel"), premium ERP styling.
//
// Column order (sales-manager reading order): identity (frozen) → logistics →
// payment lifecycle → salesperson. Date / Country / Invoice / Client are FROZEN
// on the left; the rest scrolls horizontally under a sticky header.
//
// Width is kept COMPACT (table-fixed, ~1300px) so it fits a laptop screen, and
// the scroll container uses overscroll-x-contain so a trackpad swipe never
// triggers browser back/forward. UX only — persistence + audit unchanged.
// =====================================================================

import { useState } from "react";
import {
  updateSalesOrder,
  createSalesOrder,
  deleteSalesOrder,
  getOrderAudit,
  type NewOrderRow,
  type AuditRow,
} from "./actions";
import ClientPicker, { type PickedClient } from "./ClientPicker";

type Row = NewOrderRow;
type Saler = { id: string; name: string };
type Status = "saving" | "saved" | "error" | undefined;
type Variant = "text" | "date" | "eta" | "money";

// Compact column widths (table-fixed). Frozen = first four; left offsets are the
// running sum of the frozen widths.
const W = { date: 132, country: 112, invoice: 146, client: 208, ship: 132, eta: 112, terms: 108, pi: 114, sales: 118, transp: 108, recv: 118, bank: 100, balance: 114, saler: 126, actions: 72 };
const LEFT = { date: 0, country: W.date, invoice: W.date + W.country, client: W.date + W.country + W.invoice };
const MIN_WIDTH = Object.values(W).reduce((a, b) => a + b, 0);

function EditableCell({ initial, variant, onSave }: { initial: string | number | null; variant: Variant; onSave: (v: string | null) => void }) {
  const [v, setV] = useState(initial == null ? "" : String(initial));
  const [foc, setFoc] = useState(false);
  const original = initial == null ? "" : String(initial);
  const commit = () => { setFoc(false); if (v !== original) onSave(v.trim() === "" ? null : v.trim()); };
  const isMoney = variant === "money";
  const display = isMoney && !foc && v.trim() !== "" && Number.isFinite(Number(v))
    ? Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 2 })
    : v;
  const align = isMoney ? "text-right" : variant === "date" || variant === "eta" ? "text-center" : "text-left";
  return (
    <input
      value={display}
      onFocus={() => setFoc(true)}
      onChange={(e) => setV(isMoney ? e.target.value.replace(/\s/g, "").replace(",", ".").replace(/[^\d.-]/g, "") : e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      type={variant === "date" ? "date" : "text"}
      inputMode={isMoney ? "decimal" : undefined}
      className={`w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-[13px] tabular-nums text-neutral-800 outline-none transition-colors hover:border-neutral-200 focus:border-neutral-400 focus:bg-white ${align}`}
    />
  );
}

export default function SalesGrid({ initialRows, salers, activeYear, canDelete }: { initialRows: Row[]; salers: Saler[]; activeYear: number | null; canDelete: boolean }) {
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<{ id: string; label: string; rows: AuditRow[] | null } | null>(null);
  const [adding, setAdding] = useState(false);

  const patchRow = (id: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  async function save(id: string, patch: Record<string, string | null>, local: Partial<Row>) {
    setStatus((s) => ({ ...s, [id]: "saving" }));
    setErrs((e) => { const n = { ...e }; delete n[id]; return n; });
    const res = await updateSalesOrder(id, patch);
    if (res.ok) {
      patchRow(id, local);
      setStatus((s) => ({ ...s, [id]: "saved" }));
      setTimeout(() => setStatus((s) => ({ ...s, [id]: undefined })), 1200);
    } else {
      setStatus((s) => ({ ...s, [id]: "error" }));
      setErrs((e) => ({ ...e, [id]: res.error }));
    }
  }

  async function addRow() {
    setAdding(true);
    const res = await createSalesOrder({ year: activeYear });
    setAdding(false);
    if (res.ok) setRows((rs) => [res.row, ...rs]);
    else alert(res.error);
  }
  async function removeRow(id: string) {
    if (!confirm("Supprimer cette commande ? (action tracée)")) return;
    const res = await deleteSalesOrder(id);
    if (res.ok) setRows((rs) => rs.filter((r) => r.id !== id));
    else alert(res.error);
  }
  async function openHistory(id: string, label: string) {
    setHistory({ id, label, rows: null });
    setHistory({ id, label, rows: await getOrderAudit(id) });
  }

  const money = (r: Row, field: keyof Row) => (
    <EditableCell initial={(r[field] as number | null) ?? null} variant="money" onSave={(v) => save(r.id, { [field]: v }, { [field]: v == null ? null : Number(v) } as Partial<Row>)} />
  );
  const text = (r: Row, field: keyof Row, variant: Variant = "text") => (
    <EditableCell initial={(r[field] as string | null) ?? null} variant={variant} onSave={(v) => save(r.id, { [field]: v }, { [field]: v } as Partial<Row>)} />
  );

  const hCell = "sticky top-0 z-20 border-b border-neutral-200 bg-neutral-100 px-2 py-2 text-[11px] font-bold uppercase tracking-wide leading-[1.15] text-neutral-600 align-bottom whitespace-normal";
  const bCell = "border-b border-neutral-100 border-r border-neutral-100/60 px-2 py-2 align-middle";

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <button type="button" onClick={addRow} disabled={adding} className="rounded-lg bg-neutral-900 px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition-colors hover:bg-neutral-700 disabled:opacity-50">＋ Nouvelle commande</button>
        <span className="text-[11px] text-neutral-400">{rows.length} ligne{rows.length > 1 ? "s" : ""} · édition directe · chaque modification est tracée</span>
      </div>

      <div data-sales-grid-scroll className="relative overflow-auto overscroll-x-contain rounded-xl border border-neutral-200 bg-white shadow-sm" style={{ maxHeight: "72vh" }}>
        <table className="w-full table-fixed border-separate border-spacing-0 text-[13px]" style={{ minWidth: MIN_WIDTH }}>
          <colgroup>
            <col style={{ width: W.date }} /><col style={{ width: W.country }} /><col style={{ width: W.invoice }} /><col style={{ width: W.client }} />
            <col style={{ width: W.ship }} /><col style={{ width: W.eta }} /><col style={{ width: W.terms }} />
            <col style={{ width: W.pi }} /><col style={{ width: W.sales }} /><col style={{ width: W.transp }} /><col style={{ width: W.recv }} /><col style={{ width: W.bank }} /><col style={{ width: W.balance }} />
            <col style={{ width: W.saler }} /><col style={{ width: W.actions }} />
          </colgroup>
          <thead>
            <tr>
              <th className={`${hCell} z-30 text-center`} style={{ left: LEFT.date }}>Date</th>
              <th className={`${hCell} z-30 text-left`} style={{ left: LEFT.country }}>Pays</th>
              <th className={`${hCell} z-30 text-left`} style={{ left: LEFT.invoice }}>N° Facture</th>
              <th className={`${hCell} z-30 text-left border-r-2 border-neutral-300 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.10)]`} style={{ left: LEFT.client }}>Client</th>
              <th className={`${hCell} text-center`}>Expédition prévue</th>
              <th className={`${hCell} text-center`}>TA / ETA</th>
              <th className={`${hCell} text-left`}>Conditions</th>
              <th className={`${hCell} text-right`}>Montant PI</th>
              <th className={`${hCell} text-right`}>Ventes</th>
              <th className={`${hCell} text-right`}>Transport</th>
              <th className={`${hCell} text-right`}>Encaissé</th>
              <th className={`${hCell} text-right`}>Frais banc.</th>
              <th className={`${hCell} text-right`}>Solde dû</th>
              <th className={`${hCell} text-left`}>Vendeur</th>
              <th className={`${hCell} text-right`}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const rowBg = i % 2 === 1 ? "bg-neutral-50" : "bg-white";
              const fz = (left: number, extra = "") => ({ className: `${bCell} sticky z-10 ${rowBg} group-hover:bg-neutral-100 ${extra}`, style: { left } as React.CSSProperties });
              return (
                <tr key={r.id} className={`group ${rowBg} transition-colors hover:bg-neutral-100`}>
                  <td {...fz(LEFT.date)}>{text(r, "order_date", "date")}</td>
                  <td {...fz(LEFT.country)}>{text(r, "country")}</td>
                  <td {...fz(LEFT.invoice)}>{text(r, "pi_no")}</td>
                  <td {...fz(LEFT.client, "border-r-2 border-neutral-300 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.10)]")}>
                    <ClientPicker
                      value={r.client ? { id: r.sales_client_id as string, code: r.client.code, name: r.client.name } : null}
                      onPicked={(c: PickedClient) => save(r.id, { sales_client_id: c.id }, { sales_client_id: c.id, client: { code: c.code, name: c.name } })}
                    />
                  </td>
                  <td className={bCell}>{text(r, "shipment_date", "date")}</td>
                  <td className={bCell}>{text(r, "eta_note", "eta")}</td>
                  <td className={bCell}>{text(r, "payment_terms")}</td>
                  <td className={bCell}>{money(r, "pi_amount")}</td>
                  <td className={bCell}>{money(r, "sales_amount")}</td>
                  <td className={bCell}>{money(r, "transportation")}</td>
                  <td className={bCell}>{money(r, "received_amount")}</td>
                  <td className={bCell}>{money(r, "bank_charge")}</td>
                  <td className={bCell}>{money(r, "balance")}</td>
                  <td className={bCell}>
                    <select
                      value={r.saler_id ?? ""}
                      onChange={(e) => { const id = e.target.value || null; save(r.id, { saler_id: id }, { saler_id: id, saler: id ? { name: salers.find((s) => s.id === id)?.name ?? "" } : null }); }}
                      className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-[13px] text-neutral-800 outline-none transition-colors hover:border-neutral-200 focus:border-neutral-400 focus:bg-white"
                    >
                      <option value="">—</option>
                      {salers.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
                    </select>
                  </td>
                  <td className={`${bCell} whitespace-nowrap text-right`}>
                    <span className="mr-1 inline-block w-3 text-center align-middle">
                      {status[r.id] === "saving" && <span className="text-neutral-400" title="Enregistrement…">•</span>}
                      {status[r.id] === "saved" && <span className="text-emerald-600" title="Enregistré">✓</span>}
                      {status[r.id] === "error" && <span className="text-rose-600" title={errs[r.id]}>!</span>}
                    </span>
                    <button type="button" onClick={() => openHistory(r.id, r.pi_no || r.client?.name || r.id.slice(0, 8))} title="Historique" className="text-neutral-300 transition-colors hover:text-neutral-700">🕑</button>
                    {canDelete && <button type="button" onClick={() => removeRow(r.id)} title="Supprimer" className="ml-1.5 text-neutral-200 transition-colors hover:text-rose-600">✕</button>}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={15} className="px-3 py-8 text-center text-[12px] text-neutral-400">Aucune commande pour ce filtre. « ＋ Nouvelle commande » pour saisir.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {history && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/30 p-4" onClick={() => setHistory(null)}>
          <div className="max-h-[80vh] w-full max-w-lg overflow-auto rounded-xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-neutral-900">Historique · {history.label}</h3>
              <button type="button" onClick={() => setHistory(null)} className="text-neutral-400 hover:text-neutral-700">✕</button>
            </div>
            {history.rows == null ? (
              <div className="py-6 text-center text-[12px] text-neutral-400">…</div>
            ) : history.rows.length === 0 ? (
              <div className="py-6 text-center text-[12px] text-neutral-400">Aucune modification enregistrée.</div>
            ) : (
              <ul className="space-y-1.5 text-[12px]">
                {history.rows.map((a, i) => (
                  <li key={i} className="border-b border-neutral-100 pb-1.5">
                    <span className="text-neutral-400">{new Date(a.created_at).toLocaleString("fr-FR")}</span>{" "}
                    {a.action === "update" ? (
                      <span className="text-neutral-700"><strong>{a.field}</strong> : <span className="text-neutral-400 line-through">{a.old_value ?? "∅"}</span> → <span className="text-neutral-900">{a.new_value ?? "∅"}</span></span>
                    ) : (<span className="text-neutral-700">{a.action}</span>)}
                    <span className="ml-1 text-neutral-300">· {a.user_id ? a.user_id.slice(0, 8) : "système"}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
