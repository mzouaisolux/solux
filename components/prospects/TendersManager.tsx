"use client";

// =====================================================================
// Tender Inbox (UX refactor) — the DISCOVERY universe of the tender
// module. Mission: discover, analyse, accept or reject. Accepted
// tenders leave this screen and are worked in the Tender Pipeline
// (the EXECUTION universe — /prospects/pipeline).
//
//   • TenderViewToggle (Inbox ⇄ Pipeline) + global TenderFlowBar
//   • KPI cockpit + Countries overview + premium table
//   • Row click → TenderDrawer (professional side workspace; the table
//     stays visible behind). No more inline row expansion.
//   • Import Tenders: drag & drop JSON → preview → import. External
//     fields refresh; owner / notes / status / actions never touched.
// =====================================================================

import { useMemo, useRef, useState } from "react";
import {
  createTender,
  importTenders,
  bulkDeleteTenders,
  bulkAssignTenders,
  bulkSetTenderStatus,
  type TenderImportSummary,
} from "@/app/(app)/prospects/actions";
import { toast } from "@/components/feedback/toast-store";
import {
  COMMERCIAL_STATUS_LABEL,
  STATUS_CHIP,
  PIPELINE_STAGES,
} from "@/components/prospects/tender-status";
import {
  type TenderMRow,
  type CompanyOption,
  type OwnerOption,
  type Classification,
  needsAction,
  classify,
  CLASS_CHIP,
  daysLeft,
  money,
  compactUsd,
  inputCls,
  smallSelect,
  isNavError,
} from "@/components/prospects/tender-shared";
import { TenderDrawer } from "@/components/prospects/TenderDrawer";
import { TenderViewToggle, TenderFlowBar } from "@/components/prospects/TenderNav";

/* ------------------------- re-exports (compatibility) ---------------------- */

export { COMMERCIAL_STATUS_LABEL, STATUS_CHIP, PIPELINE_STAGES, needsAction };
export type {
  TenderDoc,
  TenderActionRow,
  TenderFollowupRow,
  ParticipantRow,
  TenderMRow,
  CompanyOption,
  OwnerOption,
} from "@/components/prospects/tender-shared";

/* ------------------------------ import modal ------------------------------ */

