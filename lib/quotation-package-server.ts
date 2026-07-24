/**
 * Quotation package — server assembly (PRD-006, P0-1/2/3/5).
 *
 * Builds the immutable "what we sent" artifact for a quotation: the exact
 * quotation PDF that was generated, followed by each line's PINNED datasheet,
 * merged into one PDF, stored, recorded, and announced for delivery.
 *
 * Design choices:
 *   • The base is the ALREADY-GENERATED quotation PDF (documents.pdf_url), not a
 *     re-render — the record must be what was actually sent. If no quote PDF
 *     exists yet, we skip (P0-6): the caller never blocks the send.
 *   • Datasheets are the CURRENT spec_documents rows for each line's pinned
 *     version (figma_override preferred over auto), resolved through the pin.
 *   • Merge reuses lib/pdf-merge.ts (separators, page numbers, corrupt-file skip).
 *   • Each generation is a NEW immutable quotation_packages row (revision + 1).
 *
 * Best-effort: every failure returns a reason instead of throwing, so a send is
 * never broken by package assembly.
 */

import { emitEvent } from "@/lib/events";
import { createServiceClient } from "@/lib/supabase/service";
import { mergePdfs, type AppendixPayload } from "@/lib/pdf-merge";
import {
  buildPackagePlan,
  includedDatasheets,
  datasheetKey,
  type PackageLineInput,
  type DatasheetRef,
} from "@/lib/quotation-package";
import { buildVersionLabelsForCategories } from "@/features/product-knowledge-hub/lib/versionLabel";
import { renderQuotationPdfBytes } from "@/lib/quotation-pdf-render";
import { renderSpecSheet } from "@/features/product-knowledge-hub/render/renderSpecSheet";
import { buildPackageDeliveryPayload } from "@/lib/quotation-package-delivery";

const BUCKET = "documents";
const SIGNED_URL_TTL = 60 * 60 * 24; // 24h, matches the model-page datasheet send

export type PackageResult =
  | { ok: true; revision: number; included: number; missing: number; path: string }
  | { ok: false; reason: string };

/**
 * Resolve, for each catalogue line, the datasheet of its PINNED spec version,
 * plus the sales-facing labels. Returns maps keyed for `buildPackagePlan`.
 */
