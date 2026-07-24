"use server";

/**
 * Product Knowledge Hub — server actions (all mutations live here).
 *
 * Workflow: operations RAISES a change request (draft) → attaches evidence →
 * SUBMITS → an approver attaches a SIGNED document → APPROVES. Approval refuses
 * without a signed document, then applies the diff to spec_values, bumps the
 * family version, (re)stages the affected spec sheets, and marks the request
 * published. Reject sends the request back to draft.
 *
 * Gates mirror the app convention: requireCapabilityOrAdmin (admin floor).
 * Failures throw new Error(msg). Hub routes are revalidated after each mutation.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserRole } from "@/lib/auth";
import { requireCapabilityOrAdmin } from "@/lib/permissions";
import { emitEvent } from "@/lib/events";
import { modelsFromDiff } from "./lib/diff";
import { extractFromText, type ExtractResult } from "./lib/extractRules";
import { buildImportPlan, commitImportPlan } from "./lib/importCore";
import type {
  ImportCommitResult,
  ImportDryRun,
  ImportRow,
  SpecChangeRequest,
  SpecDiffEntry,
  SpecScope,
  SpecValueKind,
} from "./lib/types";

const HUB_BASE = "/productknowledgehub";

function revalidateHub(categoryId?: string | null) {
  revalidatePath(HUB_BASE);
  if (categoryId) revalidatePath(`${HUB_BASE}/${categoryId}`);
}

/** Bump a "vMAJOR.MINOR" string by one minor. Falls back to v1.0 → v1.1. */
function bumpVersion(current: string | null): string {
  if (!current) return "v1.0";
  const m = /^v?(\d+)\.(\d+)$/.exec(current.trim());
  if (!m) return "v1.1";
  const major = Number(m[1]);
  const minor = Number(m[2]) + 1;
  return `v${major}.${minor}`;
}

/* ===========================================================================
   Raise / submit (operations)
   =========================================================================== */

