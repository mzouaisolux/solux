// =====================================================================
// EXPERIMENTAL / PROTOTYPE — read-only grouping of existing `documents`
// into "affairs" (Client -> Affair -> Documents). PURE module: client +
// server safe, NO server imports, NO database writes.
//
// Reconstructs the affair grouping purely from columns that already exist
// (root_document_id, version, affair_name, status, type, client_id,
// total_price, currency) plus lightly-derived stage/next-action/alerts
// from task-list and production-order STATUS (read elsewhere). It does
// NOT introduce an affairs table and does NOT duplicate the Dashboard /
// Action Center logic. See docs/AFFAIRS_AND_DOCUMENTS_MODEL.md.
//
// Anchor rule: affair_id ?? root_document_id ?? id.
//   The AFFAIR is the business entity (owner ruling 2026-07-07): every
//   document that carries an affair_id groups under that affair, no matter
//   which version chain it belongs to (a won quotation and the proforma that
//   Launch Production created are ONE affair, not two). root_document_id is
//   ONLY a version-history concept — it is used as the grouping key solely
//   for legacy documents that predate the affairs table (affair_id null).
// Display name: affairs.name -> first non-empty affair_name -> root number.
// =====================================================================

import type { DocStatus, DocType } from "@/lib/types";

const ALL_DOC_STATUSES: DocStatus[] = [
  "draft",
  "sent",
  "negotiating",
  "won",
  "lost",
  "cancelled",
];

export type PrototypeDoc = {
  id: string;
  number: string | null;
  client_id: string | null;
  root_document_id: string | null;
  version: number | null;
  affair_name: string | null;
  status: DocStatus;
  type: DocType;
  date: string | null;
  total_price: number | null;
  currency: string | null;
  forecast_probability: number | null;
  archived_at: string | null;
  affair_id: string | null;
  /** generated quotation/proforma PDF (documents.pdf_url), if any */
  pdf_url: string | null;
};

/** A real row from the `affairs` table (m076/m077). */
export type AffairRecord = {
  id: string;
  client_id: string | null;
  name: string | null;
  status: string | null;
  owner_id: string | null;
  archived_at: string | null;
};

export type ClientInfo = {
  id: string;
  company_name: string | null;
  client_code: string | null;
  country: string | null;
  contact_name: string | null;
  sales_owner_id: string | null;
};

/** Where an affair stands operationally (lightly derived, NOT the Action Center). */
export type AffairStage =
  | "no_task_list"
  | "task_list_missing" // won but no task list
  | "task_list_created"
  | "in_production"
  | "production_delayed"
  | "ready_to_ship"
  | "delivered"
  | "cancelled";

