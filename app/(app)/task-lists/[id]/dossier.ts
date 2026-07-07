"use client";

/**
 * Production Dossier generation pipeline (browser-side):
 *
 *   fetchExportData → render ProductionDossierPDF (@react-pdf, dynamic import,
 *   F3-safe) → download the appendix files from Storage → merge with pdf-lib
 *   → one complete PDF blob.
 *
 * Shared by "Generate Production PDF" and "Send by Email" so both always
 * produce the identical package.
 */

import { createClient } from "@/lib/supabase/client";
import { ATTACHMENTS_BUCKET } from "@/lib/attachments";
import { planAppendix, type AppendixItem } from "@/lib/production-dossier";
import { buildPdfFilename } from "@/lib/pdf-filename";
import { fetchExportData, type ExportData } from "./exportData";
import type { AppendixPayload } from "@/lib/pdf-merge";

export type DossierResult = {
  blob: Blob;
  fileName: string;
  data: ExportData;
  /** Files listed in the index as "provided separately" (not embeddable). */
  external: string[];
  /** Embeddable files that failed to download/parse (kept out, reported). */
  skipped: string[];
};

export async function generateProductionDossier(
  taskListId: string
): Promise<DossierResult> {
  const data = await fetchExportData(taskListId);

  // Appendix plan — factory-visible files only (the dossier goes to the
  // factory; internal-only uploads stay out by design).
  const plan: AppendixItem[] = planAppendix(
    data.attachments.filter((a) => a.visible_factory)
  );

  // Render the dossier body. Dynamic imports keep the PDF/font stack out of
  // the page's server module graph (the F3 regression class).
  const [{ pdf }, { default: ProductionDossierPDF }, React] = await Promise.all([
    import("@react-pdf/renderer"),
    import("@/components/ProductionDossierPDF"),
    import("react"),
  ]);
  const mainBlob = await pdf(
    React.createElement(ProductionDossierPDF, { data, appendix: plan }) as any
  ).toBlob();

  // Download the embeddable appendix files. A failed download must never
  // sink the dossier — the file is reported as skipped instead.
  const supabase = createClient();
  const payloads: AppendixPayload[] = [];
  const skipped: string[] = [];
  for (const item of plan) {
    if (!item.label) continue;
    try {
      const { data: file, error } = await supabase.storage
        .from(ATTACHMENTS_BUCKET)
        .download(item.storage_path);
      if (error || !file) throw error ?? new Error("empty file");
      payloads.push({ ...item, bytes: await file.arrayBuffer() });
    } catch {
      skipped.push(item.file_name);
    }
  }

  const { mergeDossierWithAppendix } = await import("@/lib/pdf-merge");
  const merged = await mergeDossierWithAppendix(
    await mainBlob.arrayBuffer(),
    payloads
  );

  return {
    blob: new Blob([merged.bytes as BlobPart], { type: "application/pdf" }),
    fileName: buildPdfFilename({
      kind: "factory",
      number: data.number,
      client: data.client.company_name,
      affair: data.affair_name,
    }),
    data,
    external: plan.filter((p) => !p.label).map((p) => p.file_name),
    skipped: [...skipped, ...merged.skipped],
  };
}
