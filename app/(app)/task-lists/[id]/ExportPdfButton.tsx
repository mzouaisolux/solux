"use client";

import { useState } from "react";
import { pdf } from "@react-pdf/renderer";
import FactoryPDF from "@/components/FactoryPDF";
import { fetchExportData } from "./exportData";

/**
 * Production-ready PDF export. Always uses the final factory-ready view:
 * sales values + factory mapping + per-line overrides, with explicit
 * MISSING / OVERRIDDEN flags for the factory. Generated on demand — never
 * persisted to storage.
 */
export default function ExportPdfButton({
  taskListId,
}: {
  taskListId: string;
}) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    setWorking(true);
    try {
      const data = await fetchExportData(taskListId);
      const blob = await pdf(<FactoryPDF data={data} />).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${data.number}-FACTORY.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
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
