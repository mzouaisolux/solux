"use client";

// =====================================================================
// Affair workspace — a COMMERCIAL DEAL workspace (not a PM dashboard).
// Order = what a salesperson reaches for:
//   0. Next action (CRM step 4 — the to-do engine; only on the full page)
//   1. Operational progress (thin pipeline line)
//   2. Quotations (primary — open / edit / duplicate / export PDF)
//   3. Conversation (last message preview + count + open)
//   4. Documents (operational: task list / production order / attachments)
// No Activity feed, no timeline logs. Calm grayscale; status is the only color.
// =====================================================================

import Link from "next/link";
import type { AffairGroup } from "@/lib/affairs-prototype";
import type { ShippingStatusLite } from "@/lib/shipping-status-server";
import type { FreshnessThresholds } from "@/lib/shipping-update";
import { fmtDate } from "@/components/affairs/badges";
import { AffairProgressStrip } from "@/components/affairs/AffairProgressStrip";
import { AffairQuotations } from "@/components/affairs/AffairQuotations";

/** Shipping status bundle threaded from the server page to the quotation list. */
export type ShippingWorkspaceProps = {
  clientName: string;
  shippingStatuses: Record<string, ShippingStatusLite>;
  canRequestShipping: boolean;
  freshnessThresholds: FreshnessThresholds;
};
import { AffairDocumentsCard } from "@/components/affairs/AffairDocumentsCard";
import { AffairActionsCard, type PlannedActionRow } from "@/components/affairs/AffairActionsCard";
import type { AssignableDoc } from "@/components/affairs/AssignDocumentPanel";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
      {children}
    </h3>
  );
}

export function AffairWorkspace({
  affair,
  affairId,
  assignableDocs = [],
  plannedActions,
  clientName,
  shippingStatuses,
  canRequestShipping,
  freshnessThresholds,
  canSetDocStatus,
}: {
  affair: AffairGroup;
  affairId: string;
  assignableDocs?: AssignableDoc[];
  /** CRM step 4 (m103). Omitted (undefined/null) in the client-hub inline
   *  expansion and pre-migration — the card simply doesn't render. */
  plannedActions?: PlannedActionRow[] | null;
  /** hasUiCapability("document.set_status") — Documents status setter. */
  canSetDocStatus?: boolean;
} & Partial<ShippingWorkspaceProps>) {
  const fileDocId = affair.latest?.id ?? affair.documents[0]?.id ?? null;

  return (
    <div className="space-y-5">
      {/* 0. Next action — the deal's to-do engine (PLAN_CRM_SOLUX §8). */}
      {plannedActions != null && (
        <AffairActionsCard affairId={affairId} actions={plannedActions} />
      )}

      {/* 1. Operational progress — thin pipeline line. */}
      <AffairProgressStrip affair={affair} />

      {/* 2. Quotations — the primary deal surface. */}
      <AffairQuotations
        affair={affair}
        affairId={affairId}
        clientName={clientName}
        shippingStatuses={shippingStatuses}
        canRequestShipping={canRequestShipping}
        freshnessThresholds={freshnessThresholds}
      />

      {/* 3. Conversation — preview + count + open. */}
      <section>
        <div className="flex items-center justify-between">
          <SectionLabel>Conversation</SectionLabel>
          <span className="text-[11px] text-neutral-400">
            {affair.messageCount} message{affair.messageCount === 1 ? "" : "s"}
          </span>
        </div>
        <div className="mt-1.5 flex items-start justify-between gap-3">
          {affair.lastMessage ? (
            <p className="min-w-0 flex-1 truncate text-[12px] text-neutral-600">
              <span className="text-neutral-400" aria-hidden>
                💬{" "}
              </span>
              {affair.lastMessage}
              {affair.lastMessageAt && (
                <span className="text-neutral-400">
                  {" "}
                  · {fmtDate(affair.lastMessageAt, { month: "short", day: "numeric" })}
                </span>
              )}
            </p>
          ) : (
            <p className="flex-1 text-[12px] text-neutral-400">No messages yet</p>
          )}
          {affair.latest && (
            <Link
              href={`/documents/${affair.latest.id}`}
              className="shrink-0 rounded-md border border-neutral-300 px-2 py-0.5 text-[11px] font-semibold text-neutral-800 hover:bg-neutral-50"
            >
              Open conversation
            </Link>
          )}
        </div>
      </section>

      {/* 4. Documents — the project's Single Source of Truth repository. */}
      <AffairDocumentsCard
        files={affair.files}
        affairId={affairId}
        documentId={fileDocId}
        taskListId={affair.taskListId}
        productionOrderId={affair.productionOrderId}
        assignableDocs={assignableDocs}
        repository={affair.repository}
        canSetDocStatus={canSetDocStatus}
      />
    </div>
  );
}