async function resolveLineDatasheets(
  supabase: any,
  lineRows: any[]
): Promise<{
  datasheetByKey: Map<string, DatasheetRef>;
  labelByVersionId: Map<string, string>;
}> {
  const datasheetByKey = new Map<string, DatasheetRef>();
  const labelByVersionId = new Map<string, string>();

  const versionIds = Array.from(
    new Set(lineRows.map((l) => l.spec_version_id).filter(Boolean))
  ) as string[];
  if (versionIds.length === 0) return { datasheetByKey, labelByVersionId };

  // pin id -> { version string, category_id }
  const { data: vers } = await supabase
    .from("spec_versions")
    .select("id, version, category_id")
    .in("id", versionIds);
  const verById = new Map<string, { version: string; category_id: string }>();
  for (const v of (vers ?? []) as any[]) {
    verById.set(v.id, { version: v.version, category_id: v.category_id });
  }

  // Labels: build per-family so collision suffixes (-r2) stay scoped, then merge.
  const categoryIds = Array.from(
    new Set(Array.from(verById.values()).map((v) => v.category_id).filter(Boolean))
  ) as string[];
  if (categoryIds.length) {
    const { data: famVers } = await supabase
      .from("spec_versions")
      .select("id, category_id, version, published_at")
      .in("category_id", categoryIds);
    for (const [id, label] of buildVersionLabelsForCategories(
      (famVers ?? []) as any[]
    )) {
      labelByVersionId.set(id, label);
    }
  }

  // Datasheets: fetch spec_documents for the (product, version) pairs on the
  // lines, then pick figma_override over auto per pair.
  const productIds = Array.from(
    new Set(lineRows.map((l) => l.product_id).filter(Boolean))
  ) as string[];
  const versionStrings = Array.from(
    new Set(Array.from(verById.values()).map((v) => v.version))
  );
  if (productIds.length && versionStrings.length) {
    const { data: docs } = await supabase
      .from("spec_documents")
      .select("product_id, spec_version, kind, storage_path, storage_name")
      .in("product_id", productIds)
      .in("spec_version", versionStrings);
    // Prefer figma_override; index by product + version string.
    const best = new Map<string, any>();
    for (const d of (docs ?? []) as any[]) {
      if (!d.storage_path) continue;
      const key = `${d.product_id} ${d.spec_version}`;
      const cur = best.get(key);
      if (!cur || (d.kind === "figma_override" && cur.kind !== "figma_override")) {
        best.set(key, d);
      }
    }
    // Re-key by the line's (product_id, spec_version_id) so the plan can look up.
    for (const l of lineRows) {
      if (!l.product_id || !l.spec_version_id) continue;
      const ver = verById.get(l.spec_version_id);
      if (!ver) continue;
      const d = best.get(`${l.product_id} ${ver.version}`);
      if (d) {
        datasheetByKey.set(datasheetKey(l.product_id, l.spec_version_id), {
          storage_path: d.storage_path,
          storage_name: d.storage_name ?? null,
        });
      }
    }
  }

  // On-demand render (PRD-006): a pinned catalogue line with no rendered
  // datasheet gets one generated NOW, so the package is always complete
  // regardless of whether the model page was ever opened (auto-render is
  // otherwise lazy — on model-page view only). Best-effort per line: a render
  // failure just leaves the line noted as missing, never breaks the package.
  // The pin is the CURRENT version at send, so rendering current specs is
  // accurate provenance.
  for (const l of lineRows) {
    if (!l.product_id || !l.spec_version_id) continue;
    const key = datasheetKey(l.product_id, l.spec_version_id);
    if (datasheetByKey.has(key)) continue;
    const ver = verById.get(l.spec_version_id);
    if (!ver?.version) continue;
    try {
      const { path } = await renderSpecSheet(l.product_id, ver.version);
      datasheetByKey.set(key, { storage_path: path, storage_name: null });
    } catch {
      /* leave missing — the package notes it, never fails the send. */
    }
  }

  return { datasheetByKey, labelByVersionId };
}

/**
 * Assemble, store, and announce the quotation package. Returns a reason (never
 * throws) so the caller can stay best-effort.
 */
