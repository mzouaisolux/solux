"use client";

// =====================================================================
// Affair workspace — the OPERATIONAL starting point of a project (owner
// 2026-07-10: this is an ERP for solar lighting projects, not a CRM — a
// project generates quotations, studies, costings and requests, so those
// are what the page pushes first). Order = what moves the project forward:
//   0. Get started (new project only — first quotation / first request)
//   1. Operational progress (thin pipeline line)
//   2. Quotations (primary — open / edit / duplicate / export PDF)
//   3. Requests (Service Requests linked to this affair)
//   4. Documents (operational: task list / production order / attachments)
//   5. Conversation (preview — kept last; communication, not the focus)
// The CRM "Next action" card (AffairActionsCard, PLAN_CRM_SOLUX §8) is
// deliberately NOT rendered — the CRM module will be redesigned later;
// the component is kept for that redesign.
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
import { RequestHub } from "@/components/requests/RequestHub";
import type { AssignableDoc } from "@/components/affairs/AssignDocumentPanel";
import { ProfitabilityBadge } from "@/components/profitability/ProfitabilityBadge";
import type { ProfitabilityResult } from "@/lib/profitability";

/** A Service Request linked to this affair (Requests section). */
export type AffairRequestLite = {
  id: string;
  name: string | null;
  status: string | null;
  created_at: string | null;
};

/** A Transport Request row (m161) — the Requests section is the single
 *  source of truth for EVERY request on the project (owner 2026-07-11),
 *  so transport requests render here too, with the COMPLETE Operations
 *  answer expandable inline (sales must never have to ask what happened). */
export type AffairTransportRequestLite = {
  id: string;
  kind: string;
  status: string | null;
  reason: string | null;
  freight_cost: number | null;
  insurance_cost: number | null;
  additional_charges?: Array<{ label: string; amount: number }> | null;
  transit_time_days: number | null;
  transport_mode?: string | null;
  cbm: number | null;
  gross_weight_kg: number | null;
  net_weight_kg?: number | null;
  cartons_count: number | null;
  pallets_count: number | null;
  incoterm: string | null;
  destination_country: string | null;
  destination_port: string | null;
  delivery_address?: string | null;
  valid_until: string | null;
  ops_comments: string | null;
  requested_at: string | null;
  requested_by: string | null;
  completed_at: string | null;
  completed_by: string | null;
};

const REQUEST_STATUS_COLOR: Record<string, string> = {
  approved: "text-emerald-700",
  rejected: "text-rose-700",
  cancelled: "text-rose-700",
  completed: "text-emerald-700",
  waiting: "text-amber-700",
  in_progress: "text-sky-700",
};

const TRANSPORT_KIND_LABEL: Record<string, string> = {
  packing_list: "Packing List Request",
  price: "Transport Quotation Request",
  price_update: "Price Update Request",
};

function fmtUsd(n: number | null | undefined): string | null {
  if (n == null) return null;
  return `${Number(n).toLocaleString()} USD`;
}

/** label/value pair inside the expanded Operations answer. */
function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === "" || value === "—") return null;
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] uppercase tracking-wide text-neutral-400">{label}</div>
      <div className="text-[12.5px] text-neutral-800">{value}</div>
    </div>
  );
}

