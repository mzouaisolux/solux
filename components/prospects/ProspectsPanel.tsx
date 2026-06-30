"use client";

// =====================================================================
// PROSPECT COMPANIES — V2 (m116): the commercial-discovery database.
//
// Tender attributions feed this list automatically (winners +
// participants, deduplicated on name_key). The panel is the Lead
// Manager's cockpit:
//   • KPIs + Lead Queue filters (unassigned / new / missing email-phone-
//     linkedin / to enrich)
//   • table with tender stats + Tender Activity Score (prioritisation)
//   • individual + BULK assignment
//   • company drawer: profile (enrichment), Tender Intelligence
//     (lifetime history), Commercial Activities (the official status
//     rule: outbound → contacted, REPLY → lead), notes, merge.
//
// Critical rules live server-side (actions.ts); this panel only renders
// and submits. Design system: existing neutral tailwind idiom only.
// =====================================================================

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  createProspect,
  setProspectStatus,
  deleteProspect,
  convertProspectToClient,
  assignProspect,
  bulkAssignProspects,
  logProspectActivity,
  updateProspectCompany,
  mergeProspects,
  importProspectCompanies,
  importTenderAttributions,
  type ProspectImportSummary,
  type AttributionImportSummary,
} from "@/app/(app)/prospects/actions";
import type {
  ProspectTenderHistoryRow,
  ProspectActivityRow,
} from "@/app/(app)/prospects/tenders-data";
import {
  tenderActivityScore,
  PROSPECT_STATUS_LABEL,
  PROSPECT_STATUSES_V2,
} from "@/lib/prospect-intel";
import { toast } from "@/components/feedback/toast-store";

export type ProspectRow = {
  id: string;
  company_name: string;
  country: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  source: string;
  status: string;
  converted_client_id: string | null;
  source_tender_id: string | null;
  owner_id?: string | null;
  // m116 — prospect intelligence fields (optional pre-migration)
  address?: string | null;
  website?: string | null;
  linkedin_url?: string | null;
  leader_name?: string | null;
  leader_role?: string | null;
  last_activity_at?: string | null;
  tender_participations?: number;
  tender_wins?: number;
  last_tender_participation_at?: string | null;
  last_tender_win_at?: string | null;
};

export type OwnerOpt = { id: string; name: string };

const STATUS_STYLE: Record<string, string> = {
  new: "bg-sky-50 text-sky-700 ring-sky-200",
  assigned: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  contacted: "bg-amber-50 text-amber-700 ring-amber-200",
  lead: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  opportunity: "bg-emerald-100 text-emerald-800 ring-emerald-300",
  customer: "bg-neutral-900 text-white ring-neutral-900",
  rejected: "bg-neutral-100 text-neutral-400 ring-neutral-200",
  blacklisted: "bg-rose-50 text-rose-600 ring-rose-200",
};

const SOURCE_LABEL: Record<string, string> = {
  manual: "Manual",
  import: "Import",
  tender: "Tender",
  tender_attribution: "Attribution",
  linkedin: "LinkedIn",
  salon: "Trade show",
};

const ACTIVITY_KINDS = [
  { value: "email", label: "Email" },
  { value: "call", label: "Call" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "meeting", label: "Meeting" },
  { value: "note", label: "Note" },
] as const;

type QueueFilter =
  | "all"
  | "unassigned"
  | "new"
  | "no_email"
  | "no_phone"
  | "no_linkedin"
  | "to_enrich";

const QUEUE_FILTERS: Array<{ key: QueueFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "unassigned", label: "Unassigned" },
  { key: "new", label: "New" },
  { key: "no_email", label: "No email" },
  { key: "no_phone", label: "No phone" },
  { key: "no_linkedin", label: "No LinkedIn" },
  { key: "to_enrich", label: "To enrich" },
];

function isNavError(e: any): boolean {
  const d = e?.digest;
  return typeof d === "string" && (d.startsWith("NEXT_REDIRECT") || d.startsWith("NEXT_NOT_FOUND"));
}

function scoreOf(p: ProspectRow): number {
  return tenderActivityScore({
    participations: p.tender_participations ?? 0,
    wins: p.tender_wins ?? 0,
    lastParticipationAt: p.last_tender_participation_at ?? null,
  });
}

