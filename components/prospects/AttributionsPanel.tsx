"use client";

// =====================================================================
// PROJECTS LIST — Tender Discovery V2 (owner ruling 2026-06-13).
//
// An OPPORTUNITY CATALOGUE, not a database table. Rows/cards show ONLY
// what decides "which project should I open next?": AMOUNT + PARTICIPANT
// COUNT (primary), COUNTRY (typographic anchor, NO flags), title (2
// lines max), assignment status as plain text. Everything else lives in
// the TENDER WORKSPACE (/prospects/tenders/:id) — click anywhere opens
// it. List view + experimental Card view (toggle, tested with the team).
//
// Import (admin only) keeps the dry-run preview + the contact-mapping
// audit. Dynamic country/funder chips with counts. Role separation
// mirrored from the server gates.
// =====================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/components/i18n/I18nProvider";
import {
  importTenderAttributions,
  deleteAllAttributionProjects,
  deleteTenderProject,
  type AttributionImportSummary,
} from "@/app/(app)/prospects/actions";
import type { TenderMRow } from "@/components/prospects/tender-shared";
import {
  tenderUsd,
  fmtUsd,
  funderOf,
  FUNDER_LABEL,
  type FunderKey,
} from "@/lib/tender-discovery";
import { toast } from "@/components/feedback/toast-store";

type OwnerOpt = { id: string; name: string };

/* ------------------------------------------------------------------ */
/* helpers                                                              */
/* ------------------------------------------------------------------ */

function daysAgo(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(String(iso).slice(0, 10));
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

const FUNDER_ICON: Record<FunderKey, string> = {
  world_bank: "🏦",
  afdb: "🏦",
  isdb: "🏦",
  eu: "🇪🇺",
  undp: "🇺🇳",
  afd: "🏦",
  government: "🏛",
  municipality: "🏘",
  unknown: "❔",
};

const AMOUNT_FILTERS = [
  { key: 0, label: "All amounts" },
  { key: 10_000, label: "> $10k" },
  { key: 50_000, label: "> $50k" },
  { key: 100_000, label: "> $100k" },
  { key: 500_000, label: "> $500k" },
  { key: 1_000_000, label: "> $1M" },
] as const;

const STATUS_FILTERS = [
  { key: "all", label: "All projects" },
  { key: "winner", label: "Winner found" },
  { key: "contacts", label: "Contacts found" },
  { key: "assigned", label: "Assigned" },
  { key: "unassigned", label: "Unassigned" },
] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number]["key"];

/** Sitting in Solux for 30+ days = the neglect signal. */
const NEGLECT_DAYS = 30;

type ProjectSignals = {
  t: any;
  usd: number | null;
  funder: FunderKey;
  hasWinner: boolean;
  participantsCount: number;
  contacts: number;
  importedDays: number | null;
};

/* ------------------------------------------------------------------ */
/* panel                                                                */
/* ------------------------------------------------------------------ */

