"use client";

// =====================================================================
// Clients drill-down tree (PROTOTYPE) — Client → Affair/Project → Quotation
// Versions. Operational status is owned by the AFFAIR; each version owns only
// its commercial status (draft/sent/won/lost). Two clicks to a version.
// Architecture: docs/CLIENT_HUB_UX_PROPOSAL.md.
// =====================================================================

import { useMemo, useState } from "react";
import Link from "next/link";
import { fmtDate } from "@/components/affairs/badges";
import { AffairVersionsTable } from "@/components/affairs/AffairVersionsTable";
import {
  AffairProgressStrip,
  affairOperationalStatus,
  affairPhaseLabel,
  type AffairOpTone,
} from "@/components/affairs/AffairProgressStrip";
import { Collapse } from "@/components/ui/Collapse";
import {
  formatMoney,
  type ClientAffairs,
  type AffairGroup,
} from "@/lib/affairs-prototype";

const DEAD = new Set(["lost", "abandoned", "archived"]);
function isActiveAffair(a: AffairGroup): boolean {
  if (a.isArchived) return false;
  if (a.effectiveStatus === "lost" || a.effectiveStatus === "cancelled") return false;
  if (a.lifecycleStatus && DEAD.has(a.lifecycleStatus)) return false;
  return true;
}

const OP_TONE: Record<AffairOpTone, string> = {
  neutral: "bg-neutral-100 text-neutral-600",
  amber: "bg-amber-100 text-amber-800",
  sky: "bg-sky-100 text-sky-800",
  violet: "bg-violet-100 text-violet-800",
  emerald: "bg-emerald-100 text-emerald-800",
  red: "bg-rose-100 text-rose-700",
};