function fmtD(iso: string | null | undefined): string {
  if (!iso) return "—";
  return String(iso).slice(0, 10);
}

const inputCls =
  "mt-0.5 w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-200";

export function ProspectsPanel({
  prospects,
  owners,
  ownerLabels,
  historyByProspect,
  activitiesByProspect,
  initialOpenId = null,
  canImportAttributions = false,
}: {
  prospects: ProspectRow[];
  owners: OwnerOpt[];
  ownerLabels: Record<string, string>;
  historyByProspect: Record<string, ProspectTenderHistoryRow[]>;
  activitiesByProspect: Record<string, ProspectActivityRow[]>;
  /** Deep link (?open=<id>) — e.g. "Open company profile" from a project. */
  initialOpenId?: string | null;
  /** Admin only — attribution files are rejected here otherwise (role
   *  separation, owner ruling 2026-06-13). Companies imports stay open. */
  canImportAttributions?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [queue, setQueue] = useState<QueueFilter>("all");
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const [bulkOwner, setBulkOwner] = useState<string>("");
  // ---- companies JSON import (Prospects-side, in place) ----
  // SMART: the picker also recognizes a tender-ATTRIBUTIONS file
  // ({ projets: [...] }) and routes it through the attribution importer —
  // winners & participants still become companies right here. Users
  // shouldn't have to know which button matches which file.
  const importRef = useRef<HTMLInputElement>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importPreview, setImportPreview] = useState<
    | { mode: "companies"; sum: ProspectImportSummary }
    | { mode: "attributions"; sum: AttributionImportSummary }
    | null
  >(null);
  const [importJson, setImportJson] = useState<string | null>(null);
  // Post-confirm failures must be IMPOSSIBLE to miss (the original bug:
  // server-side insert errors were collected but never displayed —
  // a "ghost success" toast while 0 rows were written).
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const router = useRouter();

  function detectImportMode(text: string): "companies" | "attributions" {
    try {
      const peek = JSON.parse(text);
      if (
        peek &&
        !Array.isArray(peek) &&
        (Array.isArray(peek.projets) ||
          Array.isArray(peek.attributions) ||
          Array.isArray(peek.resultats))
      ) {
        return "attributions";
      }
    } catch {
      /* invalid JSON — let the server action report it cleanly */
    }
    return "companies";
  }

  async function handleImportFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setImportBusy(true);
    setImportPreview(null);
    try {
      const text = await file.text();
      const mode = detectImportMode(text);
      if (mode === "attributions") {
        if (!canImportAttributions) {
          toast.error(
            "This is a tender attributions file — imports are managed by admins. Ask an admin to import it from the Projects tab."
          );
          return;
        }
        const dry = await importTenderAttributions(text, true);
        if (dry.attributions === 0) {
          toast.error(dry.errors[0] ?? "Nothing to import.");
        } else {
          setImportPreview({ mode, sum: dry });
          setImportJson(text);
        }
      } else {
        const dry = await importProspectCompanies(text, true);
        if (dry.total === 0) {
          toast.error(dry.errors[0] ?? "Nothing to import.");
        } else {
          setImportPreview({ mode, sum: dry });
          setImportJson(text);
        }
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Could not read the file.");
    } finally {
      setImportBusy(false);
      if (importRef.current) importRef.current.value = "";
    }
  }

  async function confirmImport() {
    if (!importJson || !importPreview) return;
    setImportBusy(true);
    setImportErrors([]);
    try {
      if (importPreview.mode === "attributions") {
        const res = await importTenderAttributions(importJson, false);
        if (res.errors.length > 0) {
          setImportErrors([
            ...res.errors,
            `Database currently holds ${res.dbAttributionsTotal ?? "?"} attribution projects.`,
          ]);
          toast.error(res.errors[0]);
        }
        if (res.attributions > 0 && res.errors.length === 0) {
          toast.success(
            `${res.attributions} projects imported successfully (${res.participants} companies, ${res.contactsFound} contacts)`
          );
          // The projects live HERE in the Prospects universe (owner
          // ruling 2026-06-13: attributions are PROSPECTION, not open
          // tenders) — land on the Projects tab right below.
          router.push("/prospects?u=prospects&p=projects");
        }
      } else {
        const res = await importProspectCompanies(importJson, false);
        if (res.errors.length > 0) {
          setImportErrors(res.errors);
          toast.error(res.errors[0]);
        }
        if (res.created > 0 || res.enriched > 0) {
          toast.success(
            `${res.created} companies imported successfully (${res.enriched} enriched)`
          );
        }
      }
      setImportPreview(null);
      setImportJson(null);
      // Belt-and-braces: revalidatePath runs server-side, this refresh
      // guarantees the list + counters repaint immediately.
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Import failed.");
    } finally {
      setImportBusy(false);
    }
  }

  const open = openId ? prospects.find((p) => p.id === openId) ?? null : null;

  // ---- KPI strip ----
  const kpi = useMemo(() => {
    const c = { total: prospects.length, unassigned: 0, news: 0, contacted: 0, leads: 0, opps: 0 };
    for (const p of prospects) {
      if (!p.owner_id) c.unassigned++;
      if (p.status === "new") c.news++;
      if (p.status === "contacted") c.contacted++;
      if (p.status === "lead") c.leads++;
      if (p.status === "opportunity") c.opps++;
    }
    return c;
  }, [prospects]);

  // ---- Lead Queue + filters ----
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return prospects
      .filter((p) => {
        if (statusFilter === "active") {
          if (["customer", "rejected", "blacklisted"].includes(p.status)) return false;
        } else if (statusFilter !== "all" && p.status !== statusFilter) return false;
        switch (queue) {
          case "unassigned":
            return !p.owner_id;
          case "new":
            return p.status === "new";
          case "no_email":
            return !p.email;
          case "no_phone":
            return !p.phone;
          case "no_linkedin":
            return !p.linkedin_url;
          case "to_enrich":
            return !p.email || !p.phone;
          default:
            return true;
        }
      })
      .filter(
        (p) =>
          !q ||
          p.company_name.toLowerCase().includes(q) ||
          (p.country ?? "").toLowerCase().includes(q) ||
          (p.contact_name ?? "").toLowerCase().includes(q)
      )
      .sort((a, b) => scoreOf(b) - scoreOf(a) || a.company_name.localeCompare(b.company_name));
  }, [prospects, queue, statusFilter, search]);

  const allVisibleSelected = filtered.length > 0 && filtered.every((p) => selected.has(p.id));
  const toggleAll = () =>
    setSelected(allVisibleSelected ? new Set() : new Set(filtered.map((p) => p.id)));
  const toggleOne = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <section className="panel p-5 space-y-4">
      {/* ---- header + KPIs ---- */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="eyebrow">Prospect companies</div>
          <p className="mt-0.5 text-[12px] text-neutral-500">
            The commercial-discovery database — fed automatically by tender attributions
            (winners &amp; participants), trade shows, LinkedIn and manual entries. One company,
            one record.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <input
            ref={importRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => handleImportFile(e.target.files)}
          />
          <button
            type="button"
            disabled={importBusy}
            onClick={() => importRef.current?.click()}
            title="Import a JSON list of companies (LinkedIn export, trade-show list…). Deduplicated — existing companies get enriched, never duplicated."
            className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            {importBusy ? "Working…" : "⬆ Import companies (JSON)"}
          </button>
          {!adding && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="rounded-md bg-solux px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-solux-dark"
            >
              + Add company
            </button>
          )}
        </div>
      </div>

      {/* import dry-run preview → confirm */}
      {importPreview && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2 text-[12px] text-neutral-700">
          {importPreview.mode === "attributions" ? (
            <span>
              <b>Tender attributions file detected</b> — {importPreview.sum.attributions}{" "}
              projects · {importPreview.sum.participants} companies ·{" "}
              {importPreview.sum.contactsFound} contacts. After import you&apos;ll land on the
              Projects view to assign them and pick which companies become prospects.
            </span>
          ) : (
            <span>
              Ready to import: <b>{importPreview.sum.total}</b> companies —{" "}
              <b>{importPreview.sum.created}</b> new · {importPreview.sum.enriched} already known
              (will be enriched, never duplicated)
            </span>
          )}
          {importPreview.sum.errors.length > 0 && (
            <span className="text-amber-700">
              {importPreview.sum.errors.length} item(s) skipped
            </span>
          )}
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={() => {
                setImportPreview(null);
                setImportJson(null);
              }}
              className="rounded border border-neutral-200 px-2 py-0.5 text-[11px]"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={importBusy}
              onClick={confirmImport}
              className="rounded-md bg-neutral-900 px-2.5 py-0.5 text-[11px] font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              Confirm import
            </button>
          </div>
        </div>
      )}

      {/* import failures — impossible to miss, with the real DB errors */}
      {importErrors.length > 0 && (
        <div className="rounded-lg border border-rose-200 bg-rose-50/70 px-3 py-2 text-[12px] text-rose-700">
          <div className="flex items-center justify-between gap-3">
            <b>Import problem — nothing (or only part) was written:</b>
            <button
              type="button"
              onClick={() => setImportErrors([])}
              className="text-rose-500 hover:text-rose-700"
            >
              ✕
            </button>
          </div>
          <ul className="ml-4 mt-1 list-disc">
            {importErrors.slice(0, 5).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
        {(
          [
            ["Companies", kpi.total],
            ["Unassigned", kpi.unassigned],
            ["New", kpi.news],
            ["Contacted", kpi.contacted],
            ["Leads", kpi.leads],
            ["Opportunities", kpi.opps],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="rounded-lg border border-neutral-200 px-3 py-2">
            <div className="text-lg font-semibold tabular-nums text-neutral-900">{value}</div>
            <div className="text-[10px] uppercase tracking-wider text-neutral-400">{label}</div>
          </div>
        ))}
      </div>

      {/* ---- add form ---- */}
      {adding && (
        <form
          action={async (fd) => {
            try {
              await createProspect(fd);
              toast.success("Company added");
              setAdding(false);
            } catch (e: any) {
              toast.error(e?.message ?? "Could not add the company.");
            }
          }}
          className="rounded-lg border border-neutral-200 bg-neutral-50/60 p-3 space-y-2"
        >
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <label className="block">
              <span className="text-[11px] text-neutral-500">Company *</span>
              <input name="company_name" required autoFocus className={inputCls} />
            </label>
            <label className="block">
              <span className="text-[11px] text-neutral-500">Country</span>
              <input name="country" className={inputCls} />
            </label>
            <label className="block">
              <span className="text-[11px] text-neutral-500">Contact person</span>
              <input name="contact_name" className={inputCls} />
            </label>
            <label className="block">
              <span className="text-[11px] text-neutral-500">Email</span>
              <input name="email" type="email" className={inputCls} />
            </label>
            <label className="block">
              <span className="text-[11px] text-neutral-500">Phone</span>
              <input name="phone" className={inputCls} />
            </label>
            <label className="block">
              <span className="text-[11px] text-neutral-500">Notes</span>
              <input name="notes" className={inputCls} />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="rounded border border-neutral-200 px-2.5 py-1 text-[11px] text-neutral-600 hover:bg-neutral-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-md bg-solux px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-solux-dark"
            >
              Add company
            </button>
          </div>
        </form>
      )}

      {/* ---- Lead Queue filters + search + status scope ---- */}
      <div className="flex flex-wrap items-center gap-2">
        {QUEUE_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setQueue(f.key)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 transition-colors ${
              queue === f.key
                ? "bg-neutral-900 text-white ring-neutral-900"
                : "bg-white text-neutral-600 ring-neutral-200 hover:bg-neutral-50"
            }`}
          >
            {f.label}
          </button>
        ))}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="ml-auto rounded border border-neutral-200 px-1.5 py-1 text-[11px] text-neutral-700"
        >
          <option value="active">Active statuses</option>
          <option value="all">All statuses</option>
          {PROSPECT_STATUSES_V2.map((s) => (
            <option key={s} value={s}>
              {PROSPECT_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search company / country…"
          className="w-48 rounded-md border border-neutral-200 px-2.5 py-1 text-[12px]"
        />
      </div>

      {/* ---- bulk assignment bar ---- */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2">
          <span className="text-[12px] font-semibold text-neutral-700">
            {selected.size} selected
          </span>
          <select
            value={bulkOwner}
            onChange={(e) => setBulkOwner(e.target.value)}
            className="rounded border border-neutral-200 px-1.5 py-1 text-[12px]"
          >
            <option value="">Assign to…</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <form
            action={async (fd) => {
              try {
                await bulkAssignProspects(fd);
                toast.success(`✓ ${selected.size} companies assigned`);
                setSelected(new Set());
                setBulkOwner("");
              } catch (e: any) {
                toast.error(e?.message ?? "Bulk assignment failed.");
              }
            }}
          >
            <input type="hidden" name="ids" value={[...selected].join(",")} />
            <input type="hidden" name="owner_id" value={bulkOwner} />
            <button
              disabled={!bulkOwner}
              className="rounded-md bg-solux px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-solux-dark disabled:opacity-50"
            >
              Assign
            </button>
          </form>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-[11px] text-neutral-500 underline underline-offset-2"
          >
            Clear
          </button>
        </div>
      )}

      {/* ---- companies table ---- */}
      {filtered.length === 0 ? (
        <p className="text-[12px] text-neutral-400">No companies match this view.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-neutral-400">
                <th className="py-1.5 pr-2">
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} />
                </th>
                <th className="py-1.5 pr-3 font-semibold">Company</th>
                <th className="py-1.5 pr-3 font-semibold">Country</th>
                <th className="py-1.5 pr-3 font-semibold text-right">Tenders</th>
                <th className="py-1.5 pr-3 font-semibold text-right">Won</th>
                <th className="py-1.5 pr-3 font-semibold text-right" title="Tender Activity Score — participation +1, win +3, recency bonus">
                  Score
                </th>
                <th className="py-1.5 pr-3 font-semibold">Assigned</th>
                <th className="py-1.5 pr-3 font-semibold">Status</th>
                <th className="py-1.5 pr-3 font-semibold">Last activity</th>
                <th className="py-1.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {filtered.map((p) => (
                <tr key={p.id} className="group hover:bg-neutral-50/60">
                  <td className="py-1.5 pr-2">
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={() => toggleOne(p.id)}
                    />
                  </td>
                  <td className="py-1.5 pr-3">
                    <button
                      type="button"
                      onClick={() => setOpenId(p.id)}
                      className="text-left font-semibold text-neutral-900 hover:underline"
                    >
                      {p.company_name}
                    </button>
                    <span className="ml-2 text-[10px] uppercase tracking-wide text-neutral-400">
                      {SOURCE_LABEL[p.source] ?? p.source}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3 text-neutral-600">{p.country ?? "—"}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-neutral-700">
                    {p.tender_participations ?? 0}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-neutral-700">
                    {p.tender_wins ?? 0}
                  </td>
                  <td className="py-1.5 pr-3 text-right">
                    <span className="inline-block min-w-[28px] rounded bg-neutral-900 px-1.5 py-0.5 text-center text-[11px] font-bold tabular-nums text-white">
                      {scoreOf(p)}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3">
                    <form
                      action={async (fd) => {
                        try {
                          await assignProspect(fd);
                        } catch (e: any) {
                          toast.error(e?.message ?? "Could not assign.");
                        }
                      }}
                    >
                      <input type="hidden" name="id" value={p.id} />
                      <select
                        name="owner_id"
                        defaultValue={p.owner_id ?? "__unassign__"}
                        onChange={(e) => e.currentTarget.form?.requestSubmit()}
                        className="max-w-[130px] rounded border border-neutral-200 px-1 py-0.5 text-[11px] text-neutral-700"
                      >
                        <option value="__unassign__">— Unassigned</option>
                        {owners.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                      </select>
                    </form>
                  </td>
                  <td className="py-1.5 pr-3">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${
                        STATUS_STYLE[p.status] ?? STATUS_STYLE.new
                      }`}
                    >
                      {PROSPECT_STATUS_LABEL[p.status as keyof typeof PROSPECT_STATUS_LABEL] ?? p.status}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3 text-[12px] text-neutral-500 tabular-nums">
                    {fmtD(p.last_activity_at)}
                  </td>
                  <td className="py-1.5 text-right">
                    <button
                      type="button"
                      onClick={() => setOpenId(p.id)}
                      className="rounded border border-neutral-200 px-2 py-0.5 text-[11px] text-neutral-600 hover:bg-neutral-50"
                    >
                      Open →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- company drawer (fiche) ---- */}
      {open && (
        <CompanyDrawer
          key={open.id}
          prospect={open}
          owners={owners}
          ownerLabels={ownerLabels}
          others={prospects.filter((x) => x.id !== open.id)}
          history={historyByProspect[open.id] ?? []}
          activities={activitiesByProspect[open.id] ?? []}
          onClose={() => setOpenId(null)}
        />
      )}
    </section>
  );
}

