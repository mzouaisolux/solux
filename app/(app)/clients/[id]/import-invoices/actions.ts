"use server";

/**
 * Historical Invoice Import — server actions (the "use server" boundary).
 *
 * Isolated island: these actions ONLY read the catalog/clients and write the
 * dedicated import_* tables. They never touch documents / affairs / task lists /
 * orders — the frozen commercial pipeline is untouched. RLS (m137) scopes every
 * write to the importer.
 *
 * Gate: `quotation.create` (sales + admin) — the same capability that lets a
 * user create commercial documents for a client. No new permission is added to
 * the matrix (kept out of that churn-prone area on purpose).
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/permissions";
import { emitEvent } from "@/lib/events";
import { productNameKey } from "@/lib/import/normalize";
import {
  matchProductLine,
  type ProductCandidate,
  type MappingEntry,
} from "@/lib/import/product-match";
import { extractInvoiceFromPdf } from "@/lib/import/extract";
import type { StagedDocDTO, StagedLineDTO, CommitResult } from "@/lib/import/dto";

const STORAGE_BUCKET = "documents";

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

async function currentUserId(
  supabase: ReturnType<typeof createClient>
): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be signed in.");
  return user.id;
}

function num(v: any): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Coerce an extracted date into a DATE-column-safe yyyy-mm-dd (or null). */
function toDateOnly(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(s).trim());
  if (m) return m[1];
  const t = Date.parse(String(s));
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  return null;
}

type Catalog = { candidates: ProductCandidate[]; mappings: Map<string, MappingEntry> };

async function loadCatalogAndMappings(
  supabase: ReturnType<typeof createClient>,
  clientId: string
): Promise<Catalog> {
  const { data: prods } = await supabase
    .from("products")
    .select("id, name, sku, category, category_id, is_legacy")
    .order("name");
  const candidates: ProductCandidate[] = (prods ?? []).map((p: any) => ({
    id: p.id,
    name: p.name,
    sku: p.sku ?? null,
    categoryId: p.category_id ?? null,
    categoryName: p.category ?? null,
    isLegacy: !!p.is_legacy,
  }));

  const { data: maps } = await supabase
    .from("historical_product_map")
    .select("client_id, source_name_key, action, product_id")
    .or(`client_id.eq.${clientId},client_id.is.null`);
  const mappings = new Map<string, MappingEntry>();
  // global first, client-scoped overrides win.
  for (const r of maps ?? []) {
    if (r.client_id === null)
      mappings.set(r.source_name_key, { action: r.action, productId: r.product_id ?? null });
  }
  for (const r of maps ?? []) {
    if (r.client_id !== null)
      mappings.set(r.source_name_key, { action: r.action, productId: r.product_id ?? null });
  }
  return { candidates, mappings };
}

