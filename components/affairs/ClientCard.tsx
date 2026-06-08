"use client";

// =====================================================================
// Affairs View — client container row (the RELATIONSHIP level). Dense,
// vertical, expandable. The client identity is CLICKABLE → the Client Hub
// (/clients/[id], the interim hub until the tabbed version lands). Below it,
// the client's affairs render as light previews (AffairRow).
// Architecture: docs/CLIENT_HUB_UX_PROPOSAL.md.
// =====================================================================

import Link from "next/link";
import { DOC_STATUS_LABEL, type DocStatus } from "@/lib/types";
import {
  formatMoney,
  type ClientAffairs,
  type AffairGroup,
} from "@/lib/affairs-prototype";
import { fmtDate } from "@/components/affairs/badges";
import { AffairRow } from "@/components/affairs/AffairRow";
import type { Option } from "@/components/affairs/NewProjectPanel";

const SUMMARY_ORDER: DocStatus[] = [
  "draft",
  "sent",
  "negotiating",
  "won",
  "lost",
  "cancelled",
];

const SUMMARY_TONE: Record<DocStatus, string> = {
  draft: "text-neutral-500",
  sent: "text-sky-700",
  negotiating: "text-amber-700",
  won: "text-solux-dark",
  lost: "text-rose-700",
  cancelled: "text-zinc-400",
};

const DEAD_LIFECYCLE = new Set(["lost", "abandoned", "archived"]);

/** An affair counts as "active" unless archived / lost / cancelled. */
function isActiveAffair(a: AffairGroup): boolean {
  if (a.isArchived) return false;
  if (a.effectiveStatus === "lost" || a.effectiveStatus === "cancelled") return false;
  if (a.lifecycleStatus && DEAD_LIFECYCLE.has(a.lifecycleStatus)) return false;
  return true;
}

export function ClientCard({
  client,
  owners,
  canAssignOwner,
}: {
  client: ClientAffairs;
  owners: Option[];
  canAssignOwner: boolean;
}) {
  const value = client.mixedCurrency
    ? "mixed"
    : client.totalValue
      ? formatMoney(client.totalValue, client.currency)
      : "";

  const meta = [
    client.contactName && `Contact ${client.contactName}`,
    client.ownerName && `Owner ${client.ownerName}`,
  ].filter(Boolean) as string[];

  // Open alerts across the client's ACTIVE affairs (relationship-level signal).
  const openAlerts = client.affairs
    .filter(isActiveAffair)
    .reduce((n, a) => n + a.alerts.length, 0);

  const identity = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="truncate text-[17px] font-semibold leading-tight tracking-tightish text-solux-ink group-hover:underline">
          {client.clientName}
        </h2>
        {client.clientCode && (
          <span className="rounded bg-solux-ink/[0.06] px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-solux-ink ring-1 ring-inset ring-neutral-200">
            {client.clientCode}
          </span>
        )}
        {client.country && (
          <span className="text-[12px] text-neutral-400">{client.country}</span>
        )}
        {client.clientId && (
          <span className="text-[11px] text-neutral-400 opacity-0 transition-opacity group-hover:opacity-100">
            Open client →
          </span>
        )}
      </div>
      {meta.length > 0 && (
        <div className="mt-1 text-[11px] text-neutral-500">{meta.join("  ·  ")}</div>
      )}
    </>
  );

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-card ring-1 ring-neutral-200/70">
      {/* header — relationship level, with brand accent rail */}
      <div className="flex items-stretch">
        <div className="w-1 shrink-0 bg-solux/80" aria-hidden />
        <div className="flex flex-1 flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-neutral-200/70 bg-solux-muted px-4 py-3">
          {/* CLICKABLE client identity → Client Hub */}
          {client.clientId ? (
            <Link
              href={`/clients/${client.clientId}`}
              className="group block min-w-0"
            >
              {identity}
            </Link>
          ) : (
            <div className="min-w-0">{identity}</div>
          )}

          <div className="flex flex-col items-end gap-1 text-right">
            <div className="flex items-center gap-1.5 text-[12px]">
              <span className="font-semibold text-solux-ink">
                {client.affairCount} affair{client.affairCount === 1 ? "" : "s"}
              </span>
              {value && (
                <span className="font-medium text-neutral-600 tabular-nums">
                  {value}
                </span>
              )}
              {openAlerts > 0 && (
                <span
                  className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700"
                  title={`${openAlerts} open alert${openAlerts === 1 ? "" : "s"} across active affairs`}
                >
                  ⚠ {openAlerts}
                </span>
              )}
            </div>
            <div className="flex flex-wrap justify-end gap-1">
              {SUMMARY_ORDER.filter((s) => client.statusCounts[s] > 0).map((s) => (
                <span
                  key={s}
                  className="inline-flex items-center gap-1 rounded bg-white px-1.5 py-0.5 text-[10.5px] ring-1 ring-inset ring-neutral-200"
                >
                  <span className={SUMMARY_TONE[s]}>{DOC_STATUS_LABEL[s]}</span>
                  <strong className="tabular-nums text-neutral-700">
                    {client.statusCounts[s]}
                  </strong>
                </span>
              ))}
            </div>
            {client.latestDate && (
              <span className="text-[10px] text-neutral-400">
                updated{" "}
                {fmtDate(client.latestDate, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* affairs — preview level */}
      <div className="divide-y divide-neutral-100">
        {client.affairs.map((a) => (
          <AffairRow
            key={a.anchorId}
            affair={a}
            owners={owners}
            canAssignOwner={canAssignOwner}
          />
        ))}
      </div>
    </div>
  );
}
