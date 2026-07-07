// =====================================================================
// Affair (Project) detail page — /affairs/[id]. P2b-2.
//
// Loads ONE affair, its documents, files/conversation/timeline, and the
// client's other quotations available to assign. Read-mostly; writes are
// affair edits + document↔project assignment (reversible). RLS-scoped.
// =====================================================================

import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveUserLabelStrings } from "@/lib/user-display";
import { listAssignableOwners } from "@/lib/owner";
import { getCurrentUserRole } from "@/lib/auth";
import { hasUiCapability } from "@/lib/permissions";
import { isTechnicalRole } from "@/lib/types";
import { loadShippingStatuses } from "@/lib/shipping-status-server";
import { loadProjectRepositories } from "@/lib/project-documents-server";
import { getNumberSetting } from "@/lib/app-settings";
import {
  FRESHNESS_WARN_DAYS_KEY,
  FRESHNESS_CRITICAL_DAYS_KEY,
  FRESHNESS_DEFAULTS,
} from "@/lib/shipping-update";
import {
  groupIntoAffairs,
  buildAffairFiles,
  type PrototypeDoc,
  type ClientInfo,
  type EventLite,
  type AffairRecord,
  type AffairGroup,
  type AttachmentLite,
} from "@/lib/affairs-prototype";
import { AffairDetail } from "@/components/affairs/AffairDetail";
import type { AssignableDoc } from "@/components/affairs/AssignDocumentPanel";
import {
  fetchFamiliesForAffair,
  fetchPdfContext,
  toInvoicePdfData,
  familyRollup,
} from "@/lib/invoicing-server";
import type { AffairInvoiceFamily } from "@/components/affairs/AffairInvoicesCard";

export const dynamic = "force-dynamic";

const FILE_BUCKET: Record<string, string> = {
  photo: "Photos",
  rendering: "Photos",
  technical_spec: "Technical",
  mechanical_drawing: "Technical",
  dimension_drawing: "Technical",
  dialux: "Technical",
  approved_doc: "Technical",
  inspection: "Inspection",
  tender: "Commercial",
  packaging_artwork: "Commercial",
  logo: "Commercial",
  special_instructions: "Commercial",
  other: "Other",
};
const FILE_ORDER = ["Photos", "Technical", "Inspection", "Commercial", "Other"];
const DOC_COLS =
  "id, number, client_id, root_document_id, version, affair_name, status, type, date, total_price, currency, forecast_probability, archived_at, affair_id, pdf_url";

