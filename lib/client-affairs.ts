// =====================================================================
// Affair grouping helpers for the Client Hub (single client) and the Clients
// drill-down tree (all clients). Server-only. Reuse lib/affairs-prototype.ts
// groupIntoAffairs + enrich file/message counts so the AffairRow / tree
// previews show real 📎/💬 counts. Read-only; no writes.
// =====================================================================

import { createClient } from "@/lib/supabase/server";
import { resolveUserLabelStrings } from "@/lib/user-display";
import {
  groupIntoAffairs,
  buildAffairFiles,
  affairAnchorId,
  type AffairGroup,
  type AttachmentLite,
  type ClientAffairs,
  type PrototypeDoc,
  type ClientInfo,
  type AffairRecord,
  type EventLite,
} from "@/lib/affairs-prototype";

const ATTACH_COLS = "id, affair_id, file_name, file_size, attachment_type, created_at, uploaded_by";

const DOC_COLS =
  "id, number, client_id, root_document_id, version, affair_name, status, type, date, total_price, currency, forecast_probability, archived_at, affair_id, pdf_url";

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

/** Enrich affairs with file + conversation counts (mutates in place). */
function enrichAffairs(
  affairs: AffairGroup[],
  docs: PrototypeDoc[],
  attachData: any[],
  msgData: any[],
  etaByDoc: Map<string, string>,
): void {
  const attachTypesByAnchor = new Map<string, string[]>();
  for (const at of attachData) {
    if (!at.affair_id) continue;
    const arr = attachTypesByAnchor.get(at.affair_id) ?? [];
    arr.push(at.attachment_type ?? "other");
    attachTypesByAnchor.set(at.affair_id, arr);
  }
  // Same anchor rule as the grouping (affair_id first) — otherwise messages
  // land on a per-chain key and split across an affair's document chains.
  const anchorByDoc = new Map<string, string>();
  for (const d of docs) anchorByDoc.set(d.id, affairAnchorId(d));
  const msgByAnchor = new Map<
    string,
    { count: number; latest: string | null; latestText: string | null }
  >();
  for (const m of msgData) {
    const anchor = anchorByDoc.get(m.entity_id);
    if (!anchor) continue;
    const cur = msgByAnchor.get(anchor) ?? { count: 0, latest: null, latestText: null };
    cur.count += 1;
    if (m.created_at && (!cur.latest || m.created_at > cur.latest)) {
      cur.latest = m.created_at;
      cur.latestText = (m.message ?? null) as string | null;
    }
    msgByAnchor.set(anchor, cur);
  }
  for (const a of affairs) {
    const pdfDocs = a.documents.filter((d) => d.pdf_url);
    const latestPdf = pdfDocs.length
      ? pdfDocs.reduce((acc, d) => ((d.version ?? 1) >= (acc.version ?? 1) ? d : acc))
      : null;
    const types = attachTypesByAnchor.get(a.anchorId) ?? [];
    const counts = new Map<string, number>();
    for (const t of types) {
      const b = FILE_BUCKET[t] ?? "Other";
      counts.set(b, (counts.get(b) ?? 0) + 1);
    }
    const buckets: { label: string; count: number }[] = [];
    if (latestPdf) {
      buckets.push({
        label: latestPdf.type === "proforma" ? "Proforma" : "Quotation PDF",
        count: 1,
      });
    }
    for (const b of FILE_ORDER) {
      const n = counts.get(b) ?? 0;
      if (n > 0) buckets.push({ label: b, count: n });
    }
    a.fileBuckets = buckets;
    a.fileTotal = (latestPdf ? 1 : 0) + types.length;
    const ms = msgByAnchor.get(a.anchorId);
    a.messageCount = ms?.count ?? 0;
    a.lastMessageAt = ms?.latest ?? null;
    a.lastMessage = ms?.latestText ?? null;
    let eta: string | null = null;
    for (const d of a.documents) {
      const e = etaByDoc.get(d.id);
      if (e) eta = e; // docs sorted version asc → latest version's ETA wins
    }
    a.eta = eta;
    // Real clickable file list — generated PDFs + uploaded attachments.
    a.files = buildAffairFiles(a, attachData as AttachmentLite[]);
    a.fileTotal = a.files.length;
  }
}