/** One transport request row — status line + expandable full record. */
function TransportRequestRow({
  r,
  userLabels,
}: {
  r: AffairTransportRequestLite;
  userLabels: Record<string, string>;
}) {
  const status = (r.status ?? "waiting").replace(/_/g, " ");
  const done = r.status === "completed";
  const charges = Array.isArray(r.additional_charges) ? r.additional_charges : [];
  const destination = [r.destination_port, r.destination_country]
    .filter(Boolean)
    .join(", ");
  return (
    <li>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 hover:bg-neutral-50 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-neutral-800">
            {TRANSPORT_KIND_LABEL[r.kind] ?? "Transport Request"}
            {r.reason ? (
              <span className="ml-2 font-normal text-neutral-400">· {r.reason}</span>
            ) : null}
          </span>
          <span
            className={`shrink-0 text-[11px] font-medium capitalize ${
              REQUEST_STATUS_COLOR[r.status ?? ""] ?? "text-neutral-500"
            }`}
          >
            {status}
          </span>
          {(r.completed_at || r.requested_at) && (
            <span className="shrink-0 text-[11px] text-neutral-400">
              {fmtDate(r.completed_at ?? r.requested_at!, { month: "short", day: "numeric" })}
            </span>
          )}
          <span className="shrink-0 text-[11px] text-neutral-300 transition-transform group-open:rotate-90">
            ▸
          </span>
        </summary>
        {/* THE COMPLETE RECORD — everything Operations answered, in place.
            Sales must never need to ask what happened. */}
        <div className="border-t border-neutral-100 bg-neutral-50/60 px-3 py-2.5">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            <Fact label="Freight cost" value={fmtUsd(r.freight_cost)} />
            <Fact label="Insurance" value={fmtUsd(r.insurance_cost)} />
            {charges.map((c, i) => (
              <Fact key={i} label={c.label || "Charge"} value={fmtUsd(c.amount)} />
            ))}
            <Fact
              label="Transit time"
              value={r.transit_time_days != null ? `${r.transit_time_days} days` : null}
            />
            <Fact
              label="Valid until"
              value={r.valid_until ? fmtDate(r.valid_until, { day: "numeric", month: "short", year: "numeric" }) : null}
            />
            <Fact label="Destination" value={destination || r.delivery_address} />
            <Fact label="Incoterm" value={r.incoterm} />
            <Fact label="CBM" value={r.cbm != null ? String(r.cbm) : null} />
            <Fact
              label="Weight"
              value={
                r.gross_weight_kg != null
                  ? `GW ${r.gross_weight_kg} kg${r.net_weight_kg != null ? ` · NW ${r.net_weight_kg} kg` : ""}`
                  : null
              }
            />
            <Fact
              label="Packing"
              value={
                r.cartons_count != null || r.pallets_count != null
                  ? [
                      r.cartons_count != null ? `${r.cartons_count} cartons` : null,
                      r.pallets_count != null ? `${r.pallets_count} pallets` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : null
              }
            />
            <Fact
              label={done ? "Completed" : "Requested"}
              value={
                done && r.completed_at
                  ? `${fmtDate(r.completed_at, { day: "numeric", month: "short" })}${
                      r.completed_by ? ` by ${userLabels[r.completed_by] ?? "Operations"}` : ""
                    }`
                  : r.requested_at
                  ? `${fmtDate(r.requested_at, { day: "numeric", month: "short" })}${
                      r.requested_by ? ` by ${userLabels[r.requested_by] ?? "—"}` : ""
                    }`
                  : null
              }
            />
          </div>
          {r.ops_comments ? (
            <p className="mt-2 rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-[12px] text-neutral-700">
              <span className="font-medium text-neutral-500">Operations: </span>
              {r.ops_comments}
            </p>
          ) : done ? null : (
            <p className="mt-2 text-[11.5px] text-neutral-400">
              Waiting for the Operations answer — it will appear here in full.
            </p>
          )}
        </div>
      </details>
    </li>
  );
}

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
  requests,
  transportRequests = [],
  transportUserLabels = {},
  canCreateRequest = false,
  clientName,
  shippingStatuses,
  canRequestShipping,
  freshnessThresholds,
  canSetDocStatus,
  profitability,
}: {
  affair: AffairGroup;
  affairId: string;
  assignableDocs?: AssignableDoc[];
  /** Service Requests linked to this affair. Omitted (undefined/null) in the
   *  client-hub inline expansion — the section simply doesn't render. */
  requests?: AffairRequestLite[] | null;
  /** Transport Requests (m161) — merged into the same Requests section so
   *  it is the single source of truth for every request on the project. */
  transportRequests?: AffairTransportRequestLite[];
  /** user_id → display label (requested_by / completed_by). */
  transportUserLabels?: Record<string, string>;
  /** hasUiCapability("project.create") — enables the Get-started New Request hub. */
  canCreateRequest?: boolean;
  /** hasUiCapability("document.set_status") — Documents status setter. */
  canSetDocStatus?: boolean;
  /** m152 management widget — only ever passed to capability holders; the
   *  badge renders nothing when absent (sales never receives margins). */
  profitability?: ProfitabilityResult | null;
} & Partial<ShippingWorkspaceProps>) {
  const fileDocId = affair.latest?.id ?? affair.documents[0]?.id ?? null;

  const isNewProject = affair.documents.length === 0;

  return (
    <div className="space-y-5">
      {/* 0. Get started — a brand-new project has ONE question: "what do I
          want to create first?". Quotation first, internal request second.
          Disappears as soon as the first quotation exists. */}
      {isNewProject && (
        <div className="rounded-lg border border-neutral-900 bg-neutral-50 px-4 py-3.5">
          <p className="text-[13px] font-semibold text-neutral-900">
            Start working on this project
          </p>
          <p className="mt-0.5 text-[12px] text-neutral-500">
            Create the first quotation, or send an internal request (costing,
            study, transport…) to prepare it.
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <Link
              href={`/documents/new?affair=${affairId}`}
              className="inline-flex items-center rounded-md bg-neutral-900 px-4 py-2 text-[13px] font-semibold text-white hover:bg-black"
            >
              + Create New Quotation
            </Link>
            <RequestHub affairId={affairId} canCreate={canCreateRequest} />
          </div>
        </div>
      )}

      {/* 1. Operational progress — thin pipeline line. */}
      <AffairProgressStrip affair={affair} />

      {/* 1b. Profitability (management only — m152). One glance: is this
          project healthy? Full breakdown one click away. */}
      <ProfitabilityBadge data={profitability} affairId={affairId} />

      {/* 2. Quotations — the primary deal surface. */}
      <AffairQuotations
        affair={affair}
        affairId={affairId}
        clientName={clientName}
        shippingStatuses={shippingStatuses}
        canRequestShipping={canRequestShipping}
        freshnessThresholds={freshnessThresholds}
      />

      {/* 3. Requests — the SINGLE SOURCE OF TRUTH for every request attached
          to this project (owner 2026-07-11): Service Requests (costing,
          custom products, studies) AND Transport Requests (packing lists,
          freight quotations, price updates), one chronological list. A
          transport row expands to the COMPLETE Operations answer. */}
      {requests != null && (
        <section>
          <div className="flex items-center justify-between">
            <SectionLabel>Requests</SectionLabel>
            <span className="text-[11px] text-neutral-400">
              {requests.length + transportRequests.length || ""}
            </span>
          </div>
          {requests.length + transportRequests.length === 0 ? (
            <p className="mt-1.5 text-[12px] text-neutral-400">
              No requests yet — costing, studies and transport requests
              created with ➕ New Request will land here.
            </p>
          ) : (
            <ul className="mt-1.5 divide-y divide-neutral-100 rounded-md border border-neutral-200">
              {[
                ...requests.map((r) => ({ sort: r.created_at ?? "", sr: r, tr: null as AffairTransportRequestLite | null })),
                ...transportRequests.map((t) => ({ sort: t.requested_at ?? "", sr: null as AffairRequestLite | null, tr: t })),
              ]
                .sort((a, b) => (b.sort || "").localeCompare(a.sort || ""))
                .map((row) =>
                  row.tr ? (
                    <TransportRequestRow key={`tr-${row.tr.id}`} r={row.tr} userLabels={transportUserLabels} />
                  ) : (
                    <li key={row.sr!.id}>
                      <Link
                        href={`/projects/${row.sr!.id}`}
                        className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-neutral-50"
                      >
                        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-neutral-800">
                          {row.sr!.name || "Service Request"}
                        </span>
                        <span
                          className={`shrink-0 text-[11px] font-medium capitalize ${
                            REQUEST_STATUS_COLOR[row.sr!.status ?? ""] ?? "text-neutral-500"
                          }`}
                        >
                          {(row.sr!.status ?? "—").replace(/_/g, " ")}
                        </span>
                        {row.sr!.created_at && (
                          <span className="shrink-0 text-[11px] text-neutral-400">
                            {fmtDate(row.sr!.created_at, { month: "short", day: "numeric" })}
                          </span>
                        )}
                      </Link>
                    </li>
                  )
                )}
            </ul>
          )}
        </section>
      )}

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

      {/* 5. Conversation — kept last: useful, but communication is not the
          operational focus of the project page. */}
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
    </div>
  );
}
