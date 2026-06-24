"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { type QuotationPDFData } from "@/components/QuotationPDF";
import { createClient } from "@/lib/supabase/client";
import { savePdfPath } from "./actions";
import { saveBlobAs } from "@/lib/saveBlob";
import { buildPdfFilename } from "@/lib/pdf-filename";

export default function GeneratePdfButton({
  documentId,
  data,
  label = "Generate PDF",
  affair = null,
  version = null,
}: {
  documentId: string;
  data: QuotationPDFData;
  label?: string;
  /** Affair (project) name — for the canonical download filename. */
  affair?: string | null;
  /** Document version — adds a _V{n} suffix when > 1. */
  version?: number | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    setWorking(true);
    try {
      // F3 fix: @react-pdf/renderer is browser-only and breaks SSR if imported
      // at module load (it made every /documents/[id] render throw "Element type
      // is invalid" → recoverable error → HTTP 500 while the page still rendered).
      // Load the PDF engine + document component lazily, on click only.
      const [{ pdf }, { default: QuotationPDF }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("@/components/QuotationPDF"),
      ]);
      const blob = await pdf(<QuotationPDF data={data} />).toBlob();

      // Let the user choose folder + filename via the native Save-As dialog
      // (Chromium); falls back to the Downloads folder elsewhere. Called right
      // after toBlob so the user gesture is still active for the picker.
      const filename = buildPdfFilename({
        kind: data.type,
        number: data.number,
        client: data.client?.company_name ?? null,
        affair,
        version,
      });
      await saveBlobAs(blob, filename);

      // Keep a stored copy so the doc page can re-serve the PDF later.
      const supabase = createClient();
      const path = `${documentId}.pdf`;
      const { error: upErr } = await supabase.storage
        .from("documents")
        .upload(path, blob, {
          contentType: "application/pdf",
          upsert: true,
        });
      if (upErr) throw new Error(upErr.message);

      startTransition(async () => {
        await savePdfPath(documentId, path);
        router.refresh();
      });
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
        disabled={working || isPending}
        className="rounded bg-solux px-3 py-2 text-white font-medium hover:bg-solux-dark disabled:opacity-50"
      >
        {working || isPending ? "Generating…" : label}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
