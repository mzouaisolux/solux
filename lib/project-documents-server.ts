// =====================================================================
// PROJECT DOCUMENT REPOSITORY — server aggregator (SSoT, owner spec
// 2026-07-07 · Lot 2 2026-07-07). Given the affair groups a page already
// built, collects EVERY document related to each project from every
// module and returns one normalized, folder-categorised list per affair
// anchor:
//
//   • Commercial  — quotation / proforma versions + legal invoices (m141)
//   • Study Lab   — energy study & DIALux files (m144 lighting setups)
//   • Technical   — CAD / drawings / datasheets (attachment types + ext.)
//   • Production  — Task List & Production Order records, PO uploads
//   • Logistics   — shipping documents (order_documents category)
//   • Customer    — manual uploads (photos, tender docs, other)
//
// Lot 2 adds per-document metadata: author (resolved display name),
// lifecycle status Draft/Approved/Final (m150 — read DEFENSIVELY so the
// page works before the migration), and the FULL version history of PO
// documents (older versions flagged isCurrent=false; the UI hides them
// behind "Latest only").
//
// BATCH-FIRST: one query per SOURCE for the whole set of affairs (never
// per-affair), ONE storage round trip for all signed URLs, ONE label
// resolution for all authors. Soft-fails per source.
//
// ADDING A FUTURE SOURCE = one collector block here + a folder rule in
// lib/project-documents.ts. The UI (AffairDocumentsCard) needs no change.
// =====================================================================

import type { createClient } from "@/lib/supabase/server";
import type { AffairGroup } from "@/lib/affairs-prototype";
import { ATTACHMENTS_BUCKET, attachmentTypeLabel } from "@/lib/attachments";
import { documentKindLabel } from "@/lib/document-label";
import { resolveUserLabelStrings } from "@/lib/user-display";
import {
  fileSizeLabel,
  folderForAttachment,
  folderForOrderDoc,
  latestOrderDocs,
  type ProjectDocStatus,
  type ProjectDocument,
} from "@/lib/project-documents";

const DOC_STATUSES = new Set(["draft", "approved", "final"]);

function asDocStatus(v: unknown): ProjectDocStatus | null {
  return typeof v === "string" && DOC_STATUSES.has(v)
    ? (v as ProjectDocStatus)
    : null;
}

