"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { pdf } from "@react-pdf/renderer";
import QuotationPDF, { type QuotationPDFData } from "@/components/QuotationPDF";
import { createClient } from "@/lib/supabase/client";
import { savePdfPath } from "./actions";

export default function GeneratePdfButton({
  documentId,
  data,
  label = "Generate PDF",
}: {
  documentId: string;
  data: QuotationPDFData;
  label?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    setWorking(true);
    try {
      const blob = await pdf(<QuotationPDF data={data} />).toBlob();

      const supabase = createClient();
      const path = `${documentId}.pdf`;
      const { error: upErr } = await supabase.storage
        .from("documents")
        .upload(path, blob, {
          contentType: "application/pdf",
          upsert: true,
        });
      if (upErr) throw new Error(upErr.message);

      const filename = `${data.number ?? documentId}.pdf`;
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();

      window.open(url, "_blank", "noopener,noreferrer");

      setTimeout(() => URL.revokeObjectURL(url), 60_000);

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