async function insertLegacyProduct(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  name: string,
  categoryId: string | null
): Promise<string> {
  const { data, error } = await supabase
    .from("products")
    .insert({
      name: name.trim() || "Legacy product",
      base_price: 0,
      active: false,
      is_legacy: true,
      category_id: categoryId,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Could not create legacy product: ${error?.message ?? ""}`);
  return data.id as string;
}

async function rememberMapping(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  clientId: string | null,
  description: string,
  action: "map" | "legacy" | "ignore",
  productId: string | null
): Promise<void> {
  const key = productNameKey(description);
  if (!key) return;
  let del = supabase.from("historical_product_map").delete().eq("source_name_key", key);
  del = clientId ? del.eq("client_id", clientId) : del.is("client_id", null);
  await del;
  await supabase.from("historical_product_map").insert({
    client_id: clientId,
    source_name: description,
    source_name_key: key,
    action,
    product_id: productId,
    created_by: userId,
  });
}

/** Recompute readiness + human reasons from the stored meta + current lines. */
function recompute(
  meta: any,
  nameDecision: string | null,
  lineRows: any[]
): { status: "staged" | "needs_attention"; reasons: string[] } {
  const nameOk = !!meta?.name_ok || nameDecision === "forced" || nameDecision === "confirmed";
  const integrityOk = !!meta?.integrity_ok || !!meta?.integrity_ack;
  const unmatched = lineRows.filter((l) => l.match_method === "unmatched");
  const linesOk = unmatched.length === 0;
  const reasons: string[] = [];
  if (!nameOk) {
    reasons.push(
      meta?.nameMatch?.reason === "empty"
        ? "No customer name found on the document"
        : "This document appears to belong to another customer"
    );
  }
  if (!integrityOk) {
    const issues = meta?.validation?.issues ?? [];
    if (issues.length) for (const i of issues) reasons.push(i.detail);
    else reasons.push("Some figures could not be verified");
  }
  if (!linesOk) reasons.push(`${unmatched.length} unknown product${unmatched.length > 1 ? "s" : ""}`);
  return { status: nameOk && integrityOk && linesOk ? "staged" : "needs_attention", reasons };
}

function buildDocDTO(docRow: any, lineRows: any[], fileNameFallback?: string): StagedDocDTO {
  const meta = docRow.extraction_meta ?? {};
  const rc = recompute(meta, docRow.name_match_decision ?? null, lineRows);
  const lines: StagedLineDTO[] = (lineRows ?? [])
    .slice()
    .sort((a, b) => (a.line_no ?? 0) - (b.line_no ?? 0))
    .map((l) => ({
      id: l.id,
      lineNo: l.line_no ?? 0,
      description: l.description ?? "",
      quantity: num(l.quantity),
      unitPrice: num(l.unit_price),
      lineTotal: num(l.line_total),
      productId: l.product_id ?? null,
      matchedName: l.matched_product_name ?? null,
      method: l.match_method ?? "unmatched",
      needsReview: (l.match_method ?? "unmatched") === "unmatched",
      suggestion: l.raw?.suggestion ?? null,
    }));
  const persisted = docRow.status === "imported" || docRow.status === "skipped";
  return {
    id: docRow.id,
    fileName: docRow.source_file_name ?? fileNameFallback ?? null,
    number: docRow.number ?? null,
    date: docRow.doc_date ?? null,
    currency: docRow.currency ?? null,
    total: num(docRow.total_amount),
    detectedCustomer: docRow.detected_client_name ?? null,
    nameMatches: !!meta?.name_ok,
    nameScore: Number(docRow.name_match_score ?? 0),
    nameDecision: docRow.name_match_decision ?? null,
    integrityReconciles: !!meta?.validation?.reconciles,
    integrityAck: !!meta?.integrity_ack,
    confidence: Number(docRow.extraction_confidence ?? 0),
    status: persisted ? docRow.status : rc.status,
    attentionReasons: rc.reasons,
    lines,
  };
}

async function refreshBatchCounts(
  supabase: ReturnType<typeof createClient>,
  batchId: string
): Promise<{ total: number; staged: number; needs_attention: number; imported: number; skipped: number }> {
  const { data: rows } = await supabase
    .from("imported_documents")
    .select("status")
    .eq("batch_id", batchId);
  const t = { total: 0, staged: 0, needs_attention: 0, imported: 0, skipped: 0 };
  for (const r of rows ?? []) {
    t.total++;
    if (r.status === "staged") t.staged++;
    else if (r.status === "needs_attention") t.needs_attention++;
    else if (r.status === "imported") t.imported++;
    else if (r.status === "skipped") t.skipped++;
  }
  await supabase
    .from("import_batches")
    .update({
      extracted_count: t.total,
      ready_count: t.staged,
      attention_count: t.needs_attention,
      imported_count: t.imported,
    })
    .eq("id", batchId);
  return t;
}

async function reloadDocDTO(
  supabase: ReturnType<typeof createClient>,
  docId: string
): Promise<StagedDocDTO> {
  const { data: doc } = await supabase.from("imported_documents").select("*").eq("id", docId).single();
  const { data: lines } = await supabase
    .from("imported_document_lines")
    .select("*")
    .eq("imported_document_id", docId);
  return buildDocDTO(doc, lines ?? []);
}

// ---------------------------------------------------------------------------
// actions
// ---------------------------------------------------------------------------

/** Start an import session for a customer. Returns the batch id the wizard
 *  attaches every subsequent file to. */
export async function createImportBatch(
  clientId: string,
  fileCount: number
): Promise<{ batchId: string }> {
  await requireCapability("quotation.create");
  const supabase = createClient();
  const userId = await currentUserId(supabase);
  const { data, error } = await supabase
    .from("import_batches")
    .insert({ client_id: clientId, status: "extracting", file_count: fileCount, created_by: userId })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not start the import.");
  return { batchId: data.id as string };
}

/** Extract ONE already-uploaded PDF: read it, run the engine, auto-match
 *  products, and persist a staged row. Returns the DTO the wizard renders. */
export async function extractOneInvoice(input: {
  batchId: string;
  storagePath: string;
  fileName: string;
}): Promise<StagedDocDTO> {
  await requireCapability("quotation.create");
  const supabase = createClient();
  const userId = await currentUserId(supabase);

  const { data: batch } = await supabase
    .from("import_batches")
    .select("id, client_id")
    .eq("id", input.batchId)
    .maybeSingle();
  if (!batch) throw new Error("Import batch not found.");
  const clientId = batch.client_id as string;

  const { data: client } = await supabase
    .from("clients")
    .select("company_name")
    .eq("id", clientId)
    .maybeSingle();
  const expectedName = client?.company_name ?? null;

  // Download the uploaded PDF.
  const { data: blob, error: dlErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .download(input.storagePath);
  if (dlErr || !blob) throw new Error(`Could not read the uploaded file: ${dlErr?.message ?? "missing"}`);
  const buf = Buffer.from(await blob.arrayBuffer());

  // Extract + validate + name-verify.
  const staged = await extractInvoiceFromPdf({
    pdfBuffer: buf,
    expectedCustomerName: expectedName,
    docType: "invoice",
  });

  // Duplicate guard: already imported previously?
  if (staged.invoice.number) {
    const { data: dup } = await supabase
      .from("imported_documents")
      .select("id")
      .eq("client_id", clientId)
      .eq("doc_type", "invoice")
      .eq("number", staged.invoice.number)
      .eq("status", "imported")
      .maybeSingle();
    if (dup) {
      return {
        id: dup.id,
        fileName: input.fileName,
        number: staged.invoice.number,
        date: toDateOnly(staged.invoice.date),
        currency: staged.invoice.currency,
        total: staged.invoice.total_amount,
        detectedCustomer: staged.invoice.detected_customer_name,
        nameMatches: staged.nameMatch.matches,
        nameScore: staged.nameMatch.score,
        nameDecision: null,
        integrityReconciles: staged.validation.reconciles,
        integrityAck: false,
        confidence: staged.validation.minCriticalConfidence,
        status: "duplicate",
        attentionReasons: ["Already imported for this customer"],
        lines: [],
      };
    }
    // Re-extract of the same file within this batch → clear the prior staged row.
    await supabase
      .from("imported_documents")
      .delete()
      .eq("batch_id", input.batchId)
      .eq("client_id", clientId)
      .eq("doc_type", "invoice")
      .eq("number", staged.invoice.number)
      .in("status", ["staged", "needs_attention"]);
  }

  // Product matching against catalog + remembered mappings.
  const { candidates, mappings } = await loadCatalogAndMappings(supabase, clientId);
  const lineDrafts = staged.invoice.lines.map((l, i) => ({
    line: l,
    i,
    match: matchProductLine(l.description, null, candidates, mappings),
  }));
  const anyUnmatched = lineDrafts.some((d) => d.match.method === "unmatched");

  const meta = {
    model: staged.model,
    textPages: staged.textPages,
    usedPdfFallback: staged.usedPdfFallback,
    validation: {
      reconciles: staged.validation.reconciles,
      minCriticalConfidence: staged.validation.minCriticalConfidence,
      issues: staged.validation.issues,
    },
    nameMatch: {
      score: staged.nameMatch.score,
      matches: staged.nameMatch.matches,
      reason: staged.nameMatch.reason,
    },
    name_ok: staged.nameMatch.matches,
    integrity_ok: staged.validation.ok,
    integrity_ack: false,
    raw: staged.raw,
  };
  const ready = staged.nameMatch.matches && staged.validation.ok && !anyUnmatched;

  const { data: doc, error: docErr } = await supabase
    .from("imported_documents")
    .insert({
      batch_id: input.batchId,
      client_id: clientId,
      doc_type: "invoice",
      number: staged.invoice.number,
      doc_date: toDateOnly(staged.invoice.date),
      currency: staged.invoice.currency,
      subtotal: staged.invoice.subtotal,
      discount_total: staged.invoice.discount_total,
      tax_total: staged.invoice.tax_total,
      total_amount: staged.invoice.total_amount,
      notes: staged.invoice.notes,
      detected_client_name: staged.invoice.detected_customer_name,
      name_match_score: staged.nameMatch.score,
      name_match_decision: staged.nameMatch.matches ? "auto" : null,
      extraction_confidence: staged.validation.minCriticalConfidence,
      extraction_meta: meta,
      source_file_path: input.storagePath,
      source_file_name: input.fileName,
      status: ready ? "staged" : "needs_attention",
      created_by: userId,
    })
    .select("*")
    .single();
  if (docErr || !doc) throw new Error(`Could not save the invoice: ${docErr?.message ?? ""}`);

  const lineRows = lineDrafts.map((d) => ({
    imported_document_id: doc.id,
    line_no: d.i,
    description: d.line.description,
    product_id: d.match.productId,
    matched_product_name: d.match.matchedName,
    quantity: d.line.quantity,
    unit_price: d.line.unit_price,
    discount: d.line.discount_amount,
    tax_rate: d.line.tax_rate,
    tax_amount: d.line.tax_amount,
    line_total: d.line.line_total,
    match_method: d.match.method,
    raw: { extracted: d.line, suggestion: d.match.suggestion, score: d.match.score },
  }));
  let insertedLines: any[] = [];
  if (lineRows.length) {
    const { data: li } = await supabase
      .from("imported_document_lines")
      .insert(lineRows)
      .select("*");
    insertedLines = li ?? [];
  }

  await refreshBatchCounts(supabase, input.batchId);
  return buildDocDTO(doc, insertedLines, input.fileName);
}

/** Resolve an "Unknown Product" line: match an existing product, create a
 *  Legacy Product, or ignore the line — and remember the choice for next time. */
export async function resolveLineMapping(input: {
  importedDocumentId: string;
  lineId: string;
  action: "map" | "legacy" | "ignore";
  productId?: string | null;
  legacyName?: string | null;
  legacyCategoryId?: string | null;
  remember: "client" | "global" | "none";
}): Promise<StagedDocDTO> {
  await requireCapability("quotation.create");
  const supabase = createClient();
  const userId = await currentUserId(supabase);

  const { data: line } = await supabase
    .from("imported_document_lines")
    .select("id, description, imported_document_id")
    .eq("id", input.lineId)
    .single();
  if (!line) throw new Error("Line not found.");
  const { data: doc } = await supabase
    .from("imported_documents")
    .select("id, client_id")
    .eq("id", input.importedDocumentId)
    .single();
  if (!doc) throw new Error("Imported document not found.");
  const clientId = doc.client_id as string;

  let productId: string | null = input.productId ?? null;
  let method: "manual" | "legacy" | "ignored" = "manual";

  if (input.action === "ignore") {
    productId = null;
    method = "ignored";
  } else if (input.action === "legacy") {
    if (!productId) {
      productId = await insertLegacyProduct(
        supabase,
        userId,
        input.legacyName || line.description || "Legacy product",
        input.legacyCategoryId ?? null
      );
    }
    method = "legacy";
  } else {
    method = "manual";
  }

  let matchedName: string | null = null;
  if (productId) {
    const { data: p } = await supabase.from("products").select("name").eq("id", productId).maybeSingle();
    matchedName = p?.name ?? null;
  }

  await supabase
    .from("imported_document_lines")
    .update({ product_id: productId, matched_product_name: matchedName, match_method: method })
    .eq("id", input.lineId);

  if (input.remember !== "none") {
    await rememberMapping(
      supabase,
      userId,
      input.remember === "client" ? clientId : null,
      line.description ?? "",
      input.action,
      productId
    );
  }

  // Recompute + persist the document's readiness.
  const { data: allLines } = await supabase
    .from("imported_document_lines")
    .select("id, match_method")
    .eq("imported_document_id", input.importedDocumentId);
  const { data: docMeta } = await supabase
    .from("imported_documents")
    .select("extraction_meta, name_match_decision")
    .eq("id", input.importedDocumentId)
    .single();
  const rc = recompute(docMeta?.extraction_meta ?? {}, docMeta?.name_match_decision ?? null, allLines ?? []);
  await supabase.from("imported_documents").update({ status: rc.status }).eq("id", input.importedDocumentId);

  const { data: batchRow } = await supabase
    .from("imported_documents")
    .select("batch_id")
    .eq("id", input.importedDocumentId)
    .single();
  if (batchRow?.batch_id) await refreshBatchCounts(supabase, batchRow.batch_id);

  return reloadDocDTO(supabase, input.importedDocumentId);
}

/** Resolve a customer-name mismatch: 'forced' = import anyway, 'confirmed' =
 *  yes this is the customer. */
export async function setNameDecision(
  importedDocumentId: string,
  decision: "forced" | "confirmed"
): Promise<StagedDocDTO> {
  await requireCapability("quotation.create");
  const supabase = createClient();
  await supabase
    .from("imported_documents")
    .update({ name_match_decision: decision })
    .eq("id", importedDocumentId);
  await recomputeAndPersist(supabase, importedDocumentId);
  return reloadDocDTO(supabase, importedDocumentId);
}

/** Acknowledge an integrity warning (figures didn't reconcile) so the user can
 *  still import the document deliberately. */
export async function acknowledgeIntegrity(
  importedDocumentId: string
): Promise<StagedDocDTO> {
  await requireCapability("quotation.create");
  const supabase = createClient();
  const { data: doc } = await supabase
    .from("imported_documents")
    .select("extraction_meta")
    .eq("id", importedDocumentId)
    .single();
  const meta = { ...(doc?.extraction_meta ?? {}), integrity_ack: true };
  await supabase.from("imported_documents").update({ extraction_meta: meta }).eq("id", importedDocumentId);
  await recomputeAndPersist(supabase, importedDocumentId);
  return reloadDocDTO(supabase, importedDocumentId);
}

/** Skip a document entirely (won't be imported). */
export async function skipDocument(importedDocumentId: string): Promise<StagedDocDTO> {
  await requireCapability("quotation.create");
  const supabase = createClient();
  const { data: doc } = await supabase
    .from("imported_documents")
    .select("batch_id")
    .eq("id", importedDocumentId)
    .single();
  await supabase.from("imported_documents").update({ status: "skipped" }).eq("id", importedDocumentId);
  if (doc?.batch_id) await refreshBatchCounts(supabase, doc.batch_id);
  return reloadDocDTO(supabase, importedDocumentId);
}

async function recomputeAndPersist(
  supabase: ReturnType<typeof createClient>,
  docId: string
): Promise<void> {
  const { data: doc } = await supabase
    .from("imported_documents")
    .select("extraction_meta, name_match_decision, batch_id, status")
    .eq("id", docId)
    .single();
  if (!doc || doc.status === "imported" || doc.status === "skipped") return;
  const { data: lines } = await supabase
    .from("imported_document_lines")
    .select("id, match_method")
    .eq("imported_document_id", docId);
  const rc = recompute(doc.extraction_meta ?? {}, doc.name_match_decision ?? null, lines ?? []);
  await supabase.from("imported_documents").update({ status: rc.status }).eq("id", docId);
  if (doc.batch_id) await refreshBatchCounts(supabase, doc.batch_id);
}

/** Finalize: import every READY (staged) document; needs-attention ones are
 *  left for the user to resolve or skip. Emits one audit event. */
export async function commitBatch(batchId: string): Promise<CommitResult> {
  await requireCapability("quotation.create");
  const supabase = createClient();
  const nowIso = new Date().toISOString();

  const { data: batch } = await supabase
    .from("import_batches")
    .select("id, client_id")
    .eq("id", batchId)
    .maybeSingle();
  if (!batch) throw new Error("Import batch not found.");

  const { data: ready } = await supabase
    .from("imported_documents")
    .select("id")
    .eq("batch_id", batchId)
    .eq("status", "staged");
  const readyIds = (ready ?? []).map((r) => r.id);
  if (readyIds.length) {
    await supabase
      .from("imported_documents")
      .update({ status: "imported", imported_at: nowIso })
      .in("id", readyIds);
  }

  const counts = await refreshBatchCounts(supabase, batchId);
  await supabase
    .from("import_batches")
    .update({ status: "completed", completed_at: nowIso, imported_count: counts.imported })
    .eq("id", batchId);

  await emitEvent({
    entity_type: "client",
    entity_id: batch.client_id,
    event_type: "import.batch_completed",
    message: `Imported ${counts.imported} historical invoice${counts.imported === 1 ? "" : "s"}`,
    payload: { batch_id: batchId, imported: counts.imported },
    bestEffort: true,
  });

  revalidatePath(`/clients/${batch.client_id}`);
  return {
    imported: counts.imported,
    remainingAttention: counts.needs_attention,
    skipped: counts.skipped,
  };
}
