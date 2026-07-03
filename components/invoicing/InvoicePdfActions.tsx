"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { saveBlobAs } from "@/lib/saveBlob";
import { buildPdfFilename } from "@/lib/pdf-filename";
import type { InvoicePDFData } from "@/components/InvoicePDF";
import SendInvoiceModal from "./SendInvoiceModal";

/**
 * PDF actions for a single legal invoice: Preview (open in a new tab),
 * Download (native Save-As), and Send (opens the proper Send workflow —
 * preview + mark-sent + download-ready-to-attach). Send is hidden for
 * cancelled invoices. The invoiceId enables the Send modal to record the
 * send; when it's not passed (rare), Send is omitted.
 *
 * @react-pdf/renderer is browser-only and breaks SSR at module load (the F3
 * lesson) → the engine + InvoicePDF are imported lazily inside the handler.
 */

type Variant = "full" | "compact";

export default function InvoicePdfActions({
  data,
  clientName,
  affair,
  clientEmail,
  storageKey,
  invoiceId,
  status,
  variant = "full",
}: {
  data: InvoicePDFData;
  clientName: string | null;
  affair?: string | null;
  clientEmail?: string | null;
  /** Storage path used to cache the rendered PDF (e.g. `invoices/<id>.pdf`). */
  storageKey?: string | null;
  /** enables the Send workflow (records the send). */
  invoiceId?: string;
  /** invoice status — Send is hidden when cancelled. */
  status?: string;
  variant?: Variant;
}) {
  const [busy, setBusy] = useState<null | "preview" | "download">(null);
  const [error, setError] = useState<string | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const canSend = !!invoiceId && status !== "cancelled";

  async function render(): Promise<Blob> {
    const [{ pdf }, { default: InvoicePDF }] = await Promise.all([
      import("@react-pdf/renderer"),
      import("@/components/InvoicePDF"),
    ]);
    return pdf(<InvoicePDF data={data} />).toBlob();
  }

  function filename(): string {
    return buildPdfFilename({
      kind: "commercial_invoice",
      number: data.accounting_number,
      client: clientName,
      affair: affair ?? null,
    });
  }

  async function cacheCopy(blob: Blob) {
    if (!storageKey) return;
    try {
      const supabase = createClient();
      await supabase.storage
        .from("documents")
        .upload(storageKey, blob, { contentType: "application/pdf", upsert: true });
    } catch {
      /* caching is best-effort — never block the user action */
    }
  }

  async function onPreview() {
    setError(null);
    setBusy("preview");
    try {
      const blob = await render();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      void cacheCopy(blob);
    } catch (e: any) {
      setError(e?.message ?? "Preview failed");
    } finally {
      setBusy(null);
    }
  }

  async function onDownload() {
    setError(null);
    setBusy("download");
    try {
      const blob = await render();
      await saveBlobAs(blob, filename());
      void cacheCopy(blob);
    } catch (e: any) {
      setError(e?.message ?? "Download failed");
    } finally {
      setBusy(null);
    }
  }

  const cls =
    variant === "compact"
      ? "rounded-md px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-50"
      : "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50";

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        type="button"
        onClick={onPreview}
        disabled={busy !== null}
        className={`${cls} border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50`}
        title="Open a PDF preview in a new tab"
      >
        {busy === "preview" ? "…" : "👁 Preview"}
      </button>
      <button
        type="button"
        onClick={onDownload}
        disabled={busy !== null}
        className={`${cls} border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50`}
        title="Download the invoice PDF"
      >
        {busy === "download" ? "…" : "📄 PDF"}
      </button>
      {canSend && (
        <button
          type="button"
          onClick={() => setSendOpen(true)}
          disabled={busy !== null}
          className={`${cls} border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50`}
          title="Preview, mark as sent, and email the invoice to the customer"
        >
          ✉ Send
        </button>
      )}
      {error && <span className="text-[11px] text-rose-600">{error}</span>}

      {canSend && (
        <SendInvoiceModal
          open={sendOpen}
          onClose={() => setSendOpen(false)}
          invoiceId={invoiceId!}
          status={status ?? "draft"}
          data={data}
          clientName={clientName}
          clientEmail={clientEmail ?? null}
          affair={affair ?? null}
          storageKey={storageKey ?? null}
        />
      )}
    </div>
  );
}