/** Create a draft change request for a family with the computed diff. */
export async function createChangeRequest(
  categoryId: string,
  diff: SpecDiffEntry[],
  reason: string
): Promise<string> {
  await requireCapabilityOrAdmin("spec.raise");
  const supabase = createClient();
  const { userId } = await getCurrentUserRole();

  // Current published version becomes version_from.
  const { data: latest } = await supabase
    .from("spec_versions")
    .select("version")
    .eq("category_id", categoryId)
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("spec_change_requests")
    .insert({
      category_id: categoryId,
      status: "draft",
      reason: reason || null,
      diff: diff ?? [],
      version_from: (latest as { version: string } | null)?.version ?? null,
      created_by: userId,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Could not create change request: ${error.message}`);
  revalidateHub(categoryId);
  return (data as { id: string }).id;
}

/** Attach an uploaded evidence file (already in storage) to a request. */
export async function attachEvidence(
  id: string,
  input: { path: string; name: string }
): Promise<void> {
  await requireCapabilityOrAdmin("spec.raise");
  const supabase = createClient();
  const { error } = await supabase
    .from("spec_change_requests")
    .update({ evidence_path: input.path, evidence_name: input.name })
    .eq("id", id);
  if (error) throw new Error(`Could not attach evidence: ${error.message}`);
  const { data } = await supabase.from("spec_change_requests").select("category_id").eq("id", id).maybeSingle();
  revalidateHub((data as { category_id: string | null } | null)?.category_id);
}

/** Submit a draft request for approval. */
export async function submitRequest(id: string): Promise<void> {
  await requireCapabilityOrAdmin("spec.raise");
  const supabase = createClient();
  const { data: cr, error: readErr } = await supabase
    .from("spec_change_requests")
    .select("category_id, status")
    .eq("id", id)
    .maybeSingle();
  if (readErr || !cr) throw new Error("Change request not found.");

  const { error } = await supabase
    .from("spec_change_requests")
    .update({ status: "submitted", submitted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`Could not submit change request: ${error.message}`);

  await emitEvent({
    entity_type: "spec_change_request",
    entity_id: id,
    event_type: "spec.submitted",
    message: "Spec change request submitted for approval",
    bestEffort: true,
  });
  revalidateHub((cr as { category_id: string | null }).category_id);
}

/* ===========================================================================
   Approve / reject (task_list_manager)
   =========================================================================== */

/** Attach the SIGNED document (the artifact that unlocks approval). */
export async function attachSignedDocument(
  id: string,
  input: { path: string; name: string; kind: "pdf" | "excel"; signer: string }
): Promise<void> {
  await requireCapabilityOrAdmin("spec.approve");
  const supabase = createClient();
  const { error } = await supabase
    .from("spec_change_requests")
    .update({
      signed_doc_path: input.path,
      signed_doc_name: input.name,
      signed_doc_kind: input.kind,
      signer_name: input.signer,
      signed_at: new Date().toISOString(),
      status: "waiting_approval",
    })
    .eq("id", id);
  if (error) throw new Error(`Could not attach signed document: ${error.message}`);
  const { data } = await supabase.from("spec_change_requests").select("category_id").eq("id", id).maybeSingle();
  revalidateHub((data as { category_id: string | null } | null)?.category_id);
}

/**
 * Approve + publish a change request:
 *   - REFUSE if no signed document is attached,
 *   - apply the diff to spec_values,
 *   - insert a new spec_versions row (bumped version),
 *   - stage a pending 'auto' spec_document for every affected product
 *     (marking the previous ones not-current, and any figma_override stale),
 *   - emit spec.published, mark the request published.
 */
export async function approveRequest(id: string): Promise<{ version: string }> {
  await requireCapabilityOrAdmin("spec.approve");
  const supabase = createClient();
  const { userId } = await getCurrentUserRole();

  const { data: crRow, error: readErr } = await supabase
    .from("spec_change_requests")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (readErr || !crRow) throw new Error("Change request not found.");
  const cr = crRow as SpecChangeRequest;

  if (!cr.signed_doc_path) {
    throw new Error("Cannot approve: a signed document must be attached first.");
  }
  if (!cr.category_id) throw new Error("Change request has no family attached.");
  const categoryId = cr.category_id;
  const diff = (cr.diff ?? []) as SpecDiffEntry[];

  // 1. Apply the diff → spec_values (update existing row, else insert).
  for (const entry of diff) {
    const target = entry.scope === "common"
      ? { column: "category_id" as const, id: categoryId }
      : { column: "product_id" as const, id: entry.product_id };
    if (!target.id) continue;

    const { data: existing } = await supabase
      .from("spec_values")
      .select("id")
      .eq("field_id", entry.field_id)
      .eq(target.column, target.id)
      .maybeSingle();

    const payload = {
      value_number: entry.to.value_number,
      value_text: entry.to.value_text,
      unit: entry.unit,
      updated_at: new Date().toISOString(),
    };

    if (existing) {
      const { error } = await supabase.from("spec_values").update(payload).eq("id", (existing as { id: string }).id);
      if (error) throw new Error(`Could not apply spec value: ${error.message}`);
    } else {
      const { error } = await supabase.from("spec_values").insert({
        field_id: entry.field_id,
        [target.column]: target.id,
        ...payload,
      });
      if (error) throw new Error(`Could not apply spec value: ${error.message}`);
    }
  }

  // 2. Bump the version and record it.
  const { data: latest } = await supabase
    .from("spec_versions")
    .select("version")
    .eq("category_id", categoryId)
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const newVersion = bumpVersion((latest as { version: string } | null)?.version ?? cr.version_from);

  const { error: verErr } = await supabase.from("spec_versions").insert({
    category_id: categoryId,
    version: newVersion,
    change_request_id: id,
    author: userId,
    reason: cr.reason,
    changes_json: diff,
    signed_doc_path: cr.signed_doc_path,
  });
  if (verErr) throw new Error(`Could not publish version: ${verErr.message}`);

  // 3. (Re)stage spec sheets for the affected products.
  const { data: prods } = await supabase.from("products").select("id").eq("category_id", categoryId);
  const allProductIds = ((prods ?? []) as { id: string }[]).map((p) => p.id);
  const affected = modelsFromDiff(allProductIds, diff);

  if (affected.length > 0) {
    // Previous sheets are no longer the current version.
    await supabase
      .from("spec_documents")
      .update({ is_current: false })
      .in("product_id", affected)
      .neq("spec_version", newVersion);
    // Any figma_override on an older version is now stale.
    await supabase
      .from("spec_documents")
      .update({ status: "stale" })
      .in("product_id", affected)
      .eq("kind", "figma_override")
      .neq("spec_version", newVersion);
    // Stage a pending auto sheet per affected product for the new version.
    for (const productId of affected) {
      const { error } = await supabase.from("spec_documents").upsert(
        {
          product_id: productId,
          spec_version: newVersion,
          kind: "auto",
          status: "pending",
          is_current: true,
          created_by: userId,
        },
        { onConflict: "product_id,spec_version,kind" }
      );
      if (error) throw new Error(`Could not stage spec sheet: ${error.message}`);
    }
  }

  // 4. Mark the request published.
  const { error: crErr } = await supabase
    .from("spec_change_requests")
    .update({
      status: "published",
      approved_by: userId,
      approved_at: new Date().toISOString(),
      version_to: newVersion,
    })
    .eq("id", id);
  if (crErr) throw new Error(`Could not close change request: ${crErr.message}`);

  await emitEvent({
    entity_type: "spec_change_request",
    entity_id: id,
    event_type: "spec.published",
    message: `Spec published (${newVersion}) — ${affected.length} model(s) affected`,
    payload: { category_id: categoryId, version: newVersion, affected },
    bestEffort: true,
  });

  // Every model carries a bespoke glossy datasheet, so a content change means
  // each affected model's designed sheet needs a redo. The auto sheet already
  // renders the new values; this nudges an admin to refresh the glossy (and the
  // published CR offers a downloadable diff to drive that edit). One event per
  // publish, listing the affected models — best-effort (never blocks publish).
  if (affected.length > 0) {
    await emitEvent({
      entity_type: "spec_change_request",
      entity_id: id,
      event_type: "datasheet.refresh_needed",
      message: `Glossy datasheet refresh needed (${newVersion}) — ${affected.length} model(s)`,
      payload: { category_id: categoryId, version: newVersion, affected, change_request_id: id },
      bestEffort: true,
    });
  }

  // Auto sheets for the affected models were staged 'pending' above; they
  // render out of band — the model page's AutoDatasheetStatus triggers the
  // render on view — so approval never blocks on PDF generation.
  // renderStagedSheets() is the batch equivalent, kept for a future
  // service-role worker (see docs/…Spec_Layer_Decisions.md).

  revalidateHub(categoryId);
  return { version: newVersion };
}

/** Reject a request back to draft with a reason. */
export async function rejectRequest(id: string, reason: string): Promise<void> {
  await requireCapabilityOrAdmin("spec.approve");
  const supabase = createClient();
  const { data: cr } = await supabase
    .from("spec_change_requests")
    .select("category_id")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase
    .from("spec_change_requests")
    .update({ status: "draft", reason: reason || null })
    .eq("id", id);
  if (error) throw new Error(`Could not reject change request: ${error.message}`);

  await emitEvent({
    entity_type: "spec_change_request",
    entity_id: id,
    event_type: "spec.rejected",
    message: reason ? `Spec change rejected: ${reason}` : "Spec change rejected",
    bestEffort: true,
  });
  revalidateHub((cr as { category_id: string | null } | null)?.category_id);
}

/* ===========================================================================
   Baseline import (spec.import — admin only)
   ===========================================================================
   Bulk-seed a family's spec schema + values from a CSV, and (optionally) attach
   a designed spec-sheet PDF to a model. `dryRunImport` matches the rows against
   the real catalog and reports what WOULD happen (no writes); `importBaseline`
   performs the idempotent commit; `recordUploadedSpecSheet` records a PDF that
   the client already uploaded to the `documents` bucket (mirrors the app's
   GeneratePdfButton storage pattern). All three admit admin/super_admin via the
   requireCapabilityOrAdmin floor. */

/**
 * Dry-run preview: match rows against the catalog; NOTHING is written.
 * The matching logic lives in ./lib/importCore (session-free) so the inbound
 * n8n callback can reuse the exact same plan builder.
 */
export async function dryRunImport(rows: ImportRow[]): Promise<ImportDryRun> {
  await requireCapabilityOrAdmin("spec.import");
  const { report } = await buildImportPlan(createClient(), rows ?? []);
  return report;
}

/**
 * Commit the baseline import (gated wrapper). The idempotent commit logic lives
 * in ./lib/importCore (session-free, client-parameterized) so the inbound n8n
 * callback can reuse it with the service-role client. This action keeps the
 * user-facing concerns: the spec.import gate, the acting user's id, and hub
 * revalidation.
 */
export async function importBaseline(rows: ImportRow[]): Promise<ImportCommitResult> {
  await requireCapabilityOrAdmin("spec.import");
  const { userId } = await getCurrentUserRole();
  const result = await commitImportPlan(createClient(), rows ?? [], { authorId: userId });
  revalidatePath(HUB_BASE);
  return result;
}

/**
 * Record a spec-sheet PDF the client already uploaded to the `documents` bucket
 * (mirrors GeneratePdfButton). Inserts/updates a spec_documents row as a current
 * figma_override for the (product, version). Admin-only via the spec.import floor.
 */
export async function recordUploadedSpecSheet(
  productId: string,
  version: string,
  path: string,
  name: string
): Promise<void> {
  await requireCapabilityOrAdmin("spec.import");
  const supabase = createClient();
  const { userId } = await getCurrentUserRole();

  const { error } = await supabase.from("spec_documents").upsert(
    {
      product_id: productId,
      spec_version: version,
      kind: "figma_override",
      status: "ready",
      is_current: true,
      storage_path: path,
      storage_name: name,
      created_by: userId,
    },
    { onConflict: "product_id,spec_version,kind" }
  );
  if (error) throw new Error(`Could not record spec sheet: ${error.message}`);
  revalidatePath(HUB_BASE);
}

/**
 * Extract import rows from a spec-sheet PDF already uploaded to the `documents`
 * bucket. Rule-based (no OCR / LLM) via ./lib/extractRules. Read-only: produces
 * ImportRow[] for the dry-run preview — never writes spec data. Admin-only.
 * Requires the Node runtime (unpdf/pdfjs); the import route sets runtime='nodejs'.
 */
export async function extractSpecSheet(storagePath: string, filename: string): Promise<ExtractResult> {
  await requireCapabilityOrAdmin("spec.import");
  const supabase = createClient();

  const { data, error } = await supabase.storage.from("documents").download(storagePath);
  if (error || !data) throw new Error(`Could not read PDF: ${error?.message ?? "file not found"}`);

  const bytes = new Uint8Array(await data.arrayBuffer());
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);

  // Reconstruct VISUAL lines from text-item coordinates. unpdf/pdf.js emits
  // text in run order (a whole column of labels, then the column of values),
  // which breaks "Label value" rules. Grouping items by their y position and
  // sorting by x rebuilds the on-page "Label  value" lines the rules expect.
  const lines: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    type Frag = { x: number; w: number; h: number; s: string };
    const rows = new Map<number, Frag[]>();
    for (const it of tc.items as { str?: string; transform?: number[]; width?: number; height?: number }[]) {
      if (!it.str || !it.transform) continue;
      const y = Math.round(it.transform[5]);
      const arr = rows.get(y) ?? (rows.set(y, []), rows.get(y)!);
      arr.push({ x: it.transform[4], w: it.width ?? 0, h: it.height || Math.abs(it.transform[3]) || 10, s: it.str });
    }
    for (const y of [...rows.keys()].sort((a, b) => b - a)) {
      // Gap-aware join: only insert a space on a real x-gap, so adjacent digit
      // fragments ("3" + "84") stay glued ("384") instead of splitting.
      const frags = rows.get(y)!.sort((a, b) => a.x - b.x);
      let line = "";
      let prevEnd: number | null = null;
      for (const f of frags) {
        if (f.s.trim() === "") {
          prevEnd = f.x + f.w;
          continue;
        }
        if (prevEnd !== null && f.x - prevEnd > f.h * 0.25) line += " ";
        line += f.s;
        prevEnd = f.x + f.w;
      }
      line = line.replace(/\s+/g, " ").trim();
      if (line) lines.push(line);
    }
  }
  const full = lines.join("\n");

  // Image-only / scanned PDF → no embedded text. Don't guess; flag it.
  if (!full || full.trim().length < 20) {
    return {
      family: null,
      sku: null,
      ptype: null,
      rows: [],
      missingRequired: [],
      layoutSuspect: true,
      warnings: ["No embedded text found — this looks scanned. OCR is out of scope; enter values manually."],
    };
  }

  return extractFromText(filename, full);
}

/* ===========================================================================
   Schema editor (admin — spec.manage_schema)

   Direct, un-versioned edits to the per-family spec schema (spec_fields).
   This is deliberately OUTSIDE the change-request flow: schema management is
   an admin concern (see Solux_Hub_Spec_Layer_Decisions.md), whereas raising a
   change request versions the *values*. Every write emits spec.schema_changed
   so the edit is still on the audit trail.

   Data-protection rule: a field can only be DELETED when no spec_values
   reference it. We never cascade-delete values from the UI.
   =========================================================================== */

/** Shape accepted by create/update. `sort` defaults to end-of-list on create. */
export type SchemaFieldInput = {
  scope: SpecScope;
  key: string;
  label: string;
  value_kind: SpecValueKind;
  unit?: string | null;
  sort?: number | null;
};

const SCOPES: SpecScope[] = ["common", "model"];
const KINDS: SpecValueKind[] = ["number", "text", "enum", "dimension"];

function validateFieldInput(input: SchemaFieldInput): void {
  if (!input.key?.trim()) throw new Error("Field key is required.");
  if (!/^[a-z0-9_]+$/.test(input.key.trim())) {
    throw new Error("Field key must be lowercase letters, numbers or underscores (e.g. battery_capacity).");
  }
  if (!input.label?.trim()) throw new Error("Field label is required.");
  if (!SCOPES.includes(input.scope)) throw new Error("Scope must be 'common' or 'model'.");
  if (!KINDS.includes(input.value_kind)) throw new Error("Value kind must be number, text, enum or dimension.");
}

/** Add a new spec field to a family. Key must be unique within the family. */
export async function createSchemaField(
  categoryId: string,
  input: SchemaFieldInput
): Promise<string> {
  await requireCapabilityOrAdmin("spec.manage_schema");
  validateFieldInput(input);
  const supabase = createClient();
  const key = input.key.trim();

  // Uniqueness guard (per family) — friendlier than a raw constraint error.
  const { data: clash } = await supabase
    .from("spec_fields")
    .select("id")
    .eq("category_id", categoryId)
    .eq("key", key)
    .maybeSingle();
  if (clash) throw new Error(`A field with key "${key}" already exists in this family.`);

  // Default sort = current max + 1 so new fields land at the end.
  let sort = input.sort ?? null;
  if (sort == null) {
    const { data: last } = await supabase
      .from("spec_fields")
      .select("sort")
      .eq("category_id", categoryId)
      .order("sort", { ascending: false })
      .limit(1)
      .maybeSingle();
    sort = ((last as { sort: number | null } | null)?.sort ?? 0) + 1;
  }

  const { data, error } = await supabase
    .from("spec_fields")
    .insert({
      category_id: categoryId,
      scope: input.scope,
      key,
      label: input.label.trim(),
      value_kind: input.value_kind,
      unit: input.unit?.trim() || null,
      sort,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Could not create field: ${error.message}`);

  const fieldId = (data as { id: string }).id;
  await emitEvent({
    entity_type: "system",
    entity_id: fieldId,
    event_type: "spec.schema_changed",
    message: `Spec field "${input.label.trim()}" (${key}) added`,
    bestEffort: true,
  });
  revalidateHub(categoryId);
  revalidatePath(`${HUB_BASE}/schema`);
  return fieldId;
}

/** Edit an existing field's label / unit / sort / scope / value_kind / key. */
export async function updateSchemaField(
  id: string,
  input: SchemaFieldInput
): Promise<void> {
  await requireCapabilityOrAdmin("spec.manage_schema");
  validateFieldInput(input);
  const supabase = createClient();

  const { data: current, error: readErr } = await supabase
    .from("spec_fields")
    .select("category_id, key")
    .eq("id", id)
    .maybeSingle();
  if (readErr || !current) throw new Error("Field not found.");
  const categoryId = (current as { category_id: string }).category_id;
  const key = input.key.trim();

  // If the key changed, keep it unique within the family.
  if (key !== (current as { key: string }).key) {
    const { data: clash } = await supabase
      .from("spec_fields")
      .select("id")
      .eq("category_id", categoryId)
      .eq("key", key)
      .neq("id", id)
      .maybeSingle();
    if (clash) throw new Error(`A field with key "${key}" already exists in this family.`);
  }

  const { error } = await supabase
    .from("spec_fields")
    .update({
      scope: input.scope,
      key,
      label: input.label.trim(),
      value_kind: input.value_kind,
      unit: input.unit?.trim() || null,
      ...(input.sort != null ? { sort: input.sort } : {}),
    })
    .eq("id", id);
  if (error) throw new Error(`Could not update field: ${error.message}`);

  await emitEvent({
    entity_type: "system",
    entity_id: id,
    event_type: "spec.schema_changed",
    message: `Spec field "${input.label.trim()}" (${key}) updated`,
    bestEffort: true,
  });
  revalidateHub(categoryId);
  revalidatePath(`${HUB_BASE}/schema`);
}

/**
 * Delete a field — ONLY when no spec_values reference it (data-protection
 * rule). Returns the count so the UI can explain a refusal.
 */
export async function deleteSchemaField(id: string): Promise<void> {
  await requireCapabilityOrAdmin("spec.manage_schema");
  const supabase = createClient();

  const { data: field, error: readErr } = await supabase
    .from("spec_fields")
    .select("category_id, key, label")
    .eq("id", id)
    .maybeSingle();
  if (readErr || !field) throw new Error("Field not found.");

  const { count, error: countErr } = await supabase
    .from("spec_values")
    .select("id", { count: "exact", head: true })
    .eq("field_id", id);
  if (countErr) throw new Error(`Could not check field usage: ${countErr.message}`);
  if ((count ?? 0) > 0) {
    throw new Error(
      `Cannot delete: this field still has ${count} value${count === 1 ? "" : "s"}. ` +
        `Clear the values first (via a change request), then delete the field.`
    );
  }

  const { error } = await supabase.from("spec_fields").delete().eq("id", id);
  if (error) throw new Error(`Could not delete field: ${error.message}`);

  const f = field as { category_id: string; key: string; label: string };
  await emitEvent({
    entity_type: "system",
    entity_id: id,
    event_type: "spec.schema_changed",
    message: `Spec field "${f.label}" (${f.key}) deleted`,
    bestEffort: true,
  });
  revalidateHub(f.category_id);
  revalidatePath(`${HUB_BASE}/schema`);
}