function ImportModal({ onClose }: { onClose: () => void }) {
  const [jsonText, setJsonText] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<TenderImportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setBusy(true);
    setPreview(null);
    try {
      const text = await file.text();
      try {
        JSON.parse(text);
      } catch {
        toast.error("This file is not valid JSON.");
        setBusy(false);
        return;
      }
      setJsonText(text);
      setFileName(file.name);
      const summary = await importTenders(text, true); // dry run = preview
      setPreview(summary);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not read the file.");
    } finally {
      setBusy(false);
    }
  }

  async function doImport() {
    if (!jsonText) return;
    setBusy(true);
    try {
      const res = await importTenders(jsonText, false);
      if (res.errors.length > 0) {
        toast.error(`Imported with ${res.errors.length} error(s) — see console.`);
        console.error("[tender import]", res.errors);
      } else {
        toast.success(`${res.created} new tender${res.created === 1 ? "" : "s"}, ${res.updated} updated`);
      }
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl ring-1 ring-black/5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="eyebrow">Import tenders</div>
            <p className="mt-1 text-xs text-neutral-500">
              JSON export from the tender-intelligence tool. Existing tenders (same title +
              buyer + closing date) are updated — your owner, notes, status and actions are
              kept untouched.
            </p>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700">✕</button>
        </div>

        <div
          className={`mt-4 flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors ${
            dragOver ? "border-solux bg-emerald-50/40" : "border-neutral-300"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void handleFile(f);
          }}
        >
          <p className="text-sm font-medium text-neutral-700">
            {fileName ?? "Drag & drop the JSON file here"}
          </p>
          <p className="mt-1 text-[12px] text-neutral-400">or</p>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="mt-2 rounded-md border border-neutral-300 px-3 py-1.5 text-[12px] font-semibold text-neutral-800 hover:bg-neutral-50"
          >
            Choose a file…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
          />
        </div>

        {busy && <p className="mt-3 text-[12px] text-neutral-500">Analyzing…</p>}

        {preview && !busy && (
          <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50/60 p-4">
            <p className="text-sm font-semibold text-neutral-900">
              {preview.total} tender{preview.total === 1 ? "" : "s"} detected
            </p>
            <ul className="mt-1.5 space-y-0.5 text-[13px]">
              <li className="text-emerald-700">{preview.created} new tender{preview.created === 1 ? "" : "s"}</li>
              <li className="text-amber-700">{preview.updated} updated tender{preview.updated === 1 ? "" : "s"}</li>
              {preview.errors.map((er, i) => (
                <li key={i} className="text-rose-700">{er}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded border border-neutral-200 px-3 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-50"
          >
            Cancel
          </button>
          <button
            onClick={() => void doImport()}
            disabled={!preview || preview.total === 0 || busy}
            className="rounded-md bg-solux px-3.5 py-1.5 text-[12px] font-semibold text-white hover:bg-solux-dark disabled:opacity-40"
          >
            Import
          </button>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- main ----------------------------------- */

// The inbox TABLE only shows undecided / dead tenders (New, Rejected,
// Lost). Accepted ones live in the Tender Pipeline.
const INBOX_STATUSES = new Set(["new", "rejected", "lost"]);

export function TendersManager({
  tenders,
  clients,
  prospects,
  owners,
  ownerLabels,
  currentUserId,
}: {
  tenders: TenderMRow[];
  clients: CompanyOption[];
  prospects: CompanyOption[];
  owners: OwnerOption[];
  ownerLabels: Record<string, string>;
  currentUserId: string | null;
}) {
  const [q, setQ] = useState("");
  const [fClass, setFClass] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fOwner, setFOwner] = useState("");
  const [fCountry, setFCountry] = useState("");
  const [sort, setSort] = useState("closing");
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  // Bulk selection — imports generate many irrelevant tenders.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const ownerName = (id: string | null) => (id ? ownerLabels[id] ?? `user·${id.slice(0, 6)}` : null);

  // ---- Management overview (cockpit KPIs) ----
  const kpi = useMemo(() => {
    const live = tenders.filter(
      (t) => !["rejected", "lost", "opportunity_created"].includes(t.commercial_status)
    );
    const scored = tenders.filter((t) => t.score != null);
    const by = (s: string) => tenders.filter((t) => t.commercial_status === s).length;
    const converted = tenders.filter((t) => t.commercial_status === "opportunity_created");
    return {
      total: tenders.length,
      priority: tenders.filter((t) => classify(t.score) === "priority").length,
      closingWeek: live.filter((t) => {
        const d = daysLeft(t.deadline);
        return d != null && d >= 0 && d <= 7;
      }).length,
      // Pipeline = normalized USD budgets of live tenders.
      pipeline: live.reduce((s, t) => s + (t.budget_usd ?? 0), 0),
      avgScore: scored.length
        ? Math.round(scored.reduce((s, t) => s + (t.score ?? 0), 0) / scored.length)
        : null,
      needsAction: tenders.filter(needsAction).length,
      pNew: by("new"),
      pConverted: converted.length,
    };
  }, [tenders]);

  // ---- Country Intelligence — per-country volume / urgency / value ----
  const countryStats = useMemo(() => {
    const map = new Map<string, { count: number; priority: number; pipeline: number }>();
    for (const t of tenders) {
      const c = t.country ?? "Unknown";
      const s = map.get(c) ?? { count: 0, priority: 0, pipeline: 0 };
      s.count += 1;
      if (classify(t.score) === "priority") s.priority += 1;
      if (!["won", "lost"].includes(t.commercial_status)) s.pipeline += t.budget_usd ?? 0;
      map.set(c, s);
    }
    return [...map.entries()].sort((a, b) => b[1].count - a[1].count);
  }, [tenders]);

  const ownersInData = useMemo(
    () => [...new Set(tenders.map((t) => t.owner_id).filter(Boolean) as string[])],
    [tenders]
  );

  // ---- search / filters / sort ----
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    let list = tenders.filter((t) => {
      if (!INBOX_STATUSES.has(t.commercial_status)) return false;
      if (term) {
        const hay = [t.title, t.buyer, t.country, t.city, t.reference, t.platform]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(term)) return false;
      }
      if (fClass && classify(t.score) !== fClass) return false;
      if (fStatus && t.commercial_status !== fStatus) return false;
      if (fOwner && t.owner_id !== fOwner) return false;
      if (fCountry && t.country !== fCountry) return false;
      return true;
    });
    list = list.slice().sort((a, b) => {
      switch (sort) {
        case "score":
          return (b.score ?? -1) - (a.score ?? -1);
        case "budget":
          return (b.budget_usd ?? b.value ?? 0) - (a.budget_usd ?? a.value ?? 0);
        case "title":
          return a.title.localeCompare(b.title);
        default: {
          // closing date asc, null/closed last
          const da = a.deadline ?? "9999-99-99";
          const db = b.deadline ?? "9999-99-99";
          return da.localeCompare(db);
        }
      }
    });
    return list;
  }, [tenders, q, fClass, fStatus, fOwner, fCountry, sort]);

  // ---- bulk helpers ----
  const visibleIds = rows.map((r) => r.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const toggleAll = () =>
    setSelected(allVisibleSelected ? new Set() : new Set(visibleIds));
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectedIdsJson = JSON.stringify([...selected]);
  const exportSelectedCsv = () => {
    const cols = [
      "title", "type", "country", "city", "buyer", "platform", "reference",
      "publication_date", "deadline", "score", "relevance", "value", "currency",
      "budget_usd", "commercial_status", "contact_name", "contact_email",
      "contact_phone", "source_url",
    ] as const;
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [
      cols.join(","),
      ...tenders
        .filter((t) => selected.has(t.id))
        .map((t) => cols.map((c) => esc((t as any)[c])).join(",")),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tenders-export.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const act = async (fn: (fd: FormData) => Promise<void>, fd: FormData, ok?: string) => {
    try {
      await fn(fd);
      if (ok) toast.success(ok);
    } catch (e: any) {
      if (isNavError(e)) throw e;
      toast.error(e?.message ?? "Action failed.");
    }
  };

  // The drawer reads from the FULL list (not the inbox-filtered rows) so it
  // stays open when an accepted tender leaves the table — that is the
  // hand-over moment to the Pipeline.
  const drawerTender = drawerId ? tenders.find((t) => t.id === drawerId) ?? null : null;

  return (
    <section className="panel p-5 space-y-4">
      {/* ===== TWO UNIVERSES — compact switch + global progression ===== */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TenderViewToggle active="inbox" tenders={tenders} />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setImporting(true)}
            className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-neutral-800 hover:bg-neutral-50"
          >
            ⇪ Import Tenders
          </button>
          {!adding && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="rounded-md bg-solux px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-solux-dark"
            >
              + Add tender
            </button>
          )}
        </div>
      </div>
      <TenderFlowBar active="inbox" tenders={tenders} />

      <div>
        <div className="eyebrow">Tender Inbox — discovery</div>
        <p className="mt-0.5 text-[12px] text-neutral-500">
          Discover, analyse, then decide: Accept (the dossier moves to the Tender Pipeline)
          or Reject (reason + comment). Result tenders feed competitor intel.
        </p>
      </div>

      {/* MANAGEMENT OVERVIEW — the 5-second read for a sales director. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-lg border border-neutral-200 bg-white p-3">
          <div className="eyebrow">Total tenders</div>
          <div className="text-2xl font-bold text-neutral-900 tabular-nums">{kpi.total}</div>
        </div>
        <div className={`rounded-lg border bg-white p-3 ${kpi.priority ? "border-emerald-200" : "border-neutral-200"}`}>
          <div className="eyebrow">Priority</div>
          <div className="text-2xl font-bold text-emerald-700 tabular-nums">{kpi.priority}</div>
          <div className="text-[10px] text-neutral-400">score ≥ 80</div>
        </div>
        <div className={`rounded-lg border bg-white p-3 ${kpi.closingWeek ? "border-rose-200" : "border-neutral-200"}`}>
          <div className="eyebrow">Closing &lt; 7 days</div>
          <div className={`text-2xl font-bold tabular-nums ${kpi.closingWeek ? "text-rose-700" : "text-neutral-900"}`}>
            {kpi.closingWeek}
          </div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-3">
          <div className="eyebrow">Total pipeline</div>
          <div className="text-2xl font-bold text-neutral-900 tabular-nums">
            {kpi.pipeline > 0 ? compactUsd(kpi.pipeline) : "—"}
          </div>
          <div className="text-[10px] text-neutral-400">live tenders · USD</div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-3">
          <div className="eyebrow">Average score</div>
          <div className="text-2xl font-bold text-neutral-900 tabular-nums">
            {kpi.avgScore ?? "—"}
          </div>
        </div>
        <div className={`rounded-lg border bg-white p-3 ${kpi.needsAction ? "border-rose-300" : "border-neutral-200"}`}>
          <div className={`eyebrow ${kpi.needsAction ? "text-rose-700" : ""}`}>⚠ Needs action</div>
          <div className={`text-2xl font-bold tabular-nums ${kpi.needsAction ? "text-rose-700" : "text-neutral-900"}`}>
            {kpi.needsAction}
          </div>
          <div className="text-[10px] text-neutral-400">accepted, no next step</div>
        </div>
      </div>

      {/* COUNTRIES OVERVIEW — country intelligence, one click = one filter. */}
      {countryStats.length > 0 && (
        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-700">
              Countries overview
            </div>
            {fCountry && (
              <button
                type="button"
                onClick={() => setFCountry("")}
                className="text-[11px] font-semibold text-neutral-500 underline decoration-dotted underline-offset-2 hover:text-neutral-900"
              >
                ← All countries
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setFCountry("")}
              className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                fCountry === ""
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : "border-neutral-200 bg-white hover:border-neutral-400"
              }`}
            >
              <div className="flex items-baseline gap-2.5">
                <span className="text-[12px] font-semibold">All countries</span>
                <span className="text-lg font-bold tabular-nums">{kpi.total}</span>
              </div>
              <div className={`text-[10px] ${fCountry === "" ? "text-white/70" : "text-neutral-500"}`}>
                {kpi.priority} priority{kpi.pipeline > 0 ? ` · ${compactUsd(kpi.pipeline)}` : ""}
              </div>
            </button>
            {countryStats.map(([c, s]) => {
              const active = fCountry === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setFCountry(active ? "" : c)}
                  className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                    active
                      ? "border-neutral-900 bg-neutral-900 text-white"
                      : "border-neutral-200 bg-white hover:border-neutral-400"
                  }`}
                >
                  <div className="flex items-baseline gap-2.5">
                    <span className="text-[12px] font-semibold">{c}</span>
                    <span className="text-lg font-bold tabular-nums">{s.count}</span>
                  </div>
                  <div className={`text-[10px] ${active ? "text-white/70" : "text-neutral-500"}`}>
                    {s.priority} priority{s.pipeline > 0 ? ` · ${compactUsd(s.pipeline)}` : ""}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* add form (manual entry stays possible) */}
      {adding && (
        <form
          action={async (fd) => {
            await act(createTender, fd, "Tender added");
            setAdding(false);
          }}
          className="rounded-lg border border-neutral-200 bg-neutral-50/60 p-3 space-y-2"
        >
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <label className="block">
              <span className="text-[11px] text-neutral-500">Type *</span>
              <select name="type" className={inputCls} defaultValue="open">
                <option value="open">Open — to defend</option>
                <option value="result">Result — competitor intel</option>
              </select>
            </label>
            <label className="block md:col-span-2">
              <span className="text-[11px] text-neutral-500">Title *</span>
              <input name="title" required autoFocus className={inputCls} />
            </label>
            <label className="block">
              <span className="text-[11px] text-neutral-500">Reference</span>
              <input name="reference" className={inputCls} />
            </label>
            <label className="block">
              <span className="text-[11px] text-neutral-500">Country</span>
              <input name="country" className={inputCls} />
            </label>
            <label className="block">
              <span className="text-[11px] text-neutral-500">Closing date</span>
              <input name="deadline" type="date" className={inputCls} />
            </label>
            <label className="block">
              <span className="text-[11px] text-neutral-500">Value (USD)</span>
              <input name="value" type="number" min={0} step="0.01" className={inputCls} />
            </label>
            <label className="block md:col-span-2">
              <span className="text-[11px] text-neutral-500">Notes</span>
              <input name="notes" className={inputCls} />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setAdding(false)} className="rounded border border-neutral-200 px-2.5 py-1 text-[11px] text-neutral-600 hover:bg-neutral-50">
              Cancel
            </button>
            <button className="rounded-md bg-solux px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-solux-dark">
              Add tender
            </button>
          </div>
        </form>
      )}

      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search — title, buyer, country, reference…"
          className="min-w-[220px] flex-1 rounded-md border border-neutral-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-200"
        />
        <select className={smallSelect} value={fClass} onChange={(e) => setFClass(e.target.value)}>
          <option value="">All classifications</option>
          <option value="priority">Priority (≥80)</option>
          <option value="to_qualify">To Qualify (60–79)</option>
          <option value="watchlist">Watchlist (&lt;60)</option>
        </select>
        <select className={smallSelect} value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option value="">Any status</option>
          {/* The inbox only holds discovery statuses. */}
          {["new", "rejected", "lost"].map((v) => (
            <option key={v} value={v}>{COMMERCIAL_STATUS_LABEL[v]}</option>
          ))}
        </select>
        {ownersInData.length > 0 && (
          <select className={smallSelect} value={fOwner} onChange={(e) => setFOwner(e.target.value)}>
            <option value="">All owners</option>
            {ownersInData.map((id) => (
              <option key={id} value={id}>{ownerName(id)}</option>
            ))}
          </select>
        )}
        <select className={smallSelect} value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="closing">Closing date ↑</option>
          <option value="score">Score ↓</option>
          <option value="budget">Budget ↓</option>
          <option value="title">Title A–Z</option>
        </select>
      </div>

      {/* BULK ACTIONS bar — appears when rows are selected. */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2">
          <span className="text-[12px] font-semibold text-neutral-800">
            {selected.size} selected
          </span>
          {owners.length > 0 && (
            <form
              action={async (fd) => {
                await act(bulkAssignTenders, fd, "Owner assigned");
                setSelected(new Set());
              }}
              className="flex items-center gap-1"
            >
              <input type="hidden" name="ids" value={selectedIdsJson} />
              <select name="owner_id" className={smallSelect} defaultValue="">
                <option value="" disabled>Assign owner…</option>
                <option value="__unassign__">— Unassign —</option>
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
              <button className="rounded border border-neutral-300 px-2 py-0.5 text-[11px] font-semibold text-neutral-800 hover:bg-white">
                Assign
              </button>
            </form>
          )}
          <form
            action={async (fd) => {
              await act(bulkSetTenderStatus, fd, "Status updated");
              setSelected(new Set());
            }}
            className="flex items-center gap-1"
          >
            <input type="hidden" name="ids" value={selectedIdsJson} />
            <select name="commercial_status" className={smallSelect} defaultValue="">
              <option value="" disabled>Change status…</option>
              {/* Partner Identified only via partner attachment; Opportunity
                  Created only via Convert — never hand-picked. */}
              {Object.entries(COMMERCIAL_STATUS_LABEL)
                .filter(([v]) => v !== "partner_assigned" && v !== "opportunity_created")
                .map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
            </select>
            <button className="rounded border border-neutral-300 px-2 py-0.5 text-[11px] font-semibold text-neutral-800 hover:bg-white">
              Apply
            </button>
          </form>
          <button
            type="button"
            onClick={exportSelectedCsv}
            className="rounded border border-neutral-300 px-2 py-0.5 text-[11px] font-semibold text-neutral-800 hover:bg-white"
          >
            Export CSV
          </button>
          <form
            action={async (fd) => {
              if (!window.confirm(`Delete ${selected.size} tender(s)? This cannot be undone.`)) return;
              await act(bulkDeleteTenders, fd, "Tenders deleted");
              setSelected(new Set());
            }}
          >
            <input type="hidden" name="ids" value={selectedIdsJson} />
            <button className="rounded border border-rose-200 px-2 py-0.5 text-[11px] font-semibold text-rose-700 hover:bg-rose-50">
              Delete
            </button>
          </form>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="ml-auto text-[11px] text-neutral-500 hover:text-neutral-800"
          >
            Clear selection
          </button>
        </div>
      )}

      {/* main table — row click opens the side drawer (context preserved). */}
      {rows.length === 0 ? (
        <p className="text-[12px] text-neutral-400">No tenders match.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-neutral-200 bg-neutral-50 text-left text-[12px] font-bold uppercase tracking-wide text-neutral-700">
                <th className="w-8 px-2 py-2.5">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAll}
                    aria-label="Select all"
                  />
                </th>
                <th className="px-2 py-2.5">Tender</th>
                <th className="px-2 py-2.5">Country</th>
                <th className="px-2 py-2.5">Buyer</th>
                <th className="px-2 py-2.5">Closing Date</th>
                <th className="px-2 py-2.5">Days Left</th>
                <th className="px-2 py-2.5">Budget</th>
                <th className="px-2 py-2.5">Score</th>
                <th className="px-2 py-2.5">Owner</th>
                <th className="px-2 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {rows.map((t) => {
                const dl = daysLeft(t.deadline);
                const urgent = dl != null && dl >= 0 && dl < 7 && !["won", "lost"].includes(t.commercial_status);
                const cls = classify(t.score);
                return (
                  <Row
                    key={t.id}
                    t={t}
                    dl={dl}
                    urgent={urgent}
                    cls={cls}
                    onOpen={() => setDrawerId(t.id)}
                    checked={selected.has(t.id)}
                    onCheck={() => toggleOne(t.id)}
                    ownerName={ownerName}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {importing && <ImportModal onClose={() => setImporting(false)} />}

      {drawerTender && (
        <TenderDrawer
          t={drawerTender}
          context="inbox"
          owners={owners}
          ownerLabels={ownerLabels}
          currentUserId={currentUserId}
          clients={clients}
          prospects={prospects}
          act={act}
          onClose={() => setDrawerId(null)}
        />
      )}
    </section>
  );
}

/* --------------------------------- row ------------------------------------ */

function Row({
  t,
  dl,
  urgent,
  cls,
  onOpen,
  checked,
  onCheck,
  ownerName,
}: {
  t: TenderMRow;
  dl: number | null;
  urgent: boolean;
  cls: Classification;
  onOpen: () => void;
  checked: boolean;
  onCheck: () => void;
  ownerName: (id: string | null) => string | null;
}) {
  return (
    <tr className="cursor-pointer hover:bg-neutral-50" onClick={onOpen}>
      <td className="w-8 px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={checked} onChange={onCheck} aria-label="Select tender" />
      </td>
      {/* TENDER — the dominant element of the row: big semi-bold title,
          secondary reference/platform line below. */}
      <td className="px-2 py-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold leading-snug text-neutral-900">
              {t.title}
            </span>
            {urgent && (
              <span className="rounded bg-rose-600 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">
                Closing &lt; 7d
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[11.5px] text-neutral-500">
            <span className="mr-1.5 rounded bg-neutral-100 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-neutral-500">
              {t.type}
            </span>
            {[t.reference, t.platform, t.city].filter(Boolean).join(" · ") || "—"}
          </div>
        </div>
      </td>
      <td className="px-2 py-2.5 text-neutral-600">{t.country ?? "—"}</td>
      <td className="px-2 py-2.5 text-neutral-600">{t.buyer ?? "—"}</td>
      <td className="px-2 py-2.5 tabular-nums text-neutral-600">{t.deadline ?? "—"}</td>
      <td className={`px-2 py-2.5 tabular-nums font-semibold ${urgent ? "text-rose-700" : dl != null && dl < 0 ? "text-neutral-400" : "text-neutral-700"}`}>
        {dl == null ? "—" : dl < 0 ? "closed" : `${dl}d`}
      </td>
      <td className="px-2 py-2.5 tabular-nums text-neutral-600">
        {t.budget_usd != null ? `$${money(t.budget_usd)}` : money(t.value, t.currency)}
      </td>
      <td className="px-2 py-2.5">
        {t.score != null ? (
          <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ring-1 tabular-nums ${CLASS_CHIP[cls]}`}>
            {t.score}
          </span>
        ) : (
          "—"
        )}
      </td>
      <td className="px-2 py-2.5 text-neutral-600">{ownerName(t.owner_id) ?? "—"}</td>
      <td className="px-2 py-2.5">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${STATUS_CHIP[t.commercial_status] ?? STATUS_CHIP.new}`}>
          {COMMERCIAL_STATUS_LABEL[t.commercial_status] ?? t.commercial_status}
        </span>
      </td>
    </tr>
  );
}