export function AttributionsPanel({
  attributions,
  owners,
  ownerLabels,
  canAssign,
  canImport,
}: {
  attributions: TenderMRow[];
  owners: OwnerOpt[];
  ownerLabels: Record<string, string>;
  canAssign: boolean;
  canImport: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const tr = useT();
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleResetAll() {
    setResetting(true);
    const res = await deleteAllAttributionProjects();
    setResetting(false);
    setConfirmReset(false);
    if (res.error) toast.error(res.error);
    else {
      toast.success(`${res.deleted} project(s) deleted`);
      router.refresh();
    }
  }

  async function handleDeleteOne(id: string) {
    if (!window.confirm(tr("attrib.delete_one_confirm"))) return;
    setDeletingId(id);
    const res = await deleteTenderProject(id);
    setDeletingId(null);
    if (res.error) toast.error(res.error);
    else {
      toast.success("Project deleted");
      router.refresh();
    }
  }
  const [preview, setPreview] = useState<AttributionImportSummary | null>(null);
  const [pendingJson, setPendingJson] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<AttributionImportSummary | null>(null);
  const [sort, setSort] = useState<"amount" | "published" | "sitting" | "country">("amount");
  const [minUsd, setMinUsd] = useState<number>(0);
  const [countryFilter, setCountryFilter] = useState<string>("all");
  const [funderFilter, setFunderFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  // Experimental Card view (owner spec): both representations ship, the
  // sales team votes with their feet. Persisted locally, default = list.
  const [viewMode, setViewMode] = useState<"list" | "card">("list");
  useEffect(() => {
    if (typeof window !== "undefined" && localStorage.getItem("solux_disco_view_mode") === "card") {
      setViewMode("card");
    }
  }, []);
  const switchView = (m: "list" | "card") => {
    setViewMode(m);
    try {
      localStorage.setItem("solux_disco_view_mode", m);
    } catch {}
  };

  const projects: ProjectSignals[] = useMemo(() => {
    return (attributions as any[]).map((t) => {
      const participants = (t.participants ?? []) as any[];
      const hasWinner = participants.some((p) => p.is_winner);
      const contacts = participants.filter((p) => p.email || p.phone).length;
      const { usd } = tenderUsd(t);
      const funder = funderOf(t.buyer);
      return {
        t,
        usd,
        funder,
        hasWinner,
        participantsCount: participants.length,
        contacts,
        importedDays: daysAgo(t.imported_at ?? t.created_at),
      };
    });
  }, [attributions]);

  const countryChips = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of projects) {
      if (!p.t.country) continue;
      m.set(p.t.country, (m.get(p.t.country) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [projects]);
  const funderChips = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of projects) m.set(p.funder, (m.get(p.funder) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [projects]);
  const chipCls = (active: boolean) =>
    `rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 transition-colors ${
      active
        ? "bg-neutral-900 text-white ring-neutral-900"
        : "bg-white text-neutral-600 ring-neutral-200 hover:bg-neutral-50"
    }`;

  const filtered = useMemo(() => {
    return projects
      .filter((p) => {
        if (minUsd > 0 && !((p.usd ?? 0) > minUsd)) return false;
        if (countryFilter !== "all" && p.t.country !== countryFilter) return false;
        if (funderFilter !== "all" && p.funder !== funderFilter) return false;
        if (ownerFilter !== "all") {
          if (ownerFilter === "__none__") {
            if (p.t.owner_id) return false;
          } else if (p.t.owner_id !== ownerFilter) return false;
        }
        switch (statusFilter) {
          case "winner":
            return p.hasWinner;
          case "contacts":
            return p.contacts > 0;
          case "assigned":
            return !!p.t.owner_id;
          case "unassigned":
            return !p.t.owner_id;
          default:
            return true;
        }
      })
      .sort((a, b) => {
        switch (sort) {
          case "amount":
            return (b.usd ?? 0) - (a.usd ?? 0);
          case "published":
            return String(b.t.publication_date ?? "").localeCompare(
              String(a.t.publication_date ?? "")
            );
          case "sitting":
            return (b.importedDays ?? -1) - (a.importedDays ?? -1);
          case "country":
            return String(a.t.country ?? "").localeCompare(String(b.t.country ?? ""));
        }
      });
  }, [projects, sort, minUsd, countryFilter, funderFilter, statusFilter, ownerFilter]);

  /* ---- import flow (admin only — server enforces too) ---- */
  async function handleFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setBusy(true);
    setPreview(null);
    setLastResult(null);
    try {
      const text = await file.text();
      const dry = await importTenderAttributions(text, true);
      if (dry.attributions === 0) toast.error(dry.errors[0] ?? "Nothing to import.");
      else {
        setPreview(dry);
        setPendingJson(text);
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Could not read the file.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function confirmImport() {
    if (!pendingJson) return;
    setBusy(true);
    try {
      const res = await importTenderAttributions(pendingJson, false);
      setLastResult(res);
      setPreview(null);
      setPendingJson(null);
      if (res.errors.length > 0) toast.error(res.errors[0]);
      if (res.attributions > 0 && res.errors.length === 0) {
        toast.success(
          `${res.attributions} projects imported successfully (${res.participants} companies, ${res.contactsFound} contacts${
            res.profilesSynced != null ? `, ${res.profilesSynced} profiles enriched` : ""
          })`
        );
      }
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel p-5 space-y-4">
      {/* ---- header (+ import for admins) ---- */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="eyebrow">{tr("attrib.eyebrow")}</div>
          <p className="mt-0.5 max-w-2xl text-[12px] text-neutral-500">
            {canAssign
              ? tr("attrib.subtitle_admin")
              : tr("attrib.subtitle_sales")}
          </p>
        </div>
        {canImport && (
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => handleFile(e.target.files)}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="rounded-md bg-solux px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-solux-dark disabled:opacity-50"
            >
              {busy ? tr("attrib.working") : tr("attrib.import_btn")}
            </button>
            {!confirmReset ? (
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                className="rounded-md border border-rose-200 px-2.5 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-50"
              >
                {tr("attrib.reset_all")}
              </button>
            ) : (
              <span className="flex items-center gap-2 text-[11px]">
                <span className="text-rose-700">{tr("attrib.reset_confirm", { n: attributions.length })}</span>
                <button
                  type="button"
                  onClick={handleResetAll}
                  disabled={resetting}
                  className="rounded-md bg-rose-600 px-2.5 py-1 font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                >
                  {resetting ? tr("attrib.deleting") : tr("attrib.reset_yes")}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  className="rounded-md border border-neutral-300 px-2.5 py-1 font-semibold text-neutral-700 hover:bg-neutral-50"
                >
                  {tr("action.cancel")}
                </button>
              </span>
            )}
          </div>
        )}
      </div>

      {/* dry-run preview → confirm (+ contact-mapping audit) */}
      {preview && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2 text-[12px] text-neutral-700">
          <span>
            Ready: <b>{preview.attributions}</b> projects ({preview.attributionsCreated} new ·{" "}
            {preview.attributionsUpdated} updates
            {preview.merged ? ` · ${preview.merged} merged into existing` : ""}) ·{" "}
            <b>{preview.participants}</b> companies · <b>{preview.contactsFound}</b> contacts found
          </span>
          {preview.errors.length > 0 && (
            <span className="text-amber-700">{preview.errors.length} item(s) skipped</span>
          )}
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={() => {
                setPreview(null);
                setPendingJson(null);
              }}
              className="rounded border border-neutral-200 px-2 py-0.5 text-[11px]"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={confirmImport}
              className="rounded-md bg-neutral-900 px-3 py-1 text-[11px] font-bold text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {busy ? tr("attrib.importing") : tr("attrib.confirm_import")}
            </button>
          </div>
          {preview.fieldAudit.length > 0 && (
            <details className="w-full basis-full">
              <summary className="cursor-pointer text-[11px] font-semibold text-neutral-600">
                Contact mapping audit ({preview.contactsFound} of {preview.participants}{" "}
                companies have contacts) — inspect field extraction
              </summary>
              <ul className="ml-1 mt-1 space-y-1">
                {preview.fieldAudit.map((a, i) => (
                  <li key={i} className="text-[11px]">
                    <b className="text-neutral-800">{a.company}</b>{" "}
                    {Object.keys(a.mapped).length === 0 ? (
                      <span className="text-amber-700">— nothing mapped</span>
                    ) : (
                      <span className="text-neutral-600">
                        →{" "}
                        {Object.entries(a.mapped)
                          .map(([k, v]) => `${k}: ${v}`)
                          .join(" · ")}
                      </span>
                    )}
                    {a.unmappedKeys.length > 0 && (
                      <span className="text-neutral-400">
                        {" "}
                        · ignored keys: {a.unmappedKeys.join(", ")}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {lastResult && (
        <div
          className={`rounded-lg border px-3 py-2 text-[12px] ${
            lastResult.errors.length > 0
              ? "border-rose-200 bg-rose-50/70 text-rose-700"
              : "border-emerald-200 bg-emerald-50/60 text-emerald-800"
          }`}
        >
          {lastResult.attributions} projects processed ({lastResult.attributionsCreated} new,{" "}
          {lastResult.attributionsUpdated} updated
          {lastResult.merged ? `, ${lastResult.merged} merged into existing` : ""}) — database now holds{" "}
          {lastResult.dbAttributionsTotal ?? "?"} projects.
          {lastResult.profilesSynced != null && (
            <> Company profiles enriched with contacts: <b>{lastResult.profilesSynced}</b>.</>
          )}
          {lastResult.mergedFlagged ? (
            <> {lastResult.mergedFlagged} merge(s) flagged for review (close but not certain).</>
          ) : null}
          {lastResult.errors.length > 0 && (
            <ul className="ml-4 mt-1 list-disc">
              {lastResult.errors.slice(0, 5).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
              {lastResult.errors.length > 5 && (
                <li>… and {lastResult.errors.length - 5} more errors (same cause, most likely).</li>
              )}
            </ul>
          )}
        </div>
      )}

      {/* ---- dynamic chips + filters + sort ---- */}
      {attributions.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setCountryFilter("all")}
              className={chipCls(countryFilter === "all")}
            >
              {tr("attrib.all_countries", { n: projects.length })}
            </button>
            {countryChips.map(([c, n]) => (
              <button
                key={c}
                type="button"
                onClick={() => setCountryFilter(countryFilter === c ? "all" : c)}
                className={chipCls(countryFilter === c)}
              >
                {c} ({n})
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setFunderFilter("all")}
              className={chipCls(funderFilter === "all")}
            >
              {tr("attrib.all_funders")}
            </button>
            {funderChips.map(([f, n]) => (
              <button
                key={f}
                type="button"
                onClick={() => setFunderFilter(funderFilter === f ? "all" : f)}
                className={chipCls(funderFilter === f)}
              >
                {FUNDER_ICON[f as FunderKey]} {FUNDER_LABEL[f as FunderKey]} ({n})
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {AMOUNT_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setMinUsd(f.key)}
                className={chipCls(minUsd === f.key)}
              >
                {f.label}
              </button>
            ))}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="rounded border border-neutral-200 px-1.5 py-1 text-[11px] text-neutral-700"
            >
              {STATUS_FILTERS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
            {canAssign && (
              <select
                value={ownerFilter}
                onChange={(e) => setOwnerFilter(e.target.value)}
                className="rounded border border-neutral-200 px-1.5 py-1 text-[11px] text-neutral-700"
              >
                <option value="all">All owners</option>
                <option value="__none__">Unassigned</option>
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            )}
            <div className="ml-auto flex items-center gap-2">
              <div className="flex rounded-md border border-neutral-200 p-0.5">
                <button
                  type="button"
                  onClick={() => switchView("list")}
                  className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                    viewMode === "list" ? "bg-neutral-900 text-white" : "text-neutral-500 hover:bg-neutral-50"
                  }`}
                >
                  List
                </button>
                <button
                  type="button"
                  onClick={() => switchView("card")}
                  className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                    viewMode === "card" ? "bg-neutral-900 text-white" : "text-neutral-500 hover:bg-neutral-50"
                  }`}
                >
                  Cards
                </button>
              </div>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as any)}
                className="rounded border border-neutral-200 px-1.5 py-1 text-[11px] text-neutral-700"
              >
                <option value="amount">Highest amount</option>
                <option value="published">Recently published</option>
                <option value="sitting">Longest in Solux</option>
                <option value="country">Country</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* ---- PROJECT ROWS — click anywhere → Tender Workspace ---- */}
      {attributions.length === 0 ? (
        <p className="text-[12px] text-neutral-400">
          {canImport
            ? tr("attrib.empty_admin")
            : tr("attrib.empty_sales")}
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-[12px] text-neutral-400">{tr("attrib.empty_filtered")}</p>
      ) : (
        viewMode === "list" ? (
        <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white">
          {filtered.map((p) => {
            const t = p.t;
            return (
              <li
                key={t.id}
                role="link"
                tabIndex={0}
                onClick={() => router.push(`/prospects/tenders/${t.id}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ")
                    router.push(`/prospects/tenders/${t.id}`);
                }}
                className="flex cursor-pointer items-center gap-x-6 px-5 py-4 transition-colors hover:bg-neutral-50"
              >
                {/* 3. COUNTRY — typographic anchor, no flag */}
                <div className="w-36 shrink-0 text-[11px] font-bold uppercase tracking-wider text-neutral-500">
                  {t.country ?? "—"}
                </div>

                {/* 1+2. AMOUNT + PARTICIPANTS — the primary signals, together */}
                <div className="w-40 shrink-0">
                  <div className="text-lg font-bold tabular-nums leading-tight tracking-tight text-neutral-900">
                    {fmtUsd(p.usd)}
                  </div>
                  <div className="text-[12px] font-semibold text-neutral-700">
                    👥 {p.participantsCount} participant{p.participantsCount === 1 ? "" : "s"}
                  </div>
                </div>

                {/* 4. title — 2 lines max */}
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 text-[13px] font-medium leading-snug text-neutral-800">
                    {t.title ?? "—"}
                  </div>
                </div>

                {/* 5. assignment status — plain text, no controls */}
                <div className="w-32 shrink-0 text-right text-[11px]">
                  {t.owner_id ? (
                    <span className="text-neutral-600">
                      {tr("attrib.assigned")} <b>{ownerLabels[t.owner_id] ?? "—"}</b>
                    </span>
                  ) : (
                    <span className="text-neutral-400">{tr("common.unassigned")}</span>
                  )}
                </div>
                {canImport && (
                  <button
                    type="button"
                    title={tr("attrib.delete_one_title")}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteOne(t.id);
                    }}
                    disabled={deletingId === t.id}
                    className="shrink-0 rounded p-1 text-neutral-300 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                  >
                    ✕
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        ) : (
        /* ---- experimental CARD VIEW — opportunities, not records ---- */
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((p) => {
            const t = p.t;
            return (
              <li
                key={t.id}
                role="link"
                tabIndex={0}
                onClick={() => router.push(`/prospects/tenders/${t.id}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ")
                    router.push(`/prospects/tenders/${t.id}`);
                }}
                className="relative flex cursor-pointer flex-col rounded-xl border border-neutral-200 bg-white px-5 py-4 transition-colors hover:border-neutral-400"
              >
                {canImport && (
                  <button
                    type="button"
                    title={tr("attrib.delete_one_title")}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteOne(t.id);
                    }}
                    disabled={deletingId === t.id}
                    className="absolute right-2 top-2 rounded p-1 text-neutral-300 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                  >
                    ✕
                  </button>
                )}
                <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">
                  {t.country ?? "—"}
                </div>
                <div className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight text-neutral-900">
                  {fmtUsd(p.usd)}
                </div>
                <div className="mt-0.5 text-[13px] font-semibold text-neutral-700">
                  👥 {p.participantsCount} participant{p.participantsCount === 1 ? "" : "s"}
                </div>
                <p className="mt-2 line-clamp-2 flex-1 text-[13px] font-medium leading-snug text-neutral-800">
                  {t.title ?? "—"}
                </p>
                <div className="mt-3 flex items-center justify-between gap-2 border-t border-neutral-100 pt-2 text-[11px]">
                  <span className="text-neutral-400">
                    {tr("attrib.published")} {t.publication_date ? String(t.publication_date).slice(0, 10) : "—"}
                    {p.importedDays != null && (
                      <>
                        {" · "}
                        <span
                          className={
                            p.importedDays >= NEGLECT_DAYS
                              ? "font-semibold text-amber-700"
                              : undefined
                          }
                        >
                          {p.importedDays === 0 ? "arrived today" : `${p.importedDays}d in Solux`}
                        </span>
                      </>
                    )}
                  </span>
                  {t.owner_id ? (
                    <span className="shrink-0 text-neutral-600">
                      {tr("attrib.assigned")} <b>{ownerLabels[t.owner_id] ?? "—"}</b>
                    </span>
                  ) : (
                    <span className="shrink-0 text-neutral-400">{tr("common.unassigned")}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        )
      )}
    </section>
  );
}