export default async function AffairDetailPage({ params }: { params: { id: string } }) {
  const id = params.id;
  const supabase = createClient();

  // select * so the page works whether or not m102 (source) is applied —
  // explicit column lists would 400 on a missing column.
  const { data: affairRec } = await supabase
    .from("affairs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!affairRec) notFound();
  const affair = affairRec as AffairRecord & { source?: string | null };

  // CRM step 4 (m103): the deal's planned actions. Defensive pre-migration:
  // an error (table missing) → null → the card simply doesn't render.
  const { data: paRows, error: paError } = await supabase
    .from("planned_actions")
    .select("id, affair_id, action_type, title, due_date, done_at, notes, created_at")
    .eq("affair_id", id)
    .order("due_date", { ascending: true });
  const plannedActions = paError ? null : ((paRows ?? []) as any[]);

  const sourceTenderId = (affair as any).source_tender_id as string | null;
  const [{ role }, ownerOptionsRaw, documentsRes, clientRes, tenderRes] = await Promise.all([
    getCurrentUserRole(),
    listAssignableOwners(),
    supabase.from("documents").select(DOC_COLS).eq("affair_id", id),
    affair.client_id
      ? supabase
          .from("clients")
          .select("id, company_name, client_code, country, contact_name, sales_owner_id")
          .eq("id", affair.client_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    // m109 — tender origin for the SOURCE: TENDER banner (buyer, closing,
    // reference, documents — read at the source, never duplicated).
    sourceTenderId
      ? supabase
          .from("tenders")
          .select("id, buyer, country, deadline, reference, platform, source_url, documents")
          .eq("id", sourceTenderId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const canAssignOwner = isTechnicalRole(role);

  const documents = (documentsRes.data ?? []) as PrototypeDoc[];
  const clientInfo = (clientRes.data ?? null) as ClientInfo | null;
  const clients = new Map<string, ClientInfo>();
  if (clientInfo) clients.set(clientInfo.id, clientInfo);
  const affairsById = new Map<string, AffairRecord>([[id, affair]]);

  // task list / production status + owner names
  const docIds = documents.map((d) => d.id);
  const ownerNames = affair.owner_id
    ? await resolveUserLabelStrings([affair.owner_id])
    : new Map<string, string>();

  const [taskListsRes, ordersRes, eventsRes, messagesRes, attachmentsRes] =
    await Promise.all([
      docIds.length
        ? supabase.from("production_task_lists").select("id, quotation_id, status").in("quotation_id", docIds)
        : Promise.resolve({ data: [] as any[] }),
      docIds.length
        ? supabase
            .from("production_orders")
            .select("id, quotation_id, status, current_production_deadline, eta")
            .in("quotation_id", docIds)
        : Promise.resolve({ data: [] as any[] }),
      docIds.length
        ? supabase
            .from("events")
            .select("id, entity_id, event_type, severity, message, created_at")
            .eq("entity_type", "document")
            .in("entity_id", docIds)
            .order("created_at", { ascending: false })
            .limit(500)
        : Promise.resolve({ data: [] as any[] }),
      docIds.length
        ? supabase
            .from("entity_messages")
            .select("entity_id, created_at, message")
            .eq("entity_type", "document")
            .in("entity_id", docIds)
            .limit(1000)
        : Promise.resolve({ data: [] as any[] }),
      supabase
        .from("attachments")
        .select("id, affair_id, file_name, file_size, attachment_type, created_at, uploaded_by"),
    ]);

  const taskListStatusByDoc = new Map<string, string>();
  for (const t of taskListsRes.data ?? []) {
    if (t.quotation_id) taskListStatusByDoc.set(t.quotation_id, t.status ?? "");
  }
  const prodStatusByDoc = new Map<string, string>();
  for (const o of ordersRes.data ?? []) {
    if (o.quotation_id) prodStatusByDoc.set(o.quotation_id, o.status ?? "");
  }
  const eventsByDoc = new Map<string, EventLite[]>();
  for (const e of eventsRes.data ?? []) {
    const lite: EventLite = {
      id: e.id,
      event_type: e.event_type,
      severity: e.severity,
      message: e.message,
      created_at: e.created_at,
    };
    const arr = eventsByDoc.get(e.entity_id);
    if (arr) arr.push(lite);
    else eventsByDoc.set(e.entity_id, [lite]);
  }

  const grouped = groupIntoAffairs(
    documents,
    clients,
    ownerNames,
    taskListStatusByDoc,
    prodStatusByDoc,
    eventsByDoc,
    affairsById,
  );
  const group: AffairGroup | undefined = grouped
    .flatMap((c) => c.affairs)
    .find((a) => a.affairId === id);
  if (!group) notFound();

  // Enrich files + conversation summary for this affair.
  const attachTypes: string[] = [];
  for (const at of attachmentsRes.data ?? []) {
    if (at.affair_id === group.anchorId) attachTypes.push(at.attachment_type ?? "other");
  }
  const pdfDocs = group.documents.filter((d) => d.pdf_url);
  const latestPdfDoc = pdfDocs.length
    ? pdfDocs.reduce((acc, d) => ((d.version ?? 1) >= (acc.version ?? 1) ? d : acc))
    : null;
  const counts = new Map<string, number>();
  for (const t of attachTypes) {
    const b = FILE_BUCKET[t] ?? "Other";
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  const buckets: { label: string; count: number }[] = [];
  if (latestPdfDoc)
    buckets.push({
      label: latestPdfDoc.type === "proforma" ? "Proforma" : "Quotation PDF",
      count: 1,
    });
  for (const b of FILE_ORDER) {
    const n = counts.get(b) ?? 0;
    if (n > 0) buckets.push({ label: b, count: n });
  }
  group.fileBuckets = buckets;
  group.fileTotal = (latestPdfDoc ? 1 : 0) + attachTypes.length;
  group.messageCount = (messagesRes.data ?? []).length;
  group.lastMessageAt =
    (messagesRes.data ?? []).reduce<string | null>(
      (acc, m) => (m.created_at && (!acc || m.created_at > acc) ? m.created_at : acc),
      null,
    ) ?? null;

  // Real clickable file list — generated PDFs + uploaded attachments.
  group.files = buildAffairFiles(group, (attachmentsRes.data ?? []) as AttachmentLite[]);
  group.fileTotal = group.files.length;

  // Latest message preview for the Conversation section.
  group.lastMessage =
    (messagesRes.data ?? [])
      .slice()
      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))[0]
      ?.message ?? null;

  // Linked operational records (Task List / Production Order) for quick links.
  const groupDocIds = new Set(group.documents.map((d) => d.id));
  group.taskListId =
    (taskListsRes.data ?? []).find(
      (t: any) => t.id && groupDocIds.has(t.quotation_id),
    )?.id ?? null;
  group.productionOrderId =
    (ordersRes.data ?? []).find(
      (o: any) => o.id && groupDocIds.has(o.quotation_id),
    )?.id ?? null;

  // ETA / production deadline of the most-advanced linked PO.
  const etaByDoc = new Map<string, string>();
  for (const o of ordersRes.data ?? []) {
    if (!o.quotation_id) continue;
    const v = (o as any).eta ?? (o as any).current_production_deadline ?? null;
    if (v) etaByDoc.set(o.quotation_id, v);
  }
  let groupEta: string | null = null;
  for (const d of group.documents) {
    const e = etaByDoc.get(d.id);
    if (e) groupEta = e;
  }
  group.eta = groupEta;

  // Assignable quotations: the client's OTHER families (latest version each),
  // not already in this affair.
  let assignableDocs: AssignableDoc[] = [];
  if (affair.client_id) {
    const { data: clientDocs } = await supabase
      .from("clients")
      .select("id")
      .eq("id", affair.client_id)
      .maybeSingle();
    if (clientDocs) {
      const { data: docs } = await supabase
        .from("documents")
        .select("id, number, type, status, version, root_document_id, affair_id")
        .eq("client_id", affair.client_id);
      const byFamily = new Map<string, any>();
      for (const d of docs ?? []) {
        const root = (d.root_document_id as string | null) ?? d.id;
        const cur = byFamily.get(root);
        if (!cur || (d.version ?? 1) >= (cur.version ?? 1)) byFamily.set(root, d);
      }
      assignableDocs = Array.from(byFamily.values())
        .filter((d) => d.affair_id !== id)
        .map((d) => ({
          id: d.id as string,
          number: d.number as string | null,
          type: d.type as string,
          status: d.status as string,
        }));
    }
  }

  // Tender-sourced opportunities legitimately start clientless (m108/m109):
  // the label reflects the real state instead of looking like an error.
  const clientName =
    clientInfo?.company_name ??
    ((affair as any).source === "tender"
      ? "Partner not assigned yet"
      : "Unknown / unlinked client");
  const owners = ownerOptionsRaw.map((o) => ({ id: o.id, name: o.name }));

  // Invoices of this affair (m141) — assembled with per-invoice PDF data so
  // the client card can Preview / Download / Send without another round-trip.
  // Defensive: any failure (pre-m141 env) → empty, the card simply hides.
  let invoiceFamilies: AffairInvoiceFamily[] = [];
  try {
    const families = await fetchFamiliesForAffair(supabase, id);
    if (families.length) {
      const ctxByClient = new Map<string, Awaited<ReturnType<typeof fetchPdfContext>>>();
      for (const fam of families) {
        const key = fam.client_id ?? "__none__";
        if (!ctxByClient.has(key)) {
          ctxByClient.set(key, await fetchPdfContext(supabase, fam.client_id));
        }
      }
      invoiceFamilies = families.map((fam) => {
        const ctx = ctxByClient.get(fam.client_id ?? "__none__")!;
        const rollup = familyRollup(fam);
        return {
          id: fam.id,
          commercial_number: fam.commercial_number,
          source_document_id: fam.source_document_id,
          source_number: fam.source_number,
          total_amount: fam.total_amount,
          currency: fam.currency,
          client_name: fam.client_name,
          client_email: ctx.client?.email ?? null,
          invoiced: rollup.invoiced,
          paid: rollup.paid,
          remaining: rollup.remaining,
          invoices: fam.invoices.map((inv) => ({
            id: inv.id,
            accounting_number: inv.accounting_number,
            invoice_type: inv.invoice_type,
            label: inv.label,
            status: inv.status,
            amount: inv.amount,
            paid: inv.paid,
            pdfData: toInvoicePdfData(fam, inv, ctx),
          })),
        };
      });
    }
  } catch {
    invoiceFamilies = [];
  }

  // Shipping status per quotation — one batch load for the whole affair, so
  // the freight-freshness badge + Request Shipping Update action sit right on
  // each version in the deal workspace.
  const [shippingWarn, shippingCritical, canRequestShipping, canSetDocStatus] =
    await Promise.all([
      getNumberSetting(supabase, FRESHNESS_WARN_DAYS_KEY, FRESHNESS_DEFAULTS.warnDays),
      getNumberSetting(supabase, FRESHNESS_CRITICAL_DAYS_KEY, FRESHNESS_DEFAULTS.criticalDays),
      hasUiCapability("shipping.request_update"),
      hasUiCapability("document.set_status"),
    ]);
  const shippingStatusMap = await loadShippingStatuses(
    supabase,
    group.documents.map((d) => d.id)
  );
  const shippingStatuses = Object.fromEntries(shippingStatusMap);

  // SSoT document repository — every document of this project, from every
  // module, folder-categorised (renders in the Documents section).
  group.repository =
    (await loadProjectRepositories(supabase, [group])).get(group.anchorId) ?? [];

  return (
    <AffairDetail
      affair={group}
      affairId={id}
      clientName={clientName}
      shippingStatuses={shippingStatuses}
      canRequestShipping={canRequestShipping}
      freshnessThresholds={{ warnDays: shippingWarn, criticalDays: shippingCritical }}
      canSetDocStatus={canSetDocStatus}
      owners={owners}
      canAssignOwner={canAssignOwner}
      assignableDocs={assignableDocs}
      invoiceFamilies={invoiceFamilies}
      source={affair.source ?? null}
      plannedActions={plannedActions}
      tenderOrigin={
        tenderRes.data
          ? {
              id: (tenderRes.data as any).id,
              buyer: (tenderRes.data as any).buyer ?? null,
              country: (tenderRes.data as any).country ?? null,
              deadline: (tenderRes.data as any).deadline ?? null,
              reference: (tenderRes.data as any).reference ?? null,
              platform: (tenderRes.data as any).platform ?? null,
              source_url: (tenderRes.data as any).source_url ?? null,
              documents: Array.isArray((tenderRes.data as any).documents)
                ? (tenderRes.data as any).documents
                : [],
            }
          : null
      }
    />
  );
}
