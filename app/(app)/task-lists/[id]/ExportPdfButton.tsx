"use client";

import { useState } from "react";
import { fetchExportData } from "./exportData";
import { saveBlobAs } from "@/lib/saveBlob";
import { buildPdfFilename } from "@/lib/pdf-filename";

/**
 * Production-ready Factory Task List PDF export. Always uses the final
 * factory-ready view: sales values + factory mapping + per-line overrides, with
 * explicit MISSING / OVERRIDDEN flags for the factory. Generated on demand —
 * never persisted to storage.
 *
 * F3-safe: `@react-pdf/renderer` and the heavy `FactoryPDF` component are
 * imported DYNAMICALLY inside the click handler — never at module load — so the
 * server-rendered task-list page never pulls a browser-only PDF library into its
 * graph (the F3 regression class). This also loads the PDF/font stack fresh on
 * click rather than keeping it in the page's static module graph.
 *
 * Feedback: idle → "Generating…" (disabled, no double-click) → "✓ Downloaded"
 * (~2 s) → back to idle; inline error on failure.
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
  const [status, setStatus] = useState<"idle" | "working" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (status === "working") return; // block double-clicks while generating
    setError(null);
    setStatus("working");
    try {
      const [{ pdf }, { default: FactoryPDF }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("@/components/FactoryPDF"),
      ]);
      const data = await fetchExportData(taskListId);
      const blob = await pdf(<FactoryPDF data={data} />).toBlob();
      await saveBlobAs(
        blob,
        buildPdfFilename({ kind: "factory", number: data.number, client, affair })
      );
      setStatus("done");
      setTimeout(() => setStatus("idle"), 2000);
    } catch (e: any) {
      setError(e?.message ?? "Failed to generate PDF");
      setStatus("idle");
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleClick}
        disabled={status === "working"}
        className="inline-flex items-center justify-center gap-1.5 rounded-md bg-solux px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-solux-dark disabled:opacity-60"
        title="Generate the Factory Task List PDF (mappings + overrides) to send to the factory"
      >
        {status === "working"
          ? "Generating…"
          : status === "done"
          ? "✓ Downloaded"
          : "📄 Factory PDF"}
      </button>
      {error && <p className="max-w-[220px] text-right text-xs text-red-600">{error}</p>}
    </div>
  );
}