export async function generateQuotationPackage(
  sessionClient: any,
  documentId: string,
  generatedBy: string | null
): Promise<PackageResult> {
  // System write: quotation_packages is an admin-RLS system table (like
  // spec_documents), so the record + storage are written with the service-role
  // client that bypasses RLS — the same pattern the datasheets route uses.
  // Falls back to the caller's session client only when the service key is unset.
  const supabase = createServiceClient() ?? sessionClient;
  try {
    // Resilient read: attach_datasheets may not exist pre-m179, in which case
    // we fall back and default to attaching (the column's own default).
    let docRes = await supabase
      .from("documents")
      .select(
        "id, number, version, pdf_url, attach_datasheets, client_id, sales_owner_id, created_by, clients(company_name, email, phone_number)"
      )
      .eq("id", documentId)
      .maybeSingle();
    if (docRes.error) {
      docRes = await supabase
        .from("documents")
        .select("id, number, version, pdf_url, client_id, sales_owner_id, created_by, clients(company_name, email, phone_number)")
        .eq("id", documentId)
        .maybeSingle();
    }
    const doc: any = docRes.data;
    if (!doc) return { ok: false, reason: "no_document" };
    // Delivery is opt-out per quote (default true). The pin is frozen elsewhere
    // regardless; this only controls whether the package is built/sent.
    if (doc.attach_datasheets === false) {
      return { ok: false, reason: "attach_disabled" };
    }

    const { data: lineRows } = await supabase
      .from("document_lines")
      .select("id, product_id, spec_version_id, product_name, category_id, include_datasheet, products(category_id)")
      .eq("document_id", documentId);
    const lines: PackageLineInput[] = ((lineRows ?? []) as any[]).map((l) => ({
      id: l.id,
      product_id: l.product_id ?? null,
      spec_version_id: l.spec_version_id ?? null,
      product_name: l.product_name ?? null,
      // m182 — undefined (pre-migration / older row) is treated as included.
      include_datasheet: l.include_datasheet !== false,
    }));

    const { datasheetByKey, labelByVersionId } = await resolveLineDatasheets(
      supabase,
      (lineRows ?? []) as any[]
    );
    const plan = buildPackagePlan(lines, datasheetByKey, labelByVersionId);

    // Base quote PDF bytes. Prefer the ALREADY-SENT artifact (documents.pdf_url)
    // — the truest record of what the customer received. If none exists yet
    // (rep marked sent before generating it), render it server-side from the
    // shared builder (P2-2), so a package can always be produced.
    let quoteBytes: Uint8Array | null = null;
    if (doc.pdf_url) {
      const quoteDl = await supabase.storage.from(BUCKET).download(doc.pdf_url);
      if (!quoteDl.error && quoteDl.data) {
        quoteBytes = new Uint8Array(await quoteDl.data.arrayBuffer());
      }
    }
    if (!quoteBytes) {
      quoteBytes = await renderQuotationPdfBytes(supabase, documentId);
    }
    if (!quoteBytes) return { ok: false, reason: "quote_pdf_unavailable" };

    // Download each included datasheet ONCE — dedupe by storage_path, since the
    // same product/spec can appear on several quote lines (Change 2 de-dupe).
    const payloads: AppendixPayload[] = [];
    const seenPaths = new Set<string>();
    for (const it of includedDatasheets(plan)) {
      if (!it.storage_path || seenPaths.has(it.storage_path)) continue;
      seenPaths.add(it.storage_path);
      const dl = await supabase.storage.from(BUCKET).download(it.storage_path);
      if (dl.error || !dl.data) continue; // skip; merge reports skips too
      payloads.push({
        kind: "pdf",
        label: it.product_name ?? "Datasheet",
        type_label: it.spec_label ? `Datasheet — Spec ${it.spec_label}` : "Datasheet",
        file_name: it.storage_name ?? `${it.product_name ?? "datasheet"}.pdf`,
        mime_type: "application/pdf",
        storage_path: it.storage_path,
        note: null,
        bytes: new Uint8Array(await dl.data.arrayBuffer()),
      });
    }

    // Change 2 — TWO attachments: the quote stays on its own; the selected
    // datasheets bundle into ONE separate PDF (null when nothing to attach).
    const specsCount = payloads.length;
    const specsBytes = specsCount ? (await mergePdfs(payloads)).bytes : null;

    // Next revision (immutable — never overwrite a prior package).
    const { data: last } = await supabase
      .from("quotation_packages")
      .select("revision")
      .eq("document_id", documentId)
      .order("revision", { ascending: false })
      .limit(1)
      .maybeSingle();
    const revision = ((last as any)?.revision ?? 0) + 1;

    const quotePath = `quotation-packages/${documentId}/r${revision}_quote.pdf`;
    const specsPath = `quotation-packages/${documentId}/r${revision}_specs.pdf`;
    const quoteDownloadName = `${doc.number ?? documentId}_Quotation.pdf`;
    const specsDownloadName = `${doc.number ?? documentId}_Datasheets.pdf`;

    const upQuote = await supabase.storage
      .from(BUCKET)
      .upload(quotePath, quoteBytes, { contentType: "application/pdf", upsert: true });
    if (upQuote.error) return { ok: false, reason: `upload_failed: ${upQuote.error.message}` };
    if (specsBytes) {
      const upSpecs = await supabase.storage
        .from(BUCKET)
        .upload(specsPath, specsBytes, { contentType: "application/pdf", upsert: true });
      if (upSpecs.error) return { ok: false, reason: `upload_failed: ${upSpecs.error.message}` };
    }

    // Insert the record. specs_* columns (m183) are stripped on the fallback so
    // an un-migrated env still records the quote.
    const baseRow = {
      document_id: documentId,
      revision,
      quotation_version: doc.version ?? null,
      storage_path: quotePath,
      storage_name: quoteDownloadName,
      lines: plan.items,
      included_count: plan.includedCount,
      missing_count: plan.missingCount,
      generated_by: generatedBy ?? null,
    };
    const rowWithSpecs = {
      ...baseRow,
      specs_storage_path: specsBytes ? specsPath : null,
      specs_storage_name: specsBytes ? specsDownloadName : null,
    };
    let insErr = (await supabase.from("quotation_packages").insert(rowWithSpecs)).error;
    if (insErr && /specs_storage/.test(insErr.message ?? "")) {
      insErr = (await supabase.from("quotation_packages").insert(baseRow)).error;
    }
    if (insErr) return { ok: false, reason: `record_failed: ${insErr.message}` };

    // Announce for delivery (n8n consumes the webhook and sends). Sign both files.
    const signedQuote = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(quotePath, SIGNED_URL_TTL, { download: quoteDownloadName });
    const signedSpecs = specsBytes
      ? await supabase.storage
          .from(BUCKET)
          .createSignedUrl(specsPath, SIGNED_URL_TTL, { download: specsDownloadName })
      : null;
    const client = (doc as any).clients ?? null;
    // Option B — prefer the client's primary contact email over clients.email.
    // Best-effort: pre-m101 envs / no contacts → null, falls back to clients.email.
    let primaryContact: { name?: string | null; email?: string | null } | null = null;
    if (doc.client_id) {
      const { data: c } = await supabase
        .from("contacts")
        .select("name, email, is_primary")
        .eq("client_id", doc.client_id)
        .eq("is_primary", true)
        .not("email", "is", null)
        .limit(1)
        .maybeSingle();
      primaryContact = (c as any) ?? null;
    }
    // Sales owner (quote owner, else creator) → reply-to on the delivery email.
    // The email lives in auth.users, so it needs the service-role admin API;
    // best-effort — a missing owner just leaves sales_email null (n8n falls back).
    let salesOwner: { name?: string | null; email?: string | null } | null = null;
    const ownerId = (doc as any).sales_owner_id ?? (doc as any).created_by ?? null;
    if (ownerId) {
      try {
        const svc = createServiceClient();
        if (svc) {
          const { data: u } = await svc.auth.admin.getUserById(ownerId);
          const email = u?.user?.email ?? null;
          const name =
            (u?.user?.user_metadata?.display_name as string | undefined) ??
            (u?.user?.user_metadata?.full_name as string | undefined) ??
            null;
          if (email || name) salesOwner = { name, email };
        }
      } catch {
        /* best-effort — never block the package emit on owner lookup */
      }
    }
    await emitEvent({
      entity_type: "document",
      entity_id: documentId,
      event_type: "spec_sheet.sent",
      message: `Quotation package r${revision} ready (${plan.includedCount}/${plan.includedCount + plan.missingCount} datasheets)`,
      payload: buildPackageDeliveryPayload({
        revision,
        quoteUrl: signedQuote.data?.signedUrl ?? null,
        quoteFilename: quoteDownloadName,
        specsUrl: signedSpecs?.data?.signedUrl ?? null,
        specsFilename: specsBytes ? specsDownloadName : null,
        specsCount,
        included: plan.includedCount,
        missing: plan.missingCount,
        quoteNumber: doc.number ?? null,
        clientId: doc.client_id ?? null,
        client,
        primaryContact,
        salesOwner,
      }),
      bestEffort: true,
    });

    return {
      ok: true,
      revision,
      included: plan.includedCount,
      missing: plan.missingCount,
      path: quotePath,
    };
  } catch (e: any) {
    return { ok: false, reason: `uncaught: ${e?.message ?? "unknown"}` };
  }
}