/** Group ONE client's documents into affair previews (Client Hub Affaires tab). */
export async function getClientAffairs(clientId: string): Promise<AffairGroup[]> {
  const supabase = createClient();

  const { data: docsRaw } = await supabase
    .from("documents")
    .select(DOC_COLS)
    .eq("client_id", clientId)
    .order("date", { ascending: false });
  const docs = (docsRaw ?? []) as PrototypeDoc[];
  const docIds = docs.map((d) => d.id);
  // Attachments are stored by REAL affair_id — the anchor rule (affair_id
  // first) makes these keys line up so uploads actually surface on the rows.
  const anchorIds = Array.from(new Set(docs.map(affairAnchorId)));

  const empty = Promise.resolve({ data: [] as any[] });
  const [clientRes, tlRes, poRes, affRes, msgRes, eventsRes] =
    await Promise.all([
    supabase
      .from("clients")
      .select("id, company_name, client_code, country, contact_name, sales_owner_id")
      .eq("id", clientId)
      .maybeSingle(),
    docIds.length
      ? supabase
          .from("production_task_lists")
          .select("id, quotation_id, status")
          .in("quotation_id", docIds)
      : empty,
    docIds.length
      ? supabase
          .from("production_orders")
          .select("id, quotation_id, status, current_production_deadline, eta")
          .in("quotation_id", docIds)
      : empty,
    supabase
      .from("affairs")
      .select("id, client_id, name, status, owner_id, archived_at")
      .eq("client_id", clientId),
    docIds.length
      ? supabase
          .from("entity_messages")
          .select("entity_id, created_at, message")
          .eq("entity_type", "document")
          .in("entity_id", docIds)
      : empty,
    docIds.length
      ? supabase
          .from("events")
          .select("id, entity_id, event_type, severity, message, created_at")
          .eq("entity_type", "document")
          .in("entity_id", docIds)
          .order("created_at", { ascending: false })
          .limit(300)
      : empty,
  ]);

  // Attachments belong to the AFFAIR (attachments.affair_id) — fetch for every
  // affair of this client (incl. document-less ones), plus the doc-derived
  // anchors so legacy unlinked groups keep matching. Second wave on purpose:
  // the affair ids are only known once affRes resolves.
  const attachKeys = new Set<string>(anchorIds);
  for (const a of affRes.data ?? []) attachKeys.add(a.id);
  const attachRes = attachKeys.size
    ? await supabase
        .from("attachments")
        .select(ATTACH_COLS)
        .in("affair_id", Array.from(attachKeys))
    : { data: [] as any[] };

  const tlByDoc = new Map<string, string>();
  for (const t of tlRes.data ?? []) {
    if (t.quotation_id) tlByDoc.set(t.quotation_id, t.status ?? "");
  }
  const poByDoc = new Map<string, string>();
  const etaByDoc = new Map<string, string>();
  for (const p of poRes.data ?? []) {
    if (!p.quotation_id) continue;
    poByDoc.set(p.quotation_id, p.status ?? "");
    const v = p.eta ?? p.current_production_deadline ?? null;
    if (v) etaByDoc.set(p.quotation_id, v);
  }
  const affairsById = new Map<string, AffairRecord>(
    (affRes.data ?? []).map((a: AffairRecord) => [a.id, a]),
  );

  const ci = clientRes.data as ClientInfo | null;
  const clientsMap = new Map<string, ClientInfo>();
  if (ci) clientsMap.set(ci.id, ci);

  const ownerIds = new Set<string>();
  for (const a of affRes.data ?? []) if (a.owner_id) ownerIds.add(a.owner_id);
  if (ci?.sales_owner_id) ownerIds.add(ci.sales_owner_id);
  const ownerNames = ownerIds.size
    ? await resolveUserLabelStrings(Array.from(ownerIds))
    : new Map<string, string>();

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
    docs,
    clientsMap,
    ownerNames,
    tlByDoc,
    poByDoc,
    eventsByDoc,
    affairsById,
  );
  const affairs =
    grouped.find((g) => g.clientId === clientId)?.affairs ??
    grouped[0]?.affairs ??
    [];

  enrichAffairs(affairs, docs, attachRes.data ?? [], msgRes.data ?? [], etaByDoc);

  // Linked operational records (task list / production order) for quick links.
  const tlIdByDoc = new Map<string, string>();
  for (const t of tlRes.data ?? []) {
    if (t.quotation_id && t.id) tlIdByDoc.set(t.quotation_id, t.id);
  }
  const poIdByDoc = new Map<string, string>();
  for (const p of poRes.data ?? []) {
    if (p.quotation_id && p.id) poIdByDoc.set(p.quotation_id, p.id);
  }
  for (const a of affairs) {
    for (const d of [...a.documents].reverse()) {
      if (!a.taskListId && tlIdByDoc.has(d.id)) a.taskListId = tlIdByDoc.get(d.id)!;
      if (!a.productionOrderId && poIdByDoc.has(d.id)) {
        a.productionOrderId = poIdByDoc.get(d.id)!;
      }
    }
  }

  return affairs;
}

