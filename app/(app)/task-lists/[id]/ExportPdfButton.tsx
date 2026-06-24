"use client";

import { useState } from "react";
import { pdf } from "@react-pdf/renderer";
import FactoryPDF from "@/components/FactoryPDF";
import { fetchExportData } from "./exportData";
import { saveBlobAs } from "@/lib/saveBlob";
import { buildPdfFilename } from "@/lib/pdf-filename";

/**
 * Production-ready PDF export. Always uses the final factory-ready view:
 * sales values + factory mapping + per-line overrides, with explicit
 * MISSING / OVERRIDDEN flags for the factory. Generated on demand — never
 * persisted to storage.
 */
export default function ExportPdfButton({
  taskListId,
  client = null,
  affair = null,
}: {
  taskListId: string;
  /** Client + affair names — for the canonical FACTORY download filename. */
  client?: string | null;
  affair?: string | null;
}) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    setWorking(true);
    try {
      const data = await fetchExportData(taskListId);
      const blob = await pdf(<FactoryPDF data={data} />).toBlob();
      await saveBlobAs(
        blob,
        buildPdfFilename({ kind: "factory", number: data.number, client, affair })
      );
    } catch (e: any) {
      setError(e?.message ?? "Failed to generate PDF");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleClick}
        disabled={working}
        className="inline-flex items-center justify-center gap-1.5 rounded-md bg-solux px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-solux-dark disabled:opacity-50"
        title="Generate the factory task list PDF with mappings + overrides"
      >
        {working ? "Generating…" : "Export PDF"}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
