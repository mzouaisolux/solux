"use client";

// =====================================================================
// Tender Pipeline (UX v2) — a real commercial work tool, not a status
// display. The reads, in order:
//
//   1. KPI strip (compact — the board stays dominant): Working /
//      Need Action / Closing <7d / Potential Pipeline Value /
//      Interested Partners
//   2. Kanban board with RICH cards: title, country, buyer, score,
//      budget, closing, owner, NEXT ACTION — each card color-coded:
//        green  = under control (next action planned, no urgency)
//        amber  = attention (closing < 7 days)
//        red    = action required (no next action / overdue)
//   3. Card click → TenderDrawer, the main work center.
// =====================================================================

import { useMemo, useState } from "react";
import { toast } from "@/components/feedback/toast-store";
import {
  COMMERCIAL_STATUS_LABEL,
  STATUS_CHIP,
  BOARD_STAGES,
  ACTIVE_PIPELINE,
} from "@/components/prospects/tender-status";
import {
  type TenderMRow,
  type CompanyOption,
  type OwnerOption,
  type TenderActionRow,
  ACTION_TYPE_OPTIONS,
  needsAction,
  daysLeft,
  todayISO,
  compactUsd,
  isNavError,
} from "@/components/prospects/tender-shared";
import { TenderDrawer } from "@/components/prospects/TenderDrawer";
import { TenderViewToggle } from "@/components/prospects/TenderNav";

/* ------------------------------ urgency model ------------------------------ */

type Urgency = "red" | "amber" | "green";

/** red = action required (no next action / overdue) · amber = attention
 *  (closing soon) · green = under control. */
function urgency(t: TenderMRow): Urgency {
  if (needsAction(t)) return "red";
  const dl = daysLeft(t.deadline);
  if (dl != null && dl >= 0 && dl < 7) return "amber";
  return "green";
}
const URGENCY_BORDER: Record<Urgency, string> = {
  red: "border-l-rose-500",
  amber: "border-l-amber-400",
  green: "border-l-emerald-500",
};