/**
 * Company-wide affair grouping for the Clients drill-down tree.
 * RLS scopes the documents to the caller; the page filters the result to the
 * clients it can see / the active scope.
 */
export async function getAllClientAffairs(): Promise<ClientAffairs[]> {
  const supabase = createClient();

  const { data: docsRaw } = await supabase
    .from("documents")
    .select(DOC_COLS)
    .order("date", { ascending: false })
    .limit(5000);
  const docs = (docsRaw ?? []) as PrototypeDoc[];
  const docIds = docs.map((d) => d.id);
  // Attachments are stored by REAL affair_id — the anchor rule (affair_id
  // first) makes these keys line up so uploads actually surface on the rows.
  const anchorIds = Array.from(new Set(docs.map(affairAnchorId)));

  const empty = Promise.resolve({ data: [] as any[] });
  const [clientsRes, tlRes, poRes, affRes, msgRes] = await Promise.all([
    supabase
      .from("clients")
      .select("id, company_name, client_code, country, contact_name, sales_owner_id"),
    docIds.length
      ? supabase
          .from("production_task_lists")
          .select("id, quotation_id, status")
          .in("quotation_id", docIds)
      : empty,
    docIds.length
      ? supabase
          .from("production_orders")
          .select("id, quotation_id, status, current_production_deadline, eta")
          .in("quotation_id", docIds)
      : empty,
    supabase
      .from("affairs")
      .select("id, client_id, name, status, owner_id, archived_at"),
    docIds.length
      ? supabase
          .from("entity_messages")
          .select("entity_id, created_at, message")
          .eq("entity_type", "document")
          .in("entity_id", docIds)
      : empty,
  ]);

  // Attachments keyed by REAL affair_id — union of doc anchors + every affair
  // row so document-less projects surface their uploads too (second wave; the
  // affair ids are only known once affRes resolves).
  const attachKeys = new Set<string>(anchorIds);
  for (const a of affRes.data ?? []) attachKeys.add(a.id);
  const attachRes = attachKeys.size
    ? await supabase
        .from("attachments")
        .select(ATTACH_COLS)
        .in("affair_id", Array.from(attachKeys))
    : { data: [] as any[] };

  const tlByDoc = new Map<string, string>();
  for (const t of tlRes.data ?? []) {
    if (t.quotation_id) tlByDoc.set(t.quotation_id, t.status ?? "");
  }
  const poByDoc = new Map<string, string>();
  const etaByDoc = new Map<string, string>();
  for (const p of poRes.data ?? []) {
    if (!p.quotation_id) continue;
    poByDoc.set(p.quotation_id, p.status ?? "");
    const v = p.eta ?? p.current_production_deadline ?? null;
    if (v) etaByDoc.set(p.quotation_id, v);
  }
  const affairsById = new Map<string, AffairRecord>(
    (affRes.data ?? []).map((a: AffairRecord) => [a.id, a]),
  );
  const clientsMap = new Map<string, ClientInfo>(
    (clientsRes.data ?? []).map((c: ClientInfo) => [c.id, c]),
  );

  const ownerIds = new Set<string>();
  for (const c of clientsRes.data ?? []) if (c.sales_owner_id) ownerIds.add(c.sales_owner_id);
  for (const a of affRes.data ?? []) if (a.owner_id) ownerIds.add(a.owner_id);
  const ownerNames = ownerIds.size
    ? await resolveUserLabelStrings(Array.from(ownerIds))
    : new Map<string, string>();

  const eventsByDoc = new Map<string, EventLite[]>();
  const grouped = groupIntoAffairs(
    docs,
    clientsMap,
    ownerNames,
    tlByDoc,
    poByDoc,
    eventsByDoc,
    affairsById,
  );

  enrichAffairs(
    grouped.flatMap((g) => g.affairs),
    docs,
    attachRes.data ?? [],
    msgRes.data ?? [],
    etaByDoc,
  );
  return grouped;
}