/* ===================================================================== */
/* Company drawer — Profile / Tender Intelligence / Activities / Notes   */
/* ===================================================================== */

export function CompanyDrawer({
  prospect: p,
  owners,
  ownerLabels,
  others,
  history,
  activities,
  onClose,
}: {
  prospect: ProspectRow;
  owners: OwnerOpt[];
  ownerLabels: Record<string, string>;
  others: ProspectRow[];
  history: ProspectTenderHistoryRow[];
  activities: ProspectActivityRow[];
  onClose: () => void;
}) {
  const [mergeTarget, setMergeTarget] = useState("");
  const score = scoreOf(p);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden />
      <div className="relative h-full w-full max-w-[620px] overflow-y-auto bg-white shadow-xl">
        {/* header */}
        <div className="sticky top-0 z-10 border-b border-neutral-200 bg-white px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-lg font-semibold text-neutral-900">
                  {p.company_name}
                </h2>
                <span className="rounded bg-neutral-900 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-white" title="Tender Activity Score">
                  {score}
                </span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${
                    STATUS_STYLE[p.status] ?? STATUS_STYLE.new
                  }`}
                >
                  {PROSPECT_STATUS_LABEL[p.status as keyof typeof PROSPECT_STATUS_LABEL] ?? p.status}
                </span>
              </div>
              <p className="mt-0.5 text-[12px] text-neutral-500">
                {SOURCE_LABEL[p.source] ?? p.source}
                {p.country ? ` · ${p.country}` : ""}
                {p.owner_id ? ` · ${ownerLabels[p.owner_id] ?? "assigned"}` : " · unassigned"}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-neutral-200 px-2 py-1 text-[12px] text-neutral-600 hover:bg-neutral-50"
            >
              Close ✕
            </button>
          </div>

          {/* quick controls: status / convert */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <form
              action={async (fd) => {
                try {
                  await setProspectStatus(fd);
                } catch (e: any) {
                  toast.error(e?.message ?? "Could not update the status.");
                }
              }}
            >
              <input type="hidden" name="id" value={p.id} />
              <select
                name="status"
                defaultValue={p.status}
                onChange={(e) => e.currentTarget.form?.requestSubmit()}
                className="rounded border border-neutral-200 px-1.5 py-1 text-[12px]"
              >
                {PROSPECT_STATUSES_V2.map((s) => (
                  <option key={s} value={s}>
                    {PROSPECT_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </form>
            <form
              action={async (fd) => {
                try {
                  await convertProspectToClient(fd);
                } catch (e: any) {
                  if (isNavError(e)) throw e;
                  toast.error(e?.message ?? "Could not convert.");
                }
              }}
            >
              <input type="hidden" name="id" value={p.id} />
              <button className="rounded-md bg-solux px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-solux-dark">
                Switch to client →
              </button>
            </form>
            {p.converted_client_id && (
              <Link
                href={`/clients/${p.converted_client_id}`}
                className="text-[12px] text-neutral-600 underline underline-offset-2"
              >
                View client
              </Link>
            )}
            <form
              className="ml-auto"
              action={async (fd) => {
                try {
                  await deleteProspect(fd);
                  onClose();
                } catch (e: any) {
                  toast.error(e?.message ?? "Could not delete.");
                }
              }}
            >
              <input type="hidden" name="id" value={p.id} />
              <button className="rounded px-2 py-1 text-[11px] text-neutral-400 hover:bg-rose-50 hover:text-rose-600">
                Delete
              </button>
            </form>
          </div>
        </div>

        <div className="space-y-5 px-5 py-4">
          {/* ---- Tender Intelligence ---- */}
          <section>
            <div className="eyebrow mb-1.5">Tender intelligence</div>
            <div className="mb-2 flex flex-wrap gap-2 text-[12px] text-neutral-600">
              <span className="rounded border border-neutral-200 px-2 py-0.5">
                Participations: <b className="tabular-nums">{p.tender_participations ?? 0}</b>
              </span>
              <span className="rounded border border-neutral-200 px-2 py-0.5">
                Won: <b className="tabular-nums">{p.tender_wins ?? 0}</b>
              </span>
              <span className="rounded border border-neutral-200 px-2 py-0.5">
                Last participation: <b>{fmtD(p.last_tender_participation_at)}</b>
              </span>
              <span className="rounded border border-neutral-200 px-2 py-0.5">
                Last win: <b>{fmtD(p.last_tender_win_at)}</b>
              </span>
            </div>
            {history.length === 0 ? (
              <p className="text-[12px] text-neutral-400">
                No tender history linked yet — attribution imports fill this automatically.
              </p>
            ) : (
              <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
                {history.map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium text-neutral-800">
                        {h.title ?? "—"}
                      </div>
                      <div className="text-[11px] text-neutral-500">
                        {fmtD(h.date)}
                        {h.country ? ` · ${h.country}` : ""}
                        {h.buyer ? ` · ${h.buyer}` : ""}
                        {h.amount != null ? ` · ${Number(h.amount).toLocaleString()}` : ""}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ring-1 ${
                        h.is_winner
                          ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                          : "bg-neutral-50 text-neutral-500 ring-neutral-200"
                      }`}
                    >
                      {h.is_winner ? "Winner" : "Participant"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ---- Commercial Activities ---- */}
          <section>
            <div className="eyebrow mb-1.5">Commercial activities</div>
            <form
              action={async (fd) => {
                try {
                  await logProspectActivity(fd);
                  toast.success("Activity logged");
                } catch (e: any) {
                  toast.error(e?.message ?? "Could not log the activity.");
                }
              }}
              className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50/60 px-3 py-2"
            >
              <input type="hidden" name="prospect_id" value={p.id} />
              <select name="kind" className="rounded border border-neutral-200 px-1.5 py-1 text-[12px]">
                {ACTIVITY_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
              <input
                name="body"
                placeholder="What happened?"
                className="min-w-[160px] flex-1 rounded border border-neutral-200 px-2 py-1 text-[12px]"
              />
              <label
                className="flex items-center gap-1 text-[11px] text-neutral-600"
                title="A reply from the prospect — the reciprocal interaction that makes a LEAD."
              >
                <input type="checkbox" name="is_reply" /> reply received
              </label>
              <button className="rounded-md bg-neutral-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-neutral-800">
                Log
              </button>
            </form>
            <p className="mb-2 text-[10px] text-neutral-400">
              Outbound action → Contacted. A reply → Lead. An email sent is NOT a lead.
            </p>
            {activities.length === 0 ? (
              <p className="text-[12px] text-neutral-400">No activity yet.</p>
            ) : (
              <ul className="space-y-1">
                {activities.slice(0, 25).map((a) => (
                  <li key={a.id} className="flex items-baseline gap-2 text-[12px]">
                    <span className="shrink-0 tabular-nums text-neutral-400">
                      {fmtD(a.happened_at)}
                    </span>
                    <span className="shrink-0 rounded bg-neutral-100 px-1 text-[10px] font-semibold uppercase text-neutral-500">
                      {a.kind}
                    </span>
                    {a.is_reply && (
                      <span className="shrink-0 rounded bg-emerald-50 px-1 text-[10px] font-semibold uppercase text-emerald-700 ring-1 ring-emerald-200">
                        reply
                      </span>
                    )}
                    <span className="text-neutral-700">{a.body ?? "—"}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ---- Company profile (enrichment) ---- */}
          <section>
            <div className="eyebrow mb-1.5">Company profile</div>
            <form
              action={async (fd) => {
                try {
                  await updateProspectCompany(fd);
                  toast.success("Profile saved");
                } catch (e: any) {
                  toast.error(e?.message ?? "Could not save the profile.");
                }
              }}
              className="space-y-2"
            >
              <input type="hidden" name="id" value={p.id} />
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <label className="block">
                  <span className="text-[11px] text-neutral-500">Company *</span>
                  <input name="company_name" defaultValue={p.company_name} required className={inputCls} />
                </label>
                <label className="block">
                  <span className="text-[11px] text-neutral-500">Country</span>
                  <input name="country" defaultValue={p.country ?? ""} className={inputCls} />
                </label>
                <label className="block md:col-span-2">
                  <span className="text-[11px] text-neutral-500">Address</span>
                  <input name="address" defaultValue={p.address ?? ""} className={inputCls} />
                </label>
                <label className="block">
                  <span className="text-[11px] text-neutral-500">Phone</span>
                  <input name="phone" defaultValue={p.phone ?? ""} className={inputCls} />
                </label>
                <label className="block">
                  <span className="text-[11px] text-neutral-500">Email</span>
                  <input name="email" defaultValue={p.email ?? ""} className={inputCls} />
                </label>
                <label className="block">
                  <span className="text-[11px] text-neutral-500">Website</span>
                  <input name="website" defaultValue={p.website ?? ""} className={inputCls} />
                </label>
                <label className="block">
                  <span className="text-[11px] text-neutral-500">LinkedIn</span>
                  <input name="linkedin_url" defaultValue={p.linkedin_url ?? ""} className={inputCls} />
                </label>
                <label className="block">
                  <span className="text-[11px] text-neutral-500">Leader</span>
                  <input name="leader_name" defaultValue={p.leader_name ?? ""} className={inputCls} />
                </label>
                <label className="block">
                  <span className="text-[11px] text-neutral-500">Leader role</span>
                  <input name="leader_role" defaultValue={p.leader_role ?? ""} className={inputCls} />
                </label>
                <label className="block md:col-span-2">
                  <span className="text-[11px] text-neutral-500">Contact person</span>
                  <input name="contact_name" defaultValue={p.contact_name ?? ""} className={inputCls} />
                </label>
                <label className="block md:col-span-2">
                  <span className="text-[11px] text-neutral-500">Notes</span>
                  <textarea name="notes" defaultValue={p.notes ?? ""} rows={3} className={inputCls} />
                </label>
              </div>
              <div className="flex justify-end">
                <button className="rounded-md bg-solux px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-solux-dark">
                  Save profile
                </button>
              </div>
            </form>
          </section>

          {/* ---- Merge duplicates (Lead Manager) ---- */}
          <section className="rounded-lg border border-dashed border-neutral-300 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
              Merge a duplicate into this company
            </div>
            <p className="mt-0.5 text-[11px] text-neutral-400">
              The duplicate&apos;s tender history and activities move here; its empty fields fill
              this profile; history is never lost.
            </p>
            <form
              className="mt-2 flex flex-wrap items-center gap-2"
              action={async (fd) => {
                try {
                  await mergeProspects(fd);
                  toast.success("Companies merged");
                  setMergeTarget("");
                } catch (e: any) {
                  toast.error(e?.message ?? "Merge failed.");
                }
              }}
            >
              <input type="hidden" name="survivor_id" value={p.id} />
              <select
                name="loser_id"
                value={mergeTarget}
                onChange={(e) => setMergeTarget(e.target.value)}
                className="min-w-[220px] rounded border border-neutral-200 px-1.5 py-1 text-[12px]"
              >
                <option value="">Pick the duplicate…</option>
                {others.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.company_name}
                    {o.country ? ` (${o.country})` : ""}
                  </option>
                ))}
              </select>
              <button
                disabled={!mergeTarget}
                className="rounded-md border border-neutral-300 px-2.5 py-1 text-[11px] font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
              >
                Merge
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