function nextOpenAction(t: TenderMRow): TenderActionRow | null {
  const open = t.actions
    .filter((a) => !a.done_at)
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
  return open[0] ?? null;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

/* ---------------------------------- main ----------------------------------- */

export function TenderPipeline({
  tenders,
  clients,
  prospects,
  owners,
  ownerLabels,
  currentUserId,
}: {
  /** ALL tenders — the board shows pipeline stages; KPIs use the rest. */
  tenders: TenderMRow[];
  clients: CompanyOption[];
  prospects: CompanyOption[];
  owners: OwnerOption[];
  ownerLabels: Record<string, string>;
  currentUserId: string | null;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const act = async (fn: (fd: FormData) => Promise<void>, fd: FormData, ok?: string) => {
    try {
      await fn(fd);
      if (ok) toast.success(ok);
    } catch (e: any) {
      if (isNavError(e)) throw e;
      toast.error(e?.message ?? "Action failed.");
    }
  };

  const byStage = useMemo(() => {
    const map = new Map<string, TenderMRow[]>();
    for (const s of BOARD_STAGES) map.set(s, []);
    for (const t of tenders) {
      if (map.has(t.commercial_status)) map.get(t.commercial_status)!.push(t);
    }
    // Inside a column: action-required first, then closest deadline.
    const rank: Record<Urgency, number> = { red: 0, amber: 1, green: 2 };
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        const ua = rank[urgency(a)];
        const ub = rank[urgency(b)];
        if (ua !== ub) return ua - ub;
        return (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999");
      });
    }
    return map;
  }, [tenders]);

  // The 5 USEFUL numbers — compact, the board stays the hero.
  const kpi = useMemo(() => {
    const working = tenders.filter((t) => ACTIVE_PIPELINE.has(t.commercial_status));
    return {
      working: working.length,
      needAction: tenders.filter(needsAction).length,
      closingWeek: working.filter((t) => {
        const d = daysLeft(t.deadline);
        return d != null && d >= 0 && d < 7;
      }).length,
      pipelineValue: working.reduce((s, t) => s + (t.budget_usd ?? 0), 0),
      interested: tenders.filter((t) =>
        ["interested", "project_request"].includes(t.commercial_status)
      ).length,
    };
  }, [tenders]);

  const selected = selectedId ? tenders.find((t) => t.id === selectedId) ?? null : null;
  const ownerName = (id: string | null) =>
    id ? ownerLabels[id] ?? `user·${id.slice(0, 6)}` : null;

  return (
    <div className="space-y-4">
      {/* compact universe switch */}
      <TenderViewToggle active="pipeline" tenders={tenders} />

      {/* KPI strip — useful numbers only, deliberately compact. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <KpiTile label="Working Tenders" value={String(kpi.working)} />
        <KpiTile
          label="Need Action"
          value={String(kpi.needAction)}
          tone={kpi.needAction > 0 ? "red" : undefined}
        />
        <KpiTile
          label="Closing < 7 days"
          value={String(kpi.closingWeek)}
          tone={kpi.closingWeek > 0 ? "amber" : undefined}
        />
        <KpiTile
          label="Potential Pipeline Value"
          value={kpi.pipelineValue > 0 ? compactUsd(kpi.pipelineValue) : "—"}
        />
        <KpiTile
          label="Interested Partners"
          value={String(kpi.interested)}
          tone={kpi.interested > 0 ? "green" : undefined}
        />
      </div>

      {/* urgency legend — one quiet line, instantly decodes the board. */}
      <div className="flex items-center gap-4 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-500" /> Under control
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-amber-400" /> Attention
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-rose-500" /> Action required
        </span>
      </div>

      {/* KANBAN board — the hero of the page. */}
      <div className="overflow-x-auto pb-2">
        <div className="flex min-w-max gap-3">
          {BOARD_STAGES.map((stage) => {
            const cards = byStage.get(stage) ?? [];
            const colValue = cards.reduce((s, t) => s + (t.budget_usd ?? 0), 0);
            return (
              <div key={stage} className="w-[280px] shrink-0">
                <div className="mb-2 flex items-center justify-between px-0.5">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ${
                      STATUS_CHIP[stage] ?? "bg-neutral-100 text-neutral-600 ring-neutral-200"
                    }`}
                  >
                    {COMMERCIAL_STATUS_LABEL[stage]}
                  </span>
                  <span className="text-[11px] font-semibold tabular-nums text-neutral-400">
                    {cards.length}
                    {colValue > 0 && <span className="ml-1.5">· {compactUsd(colValue)}</span>}
                  </span>
                </div>
                <div className="min-h-[120px] space-y-2.5 rounded-lg border border-dashed border-neutral-200 bg-neutral-50/40 p-2">
                  {cards.length === 0 ? (
                    <p className="px-1 py-3 text-center text-[11px] text-neutral-300">—</p>
                  ) : (
                    cards.map((t) => (
                      <TenderCard
                        key={t.id}
                        t={t}
                        active={selectedId === t.id}
                        onOpen={() => setSelectedId(t.id)}
                        ownerName={ownerName}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* DRAWER — the main work center for the selected tender. */}
      {selected && (
        <TenderDrawer
          t={selected}
          context="pipeline"
          owners={owners}
          ownerLabels={ownerLabels}
          currentUserId={currentUserId}
          clients={clients}
          prospects={prospects}
          act={act}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

/* -------------------------------- KPI tile --------------------------------- */

function KpiTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "red" | "amber" | "green";
}) {
  const ring =
    tone === "red"
      ? "border-rose-300"
      : tone === "amber"
        ? "border-amber-300"
        : tone === "green"
          ? "border-emerald-300"
          : "border-neutral-200";
  const text =
    tone === "red"
      ? "text-rose-700"
      : tone === "amber"
        ? "text-amber-700"
        : tone === "green"
          ? "text-emerald-700"
          : "text-neutral-900";
  return (
    <div className={`rounded-lg border bg-white px-3 py-2 ${ring}`}>
      <div className="text-[9.5px] font-bold uppercase tracking-wider text-neutral-400">
        {label}
      </div>
      <div className={`text-xl font-bold tabular-nums ${text}`}>{value}</div>
    </div>
  );
}

/* ------------------------------- tender card -------------------------------- */

function TenderCard({
  t,
  active,
  onOpen,
  ownerName,
}: {
  t: TenderMRow;
  active: boolean;
  onOpen: () => void;
  ownerName: (id: string | null) => string | null;
}) {
  const u = urgency(t);
  const dl = daysLeft(t.deadline);
  const next = nextOpenAction(t);
  const owner = ownerName(t.owner_id);
  const overdue = next != null && next.due_date < todayISO();

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`block w-full rounded-lg border border-l-4 bg-white p-3 text-left shadow-sm transition-all hover:-translate-y-px hover:shadow-md ${
        URGENCY_BORDER[u]
      } ${active ? "border-neutral-900 ring-1 ring-neutral-900" : "border-neutral-200"}`}
    >
      {/* title */}
      <div className="line-clamp-2 text-[13px] font-semibold leading-snug text-neutral-900">
        {t.title}
      </div>
      {/* country · buyer */}
      <div className="mt-1 truncate text-[11px] text-neutral-500">
        {[t.country, t.buyer].filter(Boolean).join(" · ") || "—"}
      </div>

      {/* score · budget · closing */}
      <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px]">
        {t.score != null && (
          <span className="rounded bg-neutral-100 px-1.5 py-px font-bold tabular-nums text-neutral-700">
            {t.score}
          </span>
        )}
        {t.budget_usd != null && t.budget_usd > 0 && (
          <span className="font-semibold tabular-nums text-neutral-800">
            {compactUsd(t.budget_usd)}
          </span>
        )}
        {t.deadline && (
          <span
            className={`tabular-nums font-medium ${
              dl != null && dl >= 0 && dl < 7
                ? "text-amber-700"
                : dl != null && dl < 0
                  ? "text-neutral-300"
                  : "text-neutral-500"
            }`}
          >
            {t.deadline}
            {dl != null && dl >= 0 && <span className="ml-1 font-bold">({dl}d)</span>}
            {dl != null && dl < 0 && <span className="ml-1">closed</span>}
          </span>
        )}
      </div>

      {/* next action + owner — the WORK line. */}
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-neutral-100 pt-2">
        {next ? (
          <span
            className={`min-w-0 truncate text-[11px] font-semibold ${
              overdue ? "text-rose-700" : "text-neutral-700"
            }`}
          >
            → {ACTION_TYPE_OPTIONS.find((o) => o.value === next.action_type)?.label ?? "Action"}
            {next.title ? ` · ${next.title}` : ""} · {next.due_date}
            {overdue && " ⚠"}
          </span>
        ) : (
          <span className="text-[11px] font-bold text-rose-700">⚠ Plan next action</span>
        )}
        {owner && (
          <span
            title={owner}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-[8.5px] font-bold text-white"
          >
            {initials(owner)}
          </span>
        )}
      </div>
    </button>
  );
}