export const STAGE_LABEL: Record<AffairStage, string> = {
  no_task_list: "No task list",
  task_list_missing: "Task list missing",
  task_list_created: "Task list created",
  in_production: "In production",
  production_delayed: "Production delayed",
  ready_to_ship: "Ready to ship",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export type EventLite = {
  id: string;
  event_type: string;
  severity: string;
  message: string;
  created_at: string | null;
};

export type AffairGroup = {
  anchorId: string;
  displayName: string;
  clientId: string | null;
  documents: PrototypeDoc[]; // sorted by version asc
  quotationCount: number;
  proformaCount: number;
  latestVersion: number;
  latest: PrototypeDoc | null; // null for an empty (document-less) project
  effectiveStatus: DocStatus; // won wins over a later draft revision
  totalValue: number; // value of the latest version
  currency: string | null;
  forecastProbability: number | null;
  isArchived: boolean;
  hasTaskList: boolean;
  hasProductionOrder: boolean;
  stage: AffairStage;
  nextAction: string | null;
  alerts: string[];
  timeline: EventLite[];
  /** real affair lifecycle status (affairs.status); null if not yet linked */
  lifecycleStatus: string | null;
  /** true once this group is backed by a real `affairs` row */
  isRealAffair: boolean;
  /** real affairs.id (for edit actions); null if not yet linked */
  affairId: string | null;
  affairOwnerId: string | null;
  affairOwnerName: string | null;
  // Project-level summaries (real, read-only; enriched by the page).
  fileTotal: number;
  fileBuckets: { label: string; count: number }[];
  messageCount: number;
  lastMessageAt: string | null;
  /** Preview text of the latest conversation message (enriched). */
  lastMessage: string | null;
  /** ETA / production deadline of the most-advanced linked PO (enriched). */
  eta: string | null;
  /** Real project files — generated quotation PDFs + uploaded attachments. */
  files: AffairFile[];
  /** Linked operational records (for quick Documents links); null if none. */
  taskListId: string | null;
  productionOrderId: string | null;
  /**
   * SSoT document repository — EVERY document of the project from every
   * module, folder-categorised (loadProjectRepositories). Optional: pages
   * that don't load it fall back to the legacy files list.
   */
  repository?: import("@/lib/project-documents").ProjectDocument[];
};

/** A single clickable file in a project (generated PDF or uploaded attachment). */
export type AffairFile = {
  key: string;
  name: string;
  kind: "quotation" | "attachment";
  /** Open target (document page for quotations, download route for attachments). */
  href: string;
  /** Direct download target (attachments only); null for quotations. */
  downloadHref: string | null;
  /** attachments.id — present only for uploaded files (enables replace/delete). */
  attachmentId: string | null;
  /** A document of the affair, for upload/replace context (root resolves the affair). */
  documentId: string | null;
  sizeLabel: string | null;
  typeLabel: string | null;
  /** raw attachments.attachment_type — preserved on replace (null for PDFs). */
  attachmentType: string | null;
  /** quotation commercial status (null for attachments). */
  status: string | null;
  /** quotation version (null for attachments). */
  version: number | null;
  /** quotation draft → offer "Continue editing". */
  isDraft: boolean;
  /** attachments.created_at — upload date (null for quotations). */
  createdAt: string | null;
  /** attachments.uploaded_by — author uuid (label resolved server-side). */
  uploadedBy: string | null;
};

/** Minimal attachment row shape needed to build the file list. */
export type AttachmentLite = {
  id: string;
  affair_id: string | null;
  file_name: string;
  file_size: number | null;
  attachment_type: string | null;
  created_at: string | null;
  uploaded_by?: string | null;
};

function fileSizeLabel(bytes: number | null): string | null {
  if (!bytes || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Build the unified "Documents & Files" list: every quotation version
 * (open the document; drafts → continue editing) then uploaded attachments
 * (download / replace / delete). Pure — no DB/Storage access. `attachRows`
 * is the full attachments set; we keep the ones for this affair anchor.
 */
export function buildAffairFiles(
  affair: AffairGroup,
  attachRows: AttachmentLite[],
): AffairFile[] {
  const files: AffairFile[] = [];

  // Quotation versions — newest first. Every version is a document, whether or
  // not its PDF has been generated yet (the document page handles the PDF).
  const versions = [...affair.documents].sort(
    (a, b) => (b.version ?? 1) - (a.version ?? 1),
  );
  for (const d of versions) {
    const label = d.type === "proforma" ? "Proforma" : "Quotation";
    files.push({
      key: `doc:${d.id}`,
      name: `${label}-V${d.version ?? 1}.pdf`,
      kind: "quotation",
      href: `/documents/${d.id}`,
      downloadHref: null,
      attachmentId: null,
      documentId: d.id,
      sizeLabel: null,
      typeLabel: label,
      attachmentType: null,
      status: d.status,
      version: d.version ?? 1,
      isDraft: d.status === "draft",
      createdAt: d.date ?? null,
      uploadedBy: null,
    });
  }

  // Uploaded attachments — newest first. Match on EVERY anchor convention
  // the affair's rows may carry (real affair id, group anchor, member doc
  // ids, chain roots) so no upload disappears when the grouping rule moves.
  const docCtx = affair.latest?.id ?? affair.documents[0]?.id ?? affair.anchorId;
  const anchors = affairAttachmentAnchors(affair);
  const rows = attachRows
    .filter((r) => r.affair_id != null && anchors.has(r.affair_id))
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  for (const r of rows) {
    files.push({
      key: `att:${r.id}`,
      name: r.file_name,
      kind: "attachment",
      href: `/api/attachments/${r.id}/download`,
      downloadHref: `/api/attachments/${r.id}/download`,
      attachmentId: r.id,
      documentId: docCtx,
      sizeLabel: fileSizeLabel(r.file_size),
      typeLabel: null,
      attachmentType: r.attachment_type ?? "other",
      status: null,
      version: null,
      isDraft: false,
      createdAt: r.created_at,
      uploadedBy: r.uploaded_by ?? null,
    });
  }

  return files;
}

export type ClientAffairs = {
  clientId: string | null;
  clientName: string;
  clientCode: string | null;
  country: string | null;
  ownerName: string | null;
  contactName: string | null;
  affairCount: number;
  totalValue: number;
  currency: string | null;
  mixedCurrency: boolean;
  latestDate: string | null;
  /** number of AFFAIRS in each commercial status */
  statusCounts: Record<DocStatus, number>;
  affairs: AffairGroup[];
};

/**
 * The grouping key for "which affair does this document belong to".
 * affair_id (the business entity) always wins; the version-chain root is only
 * a fallback for legacy documents never linked to a real affair.
 */
export function affairAnchorId(doc: PrototypeDoc): string {
  return doc.affair_id ?? doc.root_document_id ?? doc.id;
}

/**
 * EVERY anchor value an attachment of this affair may carry in
 * `attachments.affair_id`. The column's semantics changed over time:
 *   m060 era  — the version-chain root document id (root_document_id ?? id)
 *   post-5307c — the REAL affairs.id (affair_id = single source of truth)
 * Rows written under EITHER convention must keep surfacing on the affair —
 * a file must never disappear because the grouping rule evolved. So readers
 * match against the full candidate set: the real affair id, the group anchor,
 * and every member document id + version-chain root.
 */
export function affairAttachmentAnchors(affair: {
  affairId: string | null;
  anchorId: string;
  documents: { id: string; root_document_id: string | null }[];
}): Set<string> {
  const anchors = new Set<string>([affair.anchorId]);
  if (affair.affairId) anchors.add(affair.affairId);
  for (const d of affair.documents) {
    anchors.add(d.id);
    if (d.root_document_id) anchors.add(d.root_document_id);
  }
  return anchors;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function memberTime(doc: PrototypeDoc | null): number {
  const t = doc?.date ? Date.parse(doc.date) : 0;
  return Number.isNaN(t) ? 0 : t;
}

function eventTime(e: EventLite): number {
  const t = e.created_at ? Date.parse(e.created_at) : 0;
  return Number.isNaN(t) ? 0 : t;
}

const CURRENCY_SYMBOL: Record<string, string> = { USD: "$", EUR: "€", CNY: "¥" };

export function formatMoney(
  value: number | null | undefined,
  currency: string | null | undefined,
): string {
  if (value == null || Number.isNaN(value)) return "";
  const cur = (currency || "USD").toUpperCase();
  // Deterministic across server & client — pin the number grouping to a fixed
  // locale and use a fixed symbol map. (Intl currency style with the default
  // locale resolves differently on Node vs the browser → hydration mismatch.)
  const n = Math.round(value).toLocaleString("en-US");
  const sym = CURRENCY_SYMBOL[cur];
  return sym ? `${sym}${n}` : `${cur} ${n}`;
}

/** Derive stage + next action + alerts from already-fetched statuses. */
function deriveOps(
  effectiveStatus: DocStatus,
  poStatuses: string[],
  hasTaskList: boolean,
): { stage: AffairStage; nextAction: string | null; alerts: string[] } {
  const has = (s: string) => poStatuses.includes(s);
  const alerts: string[] = [];

  let stage: AffairStage;
  if (effectiveStatus === "cancelled") stage = "cancelled";
  else if (has("delivered")) stage = "delivered";
  else if (has("shipped") || has("shipment_booked") || has("production_completed"))
    stage = "ready_to_ship";
  else if (has("production_delayed")) stage = "production_delayed";
  else if (has("in_production")) stage = "in_production";
  else if (poStatuses.length > 0) stage = "task_list_created"; // PO exists, pre-production
  else if (hasTaskList) stage = "task_list_created";
  else if (effectiveStatus === "won") stage = "task_list_missing";
  else stage = "no_task_list";

  if (stage === "task_list_missing") alerts.push("Task list missing");
  if (stage === "production_delayed") alerts.push("Production delayed");
  if (has("awaiting_deposit")) alerts.push("Awaiting deposit");

  let nextAction: string | null = null;
  if (stage === "task_list_missing") nextAction = "Create task list";
  else if (has("awaiting_deposit")) nextAction = "Waiting deposit";
  else if (stage === "production_delayed") nextAction = "Review delay";
  else if (stage === "ready_to_ship") nextAction = "Update BL / ship";
  else if (effectiveStatus === "sent" || effectiveStatus === "negotiating")
    nextAction = "Follow up client";
  else if (effectiveStatus === "draft") nextAction = "Send quotation";

  return { stage, nextAction, alerts };
}

/**
 * Group documents into affairs, then group affairs by client, enriching
 * each level with already-available data. Pure & deterministic.
 *
 * - `clients`            : client_id -> ClientInfo
 * - `ownerNames`         : user_id   -> display label
 * - `taskListStatusByDoc`: document_id -> task-list status (existence + status)
 * - `prodStatusByDoc`    : document_id -> production-order status
 */
export function groupIntoAffairs(
  docs: PrototypeDoc[],
  clients: Map<string, ClientInfo>,
  ownerNames: Map<string, string>,
  taskListStatusByDoc: Map<string, string>,
  prodStatusByDoc: Map<string, string>,
  eventsByDoc: Map<string, EventLite[]>,
  affairsById: Map<string, AffairRecord>,
): ClientAffairs[] {
  // 1) bucket documents by affair anchor
  const byAnchor = new Map<string, PrototypeDoc[]>();
  for (const d of docs) {
    const anchor = affairAnchorId(d);
    const arr = byAnchor.get(anchor);
    if (arr) arr.push(d);
    else byAnchor.set(anchor, [d]);
  }

  // 2) build one enriched AffairGroup per anchor
  const affairs: AffairGroup[] = [];
  for (const [anchorId, members] of byAnchor) {
    // Version asc, then date asc: an affair can now hold SEVERAL version
    // chains (e.g. quotation v1 + the proforma v1 Launch Production created),
    // so the date tiebreaks equal versions and `latest` lands on the most
    // recent commercial document deterministically.
    const sorted = [...members].sort(
      (a, b) =>
        (a.version ?? 1) - (b.version ?? 1) || memberTime(a) - memberTime(b),
    );
    const rootDoc = sorted.find((d) => d.id === anchorId) ?? sorted[0];
    // P2a: enrich with the REAL affairs row (matched via any member's affair_id).
    const realAffairId = sorted.map((d) => d.affair_id).find(Boolean) ?? null;
    const rec = realAffairId ? affairsById.get(realAffairId) ?? null : null;
    const named = sorted.find(
      (d) => d.affair_name && d.affair_name.trim().length > 0,
    );
    const displayName =
      (rec?.name && rec.name.trim()) ||
      named?.affair_name?.trim() ||
      rootDoc.number ||
      `Affair ${shortId(anchorId)}`;
    const lifecycleStatus = rec?.status ?? null;
    const latest = sorted.reduce((acc, d) =>
      (d.version ?? 1) >= (acc.version ?? 1) ? d : acc,
    );
    const effectiveStatus: DocStatus = sorted.some((d) => d.status === "won")
      ? "won"
      : latest.status;

    const hasTaskList = sorted.some((d) => taskListStatusByDoc.has(d.id));
    const poStatuses = sorted
      .map((d) => prodStatusByDoc.get(d.id))
      .filter((s): s is string => Boolean(s));
    const hasProductionOrder = poStatuses.length > 0;

    const { stage, nextAction, alerts } = deriveOps(
      effectiveStatus,
      poStatuses,
      hasTaskList,
    );

    const timeline = sorted
      .flatMap((d) => eventsByDoc.get(d.id) ?? [])
      .sort((a, b) => eventTime(b) - eventTime(a))
      .slice(0, 8);

    affairs.push({
      anchorId,
      displayName,
      clientId: rootDoc.client_id,
      documents: sorted,
      quotationCount: sorted.filter((d) => d.type === "quotation").length,
      proformaCount: sorted.filter((d) => d.type === "proforma").length,
      latestVersion: sorted.reduce((m, d) => Math.max(m, d.version ?? 1), 1),
      latest,
      effectiveStatus,
      totalValue: latest.total_price ?? 0,
      currency: latest.currency,
      forecastProbability: latest.forecast_probability,
      isArchived: Boolean(latest.archived_at),
      hasTaskList,
      hasProductionOrder,
      stage,
      nextAction,
      alerts,
      timeline,
      lifecycleStatus,
      isRealAffair: Boolean(rec),
      affairId: rec?.id ?? null,
      affairOwnerId: rec?.owner_id ?? null,
      affairOwnerName: (rec?.owner_id && ownerNames.get(rec.owner_id)) || null,
      // defaults; the page enriches these from attachments / entity_messages.
      fileTotal: 0,
      fileBuckets: [],
      messageCount: 0,
      lastMessageAt: null,
      lastMessage: null,
      eta: null,
      files: [],
      taskListId: null,
      productionOrderId: null,
    });
  }

  // 2b) Include affairs that have NO documents yet (freshly-created projects)
  //     so "create project first" is visible.
  const usedAffairIds = new Set(
    affairs.map((a) => a.affairId).filter((id): id is string => Boolean(id)),
  );
  for (const [id, rec] of affairsById) {
    if (usedAffairIds.has(id) || rec.archived_at) continue;
    affairs.push({
      // Same key space as document-backed groups: the REAL affair id — so
      // attachments/messages/repositories keyed by affair_id match here too.
      anchorId: id,
      displayName: (rec.name && rec.name.trim()) || `Affair ${shortId(id)}`,
      clientId: rec.client_id,
      documents: [],
      quotationCount: 0,
      proformaCount: 0,
      latestVersion: 0,
      latest: null,
      effectiveStatus: "draft",
      totalValue: 0,
      currency: null,
      forecastProbability: null,
      isArchived: false,
      hasTaskList: false,
      hasProductionOrder: false,
      stage: "no_task_list",
      nextAction: "Create quotation",
      alerts: [],
      timeline: [],
      lifecycleStatus: rec.status,
      isRealAffair: true,
      affairId: id,
      affairOwnerId: rec.owner_id,
      affairOwnerName: (rec.owner_id && ownerNames.get(rec.owner_id)) || null,
      fileTotal: 0,
      fileBuckets: [],
      messageCount: 0,
      lastMessageAt: null,
      lastMessage: null,
      eta: null,
      files: [],
      taskListId: null,
      productionOrderId: null,
    });
  }

  // 3) group affairs under their client, with client-level aggregates
  const byClient = new Map<string | null, AffairGroup[]>();
  for (const a of affairs) {
    const key = a.clientId ?? null;
    const arr = byClient.get(key);
    if (arr) arr.push(a);
    else byClient.set(key, [a]);
  }

  const result: ClientAffairs[] = [];
  for (const [clientId, clientAffairs] of byClient) {
    clientAffairs.sort((a, b) => memberTime(b.latest) - memberTime(a.latest));

    const info = clientId ? clients.get(clientId) : undefined;
    const statusCounts = ALL_DOC_STATUSES.reduce(
      (acc, s) => {
        acc[s] = 0;
        return acc;
      },
      {} as Record<DocStatus, number>,
    );
    for (const a of clientAffairs) statusCounts[a.effectiveStatus] += 1;

    const currencies = new Set(
      clientAffairs.map((a) => a.currency).filter(Boolean) as string[],
    );
    const totalValue = clientAffairs.reduce((s, a) => s + (a.totalValue || 0), 0);
    const latestDate =
      clientAffairs.length > 0 ? clientAffairs[0].latest?.date ?? null : null;
    const ownerId = info?.sales_owner_id ?? null;

    result.push({
      clientId,
      clientName: info?.company_name || "Unknown / unlinked client",
      clientCode: info?.client_code ?? null,
      country: info?.country ?? null,
      ownerName: (ownerId && ownerNames.get(ownerId)) || null,
      contactName: info?.contact_name ?? null,
      affairCount: clientAffairs.length,
      totalValue,
      currency: currencies.size === 1 ? [...currencies][0] : null,
      mixedCurrency: currencies.size > 1,
      latestDate,
      statusCounts,
      affairs: clientAffairs,
    });
  }

  // clients with the most recent activity first
  result.sort((a, b) => {
    const ta = a.latestDate ? Date.parse(a.latestDate) : 0;
    const tb = b.latestDate ? Date.parse(b.latestDate) : 0;
    return (Number.isNaN(tb) ? 0 : tb) - (Number.isNaN(ta) ? 0 : ta);
  });
  return result;
}