export async function loadProjectRepositories(
  supabase: ReturnType<typeof createClient>,
  groups: AffairGroup[]
): Promise<Map<string, ProjectDocument[]>> {
  const out = new Map<string, ProjectDocument[]>();
  if (groups.length === 0) return out;

  const poIds = Array.from(
    new Set(groups.map((g) => g.productionOrderId).filter(Boolean))
  ) as string[];
  const affairIds = Array.from(
    new Set(groups.map((g) => g.affairId).filter(Boolean))
  ) as string[];
  const attachmentIds = groups.flatMap((g) =>
    g.files.filter((f) => f.kind === "attachment" && f.attachmentId).map((f) => f.attachmentId!)
  );

  // ---- Source: order_documents (PO uploads incl. shipping docs) — batch.
  //      m150 columns read defensively: retry without them pre-migration.
  type OrderDocRow = {
    id: string;
    production_order_id: string;
    group_id: string;
    version: number;
    name: string;
    storage_path: string;
    file_size: number | null;
    category: string | null;
    created_at: string | null;
    archived_at: string | null;
    uploaded_by: string | null;
    doc_status?: string | null;
  };
  const orderDocsByPo = new Map<string, OrderDocRow[]>();
  if (poIds.length) {
    const base =
      "id, production_order_id, group_id, version, name, storage_path, file_size, category, created_at, archived_at, uploaded_by";
    let res: { data: any[] | null; error: { message?: string } | null } =
      await supabase
        .from("order_documents")
        .select(`${base}, doc_status`)
        .in("production_order_id", poIds);
    if (res.error && /doc_status/.test(res.error.message ?? "")) {
      res = await supabase
        .from("order_documents")
        .select(base)
        .in("production_order_id", poIds);
    }
    if (!res.error) {
      for (const r of (res.data ?? []) as any[]) {
        const list = orderDocsByPo.get(r.production_order_id) ?? [];
        list.push(r);
        orderDocsByPo.set(r.production_order_id, list);
      }
    }
  }

  // ---- Lifecycle status of manual uploads (m150) — soft-fail pre-migration.
  const attachmentStatus = new Map<string, ProjectDocStatus>();
  if (attachmentIds.length) {
    const { data, error } = await supabase
      .from("attachments")
      .select("id, doc_status")
      .in("id", attachmentIds);
    if (!error) {
      for (const r of (data ?? []) as any[]) {
        const s = asDocStatus(r.doc_status);
        if (s) attachmentStatus.set(r.id, s);
      }
    }
  }

  // ---- Source: product_lighting_setups (Study Lab files, m144) — batch.
  type LightingRow = {
    id: string;
    affair_id: string | null;
    energy_study_path: string | null;
    energy_study_name: string | null;
    dialux_path: string | null;
    dialux_name: string | null;
    created_at: string | null;
    created_by: string | null;
  };
  const lightingByAffair = new Map<string, LightingRow[]>();
  if (affairIds.length) {
    const { data, error } = await supabase
      .from("product_lighting_setups")
      .select(
        "id, affair_id, energy_study_path, energy_study_name, dialux_path, dialux_name, created_at, created_by"
      )
      .in("affair_id", affairIds);
    if (!error) {
      for (const r of (data ?? []) as any[]) {
        if (!r.affair_id) continue;
        const list = lightingByAffair.get(r.affair_id) ?? [];
        list.push(r);
        lightingByAffair.set(r.affair_id, list);
      }
    }
  }

  // ---- Source: legal invoices (m141) — Commercial records. Batch:
  //      families by affair, then invoices by family.
  type InvoiceRow = {
    id: string;
    family_id: string;
    accounting_number: string;
    invoice_type: string;
    label: string | null;
    status: string | null;
    issue_date: string | null;
    created_at: string | null;
    created_by: string | null;
  };
  const invoicesByAffair = new Map<string, InvoiceRow[]>();
  if (affairIds.length) {
    const fams = await supabase
      .from("invoice_families")
      .select("id, affair_id")
      .in("affair_id", affairIds);
    const famToAffair = new Map<string, string>(
      ((fams.data ?? []) as any[])
        .filter((f) => f.affair_id)
        .map((f) => [f.id, f.affair_id])
    );
    if (!fams.error && famToAffair.size) {
      const inv = await supabase
        .from("invoices")
        .select(
          "id, family_id, accounting_number, invoice_type, label, status, issue_date, created_at, created_by"
        )
        .in("family_id", Array.from(famToAffair.keys()));
      if (!inv.error) {
        for (const r of (inv.data ?? []) as any[]) {
          const affairId = famToAffair.get(r.family_id);
          if (!affairId) continue;
          const list = invoicesByAffair.get(affairId) ?? [];
          list.push(r);
          invoicesByAffair.set(affairId, list);
        }
      }
    }
  }

  // ---- ONE label resolution for every author uuid we met. ----------------
  const authorIds = new Set<string>();
  for (const g of groups)
    for (const f of g.files) if (f.uploadedBy) authorIds.add(f.uploadedBy);
  for (const [, rows] of orderDocsByPo)
    for (const r of rows) if (r.uploaded_by) authorIds.add(r.uploaded_by);
  for (const [, rows] of lightingByAffair)
    for (const r of rows) if (r.created_by) authorIds.add(r.created_by);
  for (const [, rows] of invoicesByAffair)
    for (const r of rows) if (r.created_by) authorIds.add(r.created_by);
  const authors = authorIds.size
    ? await resolveUserLabelStrings(Array.from(authorIds))
    : new Map<string, string>();
  const authorOf = (id: string | null | undefined): string | null =>
    id ? authors.get(id) ?? null : null;

  // ---- ONE storage round trip for every signed URL (ALL live versions —
  //      previous versions stay downloadable from the history view).
  const pathsToSign: string[] = [];
  for (const [, rows] of orderDocsByPo)
    for (const r of rows) if (!r.archived_at) pathsToSign.push(r.storage_path);
  for (const [, rows] of lightingByAffair) {
    for (const r of rows) {
      if (r.energy_study_path) pathsToSign.push(r.energy_study_path);
      if (r.dialux_path) pathsToSign.push(r.dialux_path);
    }
  }
  const signed = new Map<string, string>();
  if (pathsToSign.length) {
    const { data } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .createSignedUrls(pathsToSign, 3600);
    (data ?? []).forEach((entry: any, i: number) => {
      if (entry?.signedUrl) signed.set(pathsToSign[i], entry.signedUrl);
    });
  }

  // ---- Assemble per affair group. ----------------------------------------
  for (const g of groups) {
    const docs: ProjectDocument[] = [];

    // Commercial — every quotation/proforma version.
    for (const d of g.documents) {
      const kind = documentKindLabel((d as any).type ?? "quotation");
      docs.push({
        key: `doc:${d.id}`,
        name: `${kind}-V${d.version ?? 1}${d.number ? ` · ${d.number}` : ""}`,
        folder: "commercial",
        kindLabel: kind,
        source: "quotation",
        href: `/documents/${d.id}`,
        downloadHref: d.pdf_url ? `/api/documents/${d.id}/pdf` : null,
        date: d.date ?? null,
        sizeLabel: null,
        version: d.version ?? 1,
        status: d.status,
        attachmentId: null,
        documentId: d.id,
        attachmentType: null,
        author: null,
        docStatus: null,
        sourceId: null,
        isCurrent: true,
        share: d.pdf_url ? { source: "quotation", id: d.id } : null,
      });
    }

    // Commercial — legal invoices (m141), as records to /invoicing/[id].
    const invRows = g.affairId ? invoicesByAffair.get(g.affairId) ?? [] : [];
    for (const r of invRows) {
      docs.push({
        key: `inv:${r.id}`,
        name: `Invoice ${r.accounting_number}${r.label ? ` · ${r.label}` : ""}`,
        folder: "commercial",
        kindLabel: r.invoice_type === "credit_note" ? "Credit note" : "Invoice",
        source: "record",
        href: `/invoicing/${r.id}`,
        downloadHref: null,
        date: r.issue_date ?? r.created_at,
        sizeLabel: null,
        version: null,
        status: r.status,
        attachmentId: null,
        documentId: null,
        attachmentType: null,
        author: authorOf(r.created_by),
        docStatus: null,
        sourceId: null,
        isCurrent: true,
        share: null,
      });
    }

    // Production — the operational records (first-class rows like the rest).
    const record = (key: string, name: string, href: string): ProjectDocument => ({
      key,
      name,
      folder: "production",
      kindLabel: "Production record",
      source: "record",
      href,
      downloadHref: null,
      date: null,
      sizeLabel: null,
      version: null,
      status: null,
      attachmentId: null,
      documentId: null,
      attachmentType: null,
      author: null,
      docStatus: null,
      sourceId: null,
      isCurrent: true,
      share: null,
    });
    if (g.taskListId)
      docs.push(record(`rec:tl:${g.taskListId}`, "Task List", `/task-lists/${g.taskListId}`));
    if (g.productionOrderId)
      docs.push(
        record(
          `rec:po:${g.productionOrderId}`,
          "Production Order",
          `/production/orders/${g.productionOrderId}`
        )
      );

    // Customer / Technical / Study Lab / Production — manual uploads.
    for (const f of g.files) {
      if (f.kind !== "attachment" || !f.attachmentId) continue;
      docs.push({
        key: f.key,
        name: f.name,
        folder: folderForAttachment(f.attachmentType, f.name),
        kindLabel: attachmentTypeLabel(f.attachmentType),
        source: "attachment",
        href: f.href,
        downloadHref: f.downloadHref,
        date: f.createdAt,
        sizeLabel: f.sizeLabel,
        version: null,
        status: null,
        attachmentId: f.attachmentId,
        documentId: f.documentId,
        attachmentType: f.attachmentType,
        author: authorOf(f.uploadedBy),
        docStatus: attachmentStatus.get(f.attachmentId) ?? null,
        sourceId: f.attachmentId,
        isCurrent: true,
        share: { source: "attachment", id: f.attachmentId },
      });
    }

    // Logistics / Production / Commercial — PO uploads, FULL history:
    // current version first-class, older versions flagged isCurrent=false.
    const poRows = g.productionOrderId
      ? orderDocsByPo.get(g.productionOrderId) ?? []
      : [];
    const currentIds = new Set(latestOrderDocs(poRows).map((r) => r.id));
    for (const r of poRows) {
      if (r.archived_at) continue;
      const url = signed.get(r.storage_path);
      if (!url) continue;
      const isCurrent = currentIds.has(r.id);
      docs.push({
        key: `od:${r.id}`,
        name: r.name,
        folder: folderForOrderDoc(r.category),
        kindLabel:
          r.category === "shipping"
            ? "Shipping document"
            : r.category === "financial"
              ? "Financial document"
              : "Production document",
        source: "order_document",
        href: url,
        downloadHref: url,
        date: r.created_at,
        sizeLabel: fileSizeLabel(r.file_size),
        version: r.version ?? 1,
        status: null,
        attachmentId: null,
        documentId: null,
        attachmentType: null,
        author: authorOf(r.uploaded_by),
        docStatus: isCurrent ? asDocStatus(r.doc_status) : null,
        sourceId: isCurrent ? r.id : null, // only the current version is status-editable
        isCurrent,
        share: { source: "order_document", id: r.id },
      });
    }

    // Study Lab — lighting setup studies (m144).
    const lightRows = g.affairId ? lightingByAffair.get(g.affairId) ?? [] : [];
    for (const [i, r] of lightRows.entries()) {
      const entries: { path: string | null; name: string | null; kind: string }[] = [
        { path: r.energy_study_path, name: r.energy_study_name, kind: "Energy Study" },
        { path: r.dialux_path, name: r.dialux_name, kind: "DIALux report" },
      ];
      for (const e of entries) {
        if (!e.path) continue;
        const url = signed.get(e.path);
        if (!url) continue;
        docs.push({
          key: `light:${i}:${e.kind}`,
          name: e.name ?? `${e.kind}.pdf`,
          folder: "study_lab",
          kindLabel: e.kind,
          source: "lighting",
          href: url,
          downloadHref: url,
          date: r.created_at,
          sizeLabel: null,
          version: null,
          status: null,
          attachmentId: null,
          documentId: null,
          attachmentType: null,
          author: authorOf(r.created_by),
          docStatus: null,
          sourceId: null,
          isCurrent: true,
          share: {
            source: "lighting",
            id: r.id,
            extra: e.kind === "DIALux report" ? "dialux" : "energy",
          },
        });
      }
    }

    out.set(g.anchorId, docs);
  }
  return out;
}
