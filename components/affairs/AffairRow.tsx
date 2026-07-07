"use client";

// =====================================================================
// Affair (Project) card — the PROJECT HEADER. Dominant name + one muted
// meta line (Status · Phase · Amount · ETA · N Documents), a thin status
// edge (green=won, orange=follow-up, red=problem, neutral else) and a ⋯
// actions menu. Expands to the calm AffairWorkspace (lazy-mounted).
// White bg, light-gray border, dark text. Architecture: docs/CLIENT_HUB_UX_PROPOSAL.md.
// =====================================================================

import { useState } from "react";
import Link from "next/link";
import { formatMoney, type AffairGroup } from "@/lib/affairs-prototype";
import { fmtDate } from "@/components/affairs/badges";
import {
  AffairProgressStrip,
  affairPhaseLabel,
  affairAccent,
} from "@/components/affairs/AffairProgressStrip";
import { Collapse } from "@/components/ui/Collapse";
import { AffairVersionsTable } from "@/components/affairs/AffairVersionsTable";
import { AffairWorkspace, type ShippingWorkspaceProps } from "@/components/affairs/AffairWorkspace";
import { ProjectActionsMenu } from "@/components/affairs/ProjectActionsMenu";
import { AssignableDoc } from "@/components/affairs/AssignDocumentPanel";
import type { Option } from "@/components/affairs/NewProjectPanel";

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={`mt-1.5 h-3.5 w-3.5 shrink-0 text-neutral-400 transition-transform duration-150 group-hover:text-neutral-600 ${
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

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  negotiating: "Negotiating",
  won: "Won",
  lost: "Lost",
  cancelled: "Cancelled",
};

function statusColor(status: string): string {
  if (status === "won") return "text-emerald-700 font-medium";
  if (status === "lost" || status === "cancelled") return "text-rose-700 font-medium";
  if (status === "negotiating") return "text-amber-700 font-medium";
  return "text-neutral-500";
}

function Dot() {
  return <span className="text-neutral-300">·</span>;
}

export function AffairRow({
  affair,
  owners = [],
  canAssignOwner = false,
  assignableDocs = [],
  clientName,
  shippingStatuses,
  canRequestShipping,
  freshnessThresholds,
  canSetDocStatus,
}: {
  affair: AffairGroup;
  owners?: Option[];
  canAssignOwner?: boolean;
  assignableDocs?: AssignableDoc[];
  canSetDocStatus?: boolean;
} & Partial<ShippingWorkspaceProps>) {
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);

  const accent = affairAccent(affair);
  const value = affair.totalValue
    ? formatMoney(affair.totalValue, affair.currency)
    : "";
  const docCount = affair.documents.length;
  const phaseLabel = affairPhaseLabel(affair);
  const statusWord =
    STATUS_LABEL[affair.effectiveStatus] ?? affair.effectiveStatus;

  function toggle() {
    setOpen((v) => {
      if (!v) setOpened(true);
      return !v;
    });
  }

  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white transition-colors hover:border-neutral-300">
      <div className="flex items-stretch">
        {/* thin status edge — the one accent */}
        <div className={`w-[3px] shrink-0 ${accent.bar}`} aria-hidden />

        <div className="min-w-0 flex-1">
          {/* PROJECT HEADER */}
          <div className="flex items-start gap-2 px-4 py-3">
            <button
              type="button"
              onClick={toggle}
              className="group flex min-w-0 flex-1 items-start gap-2.5 text-left"
            >
              <Chevron open={open} />
              <div className="min-w-0">
                <div className="truncate text-[17px] font-semibold tracking-tight text-neutral-900">
                  {affair.displayName}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] text-neutral-500">
                  <span className={statusColor(affair.effectiveStatus)}>
                    {statusWord}
                  </span>
                  <Dot />
                  <span>{phaseLabel}</span>
                  {value && (
                    <>
                      <Dot />
                      <span className="font-semibold text-neutral-800">{value}</span>
                    </>
                  )}
                  {affair.eta && (
                    <>
                      <Dot />
                      <span>
                        ETA {fmtDate(affair.eta, { month: "short", day: "numeric" })}
                      </span>
                    </>
                  )}
                  <Dot />
                  <span>
                    {docCount} Document{docCount === 1 ? "" : "s"}
                  </span>
                  {affair.alerts.length > 0 && (
                    <>
                      <Dot />
                      <span className="font-medium text-rose-600" title={affair.alerts.join(" · ")}>
                        ⚠ {affair.alerts.length}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </button>
            {affair.affairId && (
              <ProjectActionsMenu
                affairId={affair.affairId}
                name={affair.displayName}
                ownerId={affair.affairOwnerId}
                owners={owners}
                canAssignOwner={canAssignOwner}
              />
            )}
          </div>

          {/* EXPANDED — calm operational workspace (lazy-mounted). */}
          <Collapse open={open}>
            <div className="border-t border-neutral-100 px-4 py-4 pl-10">
              {opened &&
                (affair.affairId ? (
                  <AffairWorkspace
                    affair={affair}
                    affairId={affair.affairId}
                    assignableDocs={assignableDocs}
                    clientName={clientName}
                    shippingStatuses={shippingStatuses}
                    canRequestShipping={canRequestShipping}
                    freshnessThresholds={freshnessThresholds}
                    canSetDocStatus={canSetDocStatus}
                  />
                ) : (
                  <div className="space-y-2">
                    <AffairProgressStrip affair={affair} />
                    <AffairVersionsTable affair={affair} />
                    {affair.latest && (
                      <div className="flex justify-end">
                        <Link
                          href={`/documents/${affair.latest.id}`}
                          className="text-[11px] font-medium text-neutral-600 hover:text-neutral-900"
                        >
                          Open latest →
                        </Link>
                      </div>
                    )}
                  </div>
                ))}
            </div>
          </Collapse>
        </div>
      </div>
    </div>
  );
}
