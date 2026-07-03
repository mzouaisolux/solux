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
import {
  AffairInvoicesCard,
  type AffairInvoiceFamily,
} from "@/components/affairs/AffairInvoicesCard";
import { ProjectActionsMenu } from "@/components/affairs/ProjectActionsMenu";
import { AssignableDoc } from "@/components/affairs/AssignDocumentPanel";
import type { Option } from "@/components/affairs/NewProjectPanel";
import type { PlannedActionRow } from "@/components/affairs/AffairActionsCard";
import { AFFAIR_SOURCE_OPTIONS } from "@/components/affairs/affair-sources";
import { setAffairSource } from "@/app/(app)/affairs/actions";

/** m109 — origin context for tender-sourced opportunities (read at the
 *  source per Règle #0: buyer / closing / reference / documents). */
export type TenderOrigin = {
  id: string;
  buyer: string | null;
  country: string | null;
  deadline: string | null;
  reference: string | null;
  platform: string | null;
  source_url: string | null;
  documents: Array<{ type?: string; name?: string; url?: string | null }>;
};

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
  invoiceFamilies = [],
  source,
  plannedActions,
  tenderOrigin,
}: {
  affair: AffairGroup;
  affairId: string;
  clientName: string;
  owners: Option[];
  canAssignOwner: boolean;
  assignableDocs: AssignableDoc[];
  /** m141 — the deal's commercial invoices + legal invoices. */
  invoiceFamilies?: AffairInvoiceFamily[];
  /** CRM step 3 (m102): where the deal came from. */
  source?: string | null;
  /** CRM step 4 (m103): the deal's planned actions (null pre-migration). */
  plannedActions?: PlannedActionRow[] | null;
  /** m109 — tender origin (banner + inherited documents). */
  tenderOrigin?: TenderOrigin | null;
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
            {/* CRM step 3 (m102): source — readable inline, editable in place. */}
            {source !== undefined && (
              <>
                <span className="text-neutral-300">·</span>
                <form action={setAffairSource} className="inline-flex items-center gap-1">
                  <input type="hidden" name="id" value={affairId} />
                  <span>Source</span>
                  <select
                    name="source"
                    defaultValue={source ?? ""}
                    onChange={(e) => e.currentTarget.form?.requestSubmit()}
                    className="cursor-pointer rounded border-none bg-transparent p-0 text-[13px] text-neutral-600 underline decoration-dotted underline-offset-2 focus:outline-none"
                    title="Where did this deal come from?"
                  >
                    <option value="">—</option>
                    {AFFAIR_SOURCE_OPTIONS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </form>
              </>
            )}
          </div>
        </div>
        {/* m109 — Option B of the tender workflow: create the technical
            request from the opportunity. Full form, pre-filled. */}
        <Link
          href={`/projects/new?affair=${affairId}`}
          className="shrink-0 rounded-md bg-neutral-900 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-black"
        >
          Create Service Request →
        </Link>
        <ProjectActionsMenu
          affairId={affairId}
          name={affair.displayName}
          ownerId={affair.affairOwnerId}
          owners={owners}
          canAssignOwner={canAssignOwner}
        />
      </div>

      {/* m109 — SOURCE: TENDER banner. A tender-sourced opportunity keeps
          its origin visible: buyer, country, closing, reference, documents
          — read from the linked tender, never duplicated. */}
      {tenderOrigin && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50/70 px-4 py-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="rounded bg-amber-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              Source: Tender
            </span>
            <span className="text-[12px] font-semibold text-amber-900">
              Imported from Tender Intelligence
            </span>
            {!affair.clientId && (
              <span className="rounded border border-amber-400 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800">
                Partner: not assigned yet
              </span>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-0.5 text-[12.5px] text-amber-900">
            {tenderOrigin.buyer && <span>Buyer: <b>{tenderOrigin.buyer}</b></span>}
            {tenderOrigin.country && <span>Country: <b>{tenderOrigin.country}</b></span>}
            {tenderOrigin.deadline && <span>Closing date: <b>{tenderOrigin.deadline}</b></span>}
            {tenderOrigin.reference && <span>Tender reference: <b>{tenderOrigin.reference}</b></span>}
          </div>
          {(tenderOrigin.documents.length > 0 || tenderOrigin.source_url) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[11.5px]">
              {tenderOrigin.documents
                .filter((d) => d.url)
                .map((d, i) => (
                  <a
                    key={i}
                    href={d.url!}
                    target="_blank"
                    rel="noreferrer"
                    className="text-amber-900 underline decoration-dotted underline-offset-2 hover:text-amber-700"
                  >
                    📎 {d.type ?? "DOC"} · {d.name ?? "Document"}
                  </a>
                ))}
              {tenderOrigin.source_url && (
                <a
                  href={tenderOrigin.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-amber-900 underline decoration-dotted underline-offset-2 hover:text-amber-700"
                >
                  Open source tender ↗
                </a>
              )}
            </div>
          )}
        </div>
      )}

      {/* BODY */}
      <div className="mt-5 border-t border-neutral-200 pt-5">
        <AffairWorkspace
          affair={affair}
          affairId={affairId}
          assignableDocs={assignableDocs}
          plannedActions={plannedActions}
        />

        {invoiceFamilies.length > 0 && (
          <div className="mt-8 border-t border-neutral-200 pt-6">
            <AffairInvoicesCard families={invoiceFamilies} />
          </div>
        )}
      </div>
    </div>
  );
}
