"use client";

// =====================================================================
// Affair (Project) detail — the focused full-screen project page. Minimal
// header (back link · dominant name · one meta line · ⋯ actions) over the
// shared AffairWorkspace. Same calm grayscale language as the expansion.
// =====================================================================

import Link from "next/link";
import { formatMoney, type AffairGroup } from "@/lib/affairs-prototype";
import { fmtDate } from "@/components/affairs/badges";
import {
  affairAccent,
  affairPhaseLabel,
} from "@/components/affairs/AffairProgressStrip";
import { AffairWorkspace } from "@/components/affairs/AffairWorkspace";
import { ProjectActionsMenu } from "@/components/affairs/ProjectActionsMenu";
import { AssignableDoc } from "@/components/affairs/AssignDocumentPanel";
import type { Option } from "@/components/affairs/NewProjectPanel";

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

export function AffairDetail({
  affair,
  affairId,
  clientName,
  owners,
  canAssignOwner,
  assignableDocs,
}: {
  affair: AffairGroup;
  affairId: string;
  clientName: string;
  owners: Option[];
  canAssignOwner: boolean;
  assignableDocs: AssignableDoc[];
}) {
  const accent = affairAccent(affair);
  const value = affair.totalValue ? formatMoney(affair.totalValue, affair.currency) : "";
  const phaseLabel = affairPhaseLabel(affair);
  const statusWord = STATUS_LABEL[affair.effectiveStatus] ?? affair.effectiveStatus;
  const docCount = affair.documents.length;

  return (
    <div className="mx-auto max-w-[920px] px-6 py-6">
      <Link
        href={affair.clientId ? `/clients/${affair.clientId}?tab=affairs` : "/clients"}
        className="text-[12px] text-neutral-500 hover:text-neutral-800"
      >
        ← Back to client
      </Link>

      {/* HEADER */}
      <div className="mt-3 flex items-start gap-3">
        <div className={`mt-1 h-9 w-[3px] shrink-0 rounded ${accent.bar}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold tracking-tight text-neutral-900">
            {affair.displayName}
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] text-neutral-500">
            <span className="text-neutral-600">{clientName}</span>
            <span className="text-neutral-300">·</span>
            <span className={statusColor(affair.effectiveStatus)}>{statusWord}</span>
            <span className="text-neutral-300">·</span>
            <span>{phaseLabel}</span>
            {value && (
              <>
                <span className="text-neutral-300">·</span>
                <span className="font-semibold text-neutral-800">{value}</span>
              </>
            )}
            {affair.eta && (
              <>
                <span className="text-neutral-300">·</span>
                <span>ETA {fmtDate(affair.eta, { month: "short", day: "numeric" })}</span>
              </>
            )}
            <span className="text-neutral-300">·</span>
            <span>
              {docCount} Document{docCount === 1 ? "" : "s"}
            </span>
            {affair.affairOwnerName && (
              <>
                <span className="text-neutral-300">·</span>
                <span>Owner {affair.affairOwnerName}</span>
              </>
            )}
          </div>
        </div>
        <ProjectActionsMenu
          affairId={affairId}
          name={affair.displayName}
          ownerId={affair.affairOwnerId}
          owners={owners}
          canAssignOwner={canAssignOwner}
        />
      </div>

      {/* BODY */}
      <div className="mt-5 border-t border-neutral-200 pt-5">
        <AffairWorkspace affair={affair} affairId={affairId} assignableDocs={assignableDocs} />
      </div>
    </div>
  );
}
