"use server";

/**
 * Server-side spec-sheet renderer (Node runtime).
 *
 * Renders the auto spec sheet for a (product, version) to a PDF Buffer via
 * @react-pdf's `renderToBuffer`, uploads it to the EXISTING `documents` bucket
 * at `spec-sheets/{productId}/{version}.pdf`, then flips the matching
 * spec_documents row to status='ready'. Returns the storage path + a signed URL.
 *
 * Invoked from the model page's Download control when the current auto sheet
 * isn't ready yet. Runs in Node because react-pdf + fontkit need Node APIs
 * (never the edge runtime — the calling route sets `runtime = "nodejs"`).
 */

import { createElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserRole } from "@/lib/auth";
import { getModel } from "../lib/read";
import { SpecSheetPDF } from "./SpecSheetPDF";
import {
  SPEC_GROUPS,
  HEADLINE_KEYS,
  DIMENSION_KEYS,
  PRODUCT_CODE_KEY,
  WARRANTY_KEY,
  CERTIFICATIONS_KEY,
  SPEC_SHEET_TEMPLATE_VERSION,
} from "../lib/specGroups";
import { formatSpecValue as formatValue } from "../lib/formatSpec";
import type { ResolvedSpec } from "../lib/types";

const DOCS_BUCKET = "documents";

export type RenderResult = { path: string; signedUrl: string | null };

export async function renderSpecSheet(productId: string, version: string): Promise<RenderResult> {
  const supabase = createClient();
  const { userId } = await getCurrentUserRole();

  const model = await getModel(productId);
  if (!model) throw new Error("Product not found.");

  // Index every resolved spec (common + model) by field key, then assemble the
  // technical-page pull-outs and the grouped mauve panel from specGroups.
  const allSpecs = [...model.commonSpecs, ...model.modelSpecs];
  const byKey = new Map(allSpecs.map((s) => [s.field.key, s] as const));
  const rowsFor = (keys: string[]) =>
    keys
      .map((k) => byKey.get(k))
      .filter((s): s is ResolvedSpec => Boolean(s))
      .map((s) => ({ label: s.field.label, value: formatValue(s) }))
      .filter((r) => r.value && r.value !== "—");
  const oneVal = (k: string) => {
    const s = byKey.get(k);
    const v = s ? formatValue(s) : "";
    return v && v !== "—" ? v : null;
  };
  const warrantyYears = (() => {
    const s = byKey.get(WARRANTY_KEY);
    if (!s?.value) return null;
    if (s.value.value_number != null) return String(s.value.value_number);
    const m = /(\d+)/.exec(s.value.value_text ?? "");
    return m ? m[1] : null;
  })();

  const data = {
    productName: model.product.name,
    sku: model.product.sku,
    categoryName: model.categoryName,
    version,
    renderedOn: new Date().toISOString().slice(0, 10),
    headline: rowsFor(HEADLINE_KEYS),
    dimensions: rowsFor(DIMENSION_KEYS),
    productCode: oneVal(PRODUCT_CODE_KEY) ?? model.product.sku ?? model.product.name,
    warrantyYears,
    certifications: oneVal(CERTIFICATIONS_KEY),
    groups: SPEC_GROUPS.map((g) => ({ title: g.title, rows: rowsFor(g.keys) })),
  };

  // Render to a Node Buffer. Poppins is fetched remotely at render time; if that
  // fetch fails, retry with the built-in Helvetica so a datasheet always renders.
  let buffer: Buffer;
  try {
    buffer = await renderToBuffer(createElement(SpecSheetPDF, { data }) as any);
  } catch {
    buffer = await renderToBuffer(createElement(SpecSheetPDF, { data, fontFamily: "Helvetica" }) as any);
  }

  // Upload (upsert) to the shared documents bucket.
  const path = `spec-sheets/${productId}/${version}.pdf`;
  const storageName = `${model.product.sku ?? model.product.name}-${version}.pdf`;
  const { error: upErr } = await supabase.storage
    .from(DOCS_BUCKET)
    .upload(path, buffer, { contentType: "application/pdf", upsert: true });
  if (upErr) {
    // Best-effort: flag the row failed so the UI can retry.
    await supabase
      .from("spec_documents")
      .update({ status: "failed" })
      .eq("product_id", productId)
      .eq("spec_version", version)
      .eq("kind", "auto");
    throw new Error(`Could not upload spec sheet: ${upErr.message}`);
  }

  // Ensure a spec_documents row exists and mark it ready.
  const { error: docErr } = await supabase.from("spec_documents").upsert(
    {
      product_id: productId,
      spec_version: version,
      kind: "auto",
      status: "ready",
      is_current: true,
      storage_path: path,
      storage_name: storageName,
      template_version: SPEC_SHEET_TEMPLATE_VERSION,
      rendered_at: new Date().toISOString(),
      created_by: userId,
    },
    { onConflict: "product_id,spec_version,kind" }
  );
  if (docErr) throw new Error(`Could not update spec document: ${docErr.message}`);

  const { data: signed } = await supabase.storage.from(DOCS_BUCKET).createSignedUrl(path, 60 * 60);
  return { path, signedUrl: signed?.signedUrl ?? null };
}

/** Return a fresh signed URL for an already-rendered sheet. Defaults to 1h;
 *  callers that hand the URL to an external fetcher (e.g. n8n downloading the
 *  PDF to attach to an email) can request a longer window. */
export async function getSpecSheetSignedUrl(
  path: string,
  expiresIn: number = 60 * 60
): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase.storage.from(DOCS_BUCKET).createSignedUrl(path, expiresIn);
  return data?.signedUrl ?? null;
}

export type BatchRenderResult = { rendered: string[]; failed: string[] };

/**
 * Render the staged auto sheets for a set of products at one version — the
 * on-publish path. Best-effort: each product renders independently; a failure
 * marks that product's auto row status='failed' (so the UI can show it and the
 * Download button can retry) and is collected in `failed`, but never throws.
 * The caller (approveRequest) has already committed the publish, so rendering
 * can never undo it.
 */
export async function renderStagedSheets(
  productIds: string[],
  version: string
): Promise<BatchRenderResult> {
  const rendered: string[] = [];
  const failed: string[] = [];

  for (const productId of productIds) {
    try {
      await renderSpecSheet(productId, version);
      rendered.push(productId);
    } catch {
      failed.push(productId);
      // Best-effort flag so the model page shows "generation failed" and the
      // staged 'pending' row doesn't linger as if still in progress.
      try {
        const supabase = createClient();
        await supabase
          .from("spec_documents")
          .update({ status: "failed" })
          .eq("product_id", productId)
          .eq("spec_version", version)
          .eq("kind", "auto");
      } catch {
        /* swallow — publish integrity must not depend on this bookkeeping */
      }
    }
  }

  return { rendered, failed };
}