/** Per-currency value total over a set of affairs (no FX). */
function valueChips(affairs: AffairGroup[]): string {
  const byCur = new Map<string, number>();
  for (const a of affairs) {
    if (!a.totalValue) continue;
    const cur = (a.currency || "USD").toUpperCase();
    byCur.set(cur, (byCur.get(cur) ?? 0) + a.totalValue);
  }
  if (byCur.size === 0) return "—";
  return Array.from(byCur.entries())
    .sort((x, y) => y[1] - x[1])
    .map(([cur, total]) => formatMoney(total, cur))
    .join(" · ");
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={`h-3.5 w-3.5 shrink-0 text-neutral-300 transition-transform group-hover:text-neutral-500 ${
        open ? "rotate-90" : ""
      }`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d="M7 5l6 5-6 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ClientAffairTree({ clients }: { clients: ClientAffairs[] }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return clients;
    return clients.filter((c) =>
      [c.clientName, c.clientCode, c.country, c.contactName]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(term)),
    );
  }, [clients, q]);

  return (
    <div className="space-y-3">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search clients — name, code, country, contact…"
        className="w-full max-w-md rounded-md border border-neutral-200 px-3 py-2 text-sm focus:border-solux focus:outline-none focus:ring-1 focus:ring-solux/30"
      />
      {filtered.length === 0 ? (
        <p className="panel p-12 text-center text-sm text-neutral-500">
          No clients with projects match.
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map((c) => (
            <ClientNode key={c.clientId ?? "unlinked"} client={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function ClientNode({ client }: { client: ClientAffairs }) {
  const [open, setOpen] = useState(false);
  const activeAffairs = client.affairs.filter(isActiveAffair);
  const activeCount = activeAffairs.length;
  const alerts = activeAffairs.reduce((n, a) => n + a.alerts.length, 0);
  const value = valueChips(activeAffairs);

  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-card ring-1 ring-neutral-200/70">
      <div className="flex items-stretch">
        <div className="w-1 shrink-0 bg-solux/80" aria-hidden />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="group flex flex-1 items-center gap-3 px-4 py-3 text-left hover:bg-solux-surface"
        >
          <Chevron open={open} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-[15px] font-semibold text-solux-ink">
                {client.clientName}
              </span>
              {client.clientCode && (
                <span className="rounded bg-solux-ink/[0.06] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-solux-ink ring-1 ring-inset ring-neutral-200">
                  {client.clientCode}
                </span>
              )}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-neutral-500">
              {[
                client.country,
                client.ownerName && `Owner ${client.ownerName}`,
                client.contactName,
              ]
                .filter(Boolean)
                .join(" · ") || "—"}
            </div>
          </div>
          <div className="hidden shrink-0 items-center gap-2.5 text-right sm:flex">
            <span className="text-[11px] text-neutral-500">
              {activeCount}/{client.affairCount} active
            </span>
            <span className="text-[12px] font-semibold tabular-nums text-neutral-800">
              {value}
            </span>
            {alerts > 0 && (
              <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">
                ⚠ {alerts}
              </span>
            )}
          </div>
        </button>
        <Link
          href={client.clientId ? `/clients/${client.clientId}` : "/clients"}
          className="m-2 shrink-0 self-center whitespace-nowrap rounded-md bg-solux px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm transition-colors hover:bg-solux-dark"
        >
          Open Client Hub →
        </Link>
      </div>
      <Collapse open={open}>
        <div className="divide-y divide-neutral-100 border-t border-neutral-100 bg-neutral-50/40">
          {client.affairs.length === 0 ? (
            <p className="px-5 py-4 text-[12px] text-neutral-500">
              No projects yet for this client.
            </p>
          ) : (
            client.affairs.map((a) => <AffairNode key={a.anchorId} affair={a} />)
          )}
        </div>
      </Collapse>
    </div>
  );
}

function AffairNode({ affair }: { affair: AffairGroup }) {
  const [open, setOpen] = useState(false);
  const op = affairOperationalStatus(affair);
  const phaseLabel = affairPhaseLabel(affair);
  const value = affair.totalValue
    ? formatMoney(affair.totalValue, affair.currency)
    : "";
  const docCount = affair.documents.length;

  return (
    <div className="bg-white/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group flex w-full items-center gap-3 px-5 py-2.5 pl-8 text-left hover:bg-solux-surface"
      >
        <Chevron open={open} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-neutral-800">
          {affair.displayName}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          {/* OPERATIONAL status — owned by the affair, not the versions */}
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${OP_TONE[op.tone]}`}
          >
            {op.label}
          </span>
          {/* production state */}
          <span className="hidden rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600 md:inline">
            {phaseLabel}
          </span>
          {affair.eta && (
            <span
              className="hidden whitespace-nowrap text-[11px] text-neutral-500 lg:inline"
              title="ETA / production deadline"
            >
              ETA {fmtDate(affair.eta, { month: "short", day: "numeric" })}
            </span>
          )}
          {affair.nextAction && (
            <span className="hidden whitespace-nowrap rounded-md bg-solux-ink/[0.06] px-2 py-0.5 text-[11px] font-semibold text-solux-ink xl:inline">
              Next: {affair.nextAction}
            </span>
          )}
          {value && (
            <span className="hidden text-[12px] font-semibold tabular-nums text-neutral-800 sm:inline">
              {value}
            </span>
          )}
          {/* Documents — prominent (documents drive execution) */}
          <span
            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ${
              docCount > 0
                ? "bg-solux/10 text-solux-dark"
                : "bg-neutral-100 text-neutral-400"
            }`}
            title={`${docCount} document${docCount === 1 ? "" : "s"}`}
          >
            📄 {docCount}
          </span>
          {affair.alerts.length > 0 && (
            <span
              className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700"
              title={affair.alerts.join(" · ")}
            >
              ⚠ {affair.alerts.length}
            </span>
          )}
        </div>
      </button>
      <Collapse open={open}>
        <div className="space-y-2 border-t border-neutral-100 bg-solux-surface px-5 py-3 pl-9">
          {/* production stage */}
          <AffairProgressStrip affair={affair} />
          {/* L3: quotation versions (commercial status only) */}
          <AffairVersionsTable affair={affair} />
          <div className="flex justify-end">
            {affair.affairId ? (
              <Link
                href={`/affairs/${affair.affairId}`}
                className="rounded-md border border-neutral-300 px-2 py-0.5 text-[11px] font-medium text-solux-dark hover:bg-neutral-50"
                title="Advanced: editing · production · shipping · document management"
              >
                Manage affair →
              </Link>
            ) : affair.latest ? (
              <Link
                href={`/documents/${affair.latest.id}`}
                className="rounded-md border border-neutral-300 px-2 py-0.5 text-[11px] font-medium text-solux-dark hover:bg-neutral-50"
              >
                Open latest →
              </Link>
            ) : null}
          </div>
        </div>
      </Collapse>
    </div>
  );
}

// (Versions table extracted to components/affairs/AffairVersionsTable.tsx)
