// =====================================================================
// Document Delivery System — the generic engine (owner 2026-07-08).
//
// ONE abstraction every document type maps to (`DeliverableDocument`) and
// ONE send engine (`deliver`). No per-type modals. Because
// lib/project-documents-server.loadProjectRepositories() already normalises
// EVERY document (quotation, study, drawing, invoice, packing list, upload…)
// into a `ProjectDocument` with a `downloadHref`, any new type is deliverable
// with zero new code — it just has to exist in the affair.
//
// PHASE 1 (now): mailto — `deliver()` renders/fetches each file, downloads it,
// drops it in the Document Tray, and opens the mail client pre-filled. The
// browser can't attach automatically; the tray makes attaching one step.
// PHASE 2 (later): swap the body of `deliver()` for a server action of the
// SAME signature (upload + real send → "✅ Email sent"). The modal, the tray
// and every call site stay identical.
// =====================================================================

import { saveBlobAs } from "@/lib/saveBlob";
import { createClient } from "@/lib/supabase/client";
import { updateDocumentStatus } from "@/app/(app)/documents/[id]/actions";
import { pushToTray } from "@/components/delivery/document-tray-store";
import type { QuotationPDFData } from "@/components/QuotationPDF";
import type { ProjectDocument } from "@/lib/project-documents";

export type DeliverableDocument = {
  /** Stable key (ProjectDocument.key, or `quotation:<id>`). */
  id: string;
  /** Filename used for download + shown in the tray. */
  name: string;
  /** Human kind, e.g. "Quotation" | "Energy Study" | "Invoice". */
  kindLabel: string;
  /** Produce the file bytes: client-render a PDF OR fetch a stored file. */
  resolve: () => Promise<Blob>;
  /** Stored URL — opened directly if `resolve()` rejects (CORS etc.). */
  fallbackHref?: string;
  /** Per-document side effects after it's prepared (e.g. cache + mark sent). */
  onDelivered?: () => Promise<void>;
};

/** Cache a blob-producing fn so preview + send + onDelivered share ONE result
 *  (and so React 18 StrictMode's double-invoked effect never renders twice). */
function memoBlob(fn: () => Promise<Blob>): () => Promise<Blob> {
  let p: Promise<Blob> | null = null;
  return () => (p ??= fn());
}

// Serialize ALL @react-pdf renders. Two concurrent `pdf(...).toBlob()` calls
// race the library's global font/Config singleton ("Expected null or instance
// of Config, got an instance of Config"). A multi-document send would trigger
// exactly that, so every render goes through this one-at-a-time queue.
let renderChain: Promise<unknown> = Promise.resolve();
function enqueueRender<T>(fn: () => Promise<T>): Promise<T> {
  const run = renderChain.then(fn, fn);
  renderChain = run.catch(() => {});
  return run;
}

/** Any repository document that has a downloadable file. `null` when there's
 *  nothing to attach (e.g. a quotation whose PDF hasn't been generated). */
export function deliverableFromProjectDocument(
  d: ProjectDocument
): DeliverableDocument | null {
  if (!d.downloadHref) return null;
  const href = d.downloadHref;
  return {
    id: d.key,
    name: d.name,
    kindLabel: d.kindLabel,
    fallbackHref: href,
    resolve: memoBlob(async () => {
      const res = await fetch(href);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.blob();
    }),
  };
}

/** The quotation/proforma, rendered client-side from the builder data — same
 *  proven path as the old SendQuotationButton (render → cache → mark sent). */
export function deliverableFromQuotation(
  pdfData: QuotationPDFData,
  filename: string,
  opts: { quotationId: string; kindLabel?: string; markSent?: boolean }
): DeliverableDocument {
  const resolve = memoBlob(() =>
    enqueueRender(async () => {
      const [{ pdf }, { default: QuotationPDF }, { createElement }] =
        await Promise.all([
          import("@react-pdf/renderer"),
          import("@/components/QuotationPDF"),
          import("react"),
        ]);
      // `pdf()` wants a ReactElement<DocumentProps>; createElement's generic
      // element doesn't unify with it (the JSX form does, but this is a .ts
      // file). QuotationPDF IS a @react-pdf Document, so the cast is safe.
      const element = createElement(QuotationPDF, { data: pdfData }) as any;
      return pdf(element).toBlob();
    })
  );
  return {
    id: `quotation:${opts.quotationId}`,
    name: filename,
    kindLabel: opts.kindLabel ?? "Quotation",
    resolve,
    onDelivered: async () => {
      // Cache the rendered PDF so the doc page can re-serve it (best-effort).
      try {
        const blob = await resolve();
        await createClient()
          .storage.from("documents")
          .upload(`${opts.quotationId}.pdf`, blob, {
            contentType: "application/pdf",
            upsert: true,
          });
      } catch {
        /* non-blocking cache */
      }
      // A draft quote emailed to the customer IS now Sent (guarded server-side
      // so it never regresses negotiating/won/lost).
      if (opts.markSent) {
        try {
          const fd = new FormData();
          fd.set("id", opts.quotationId);
          fd.set("status", "sent");
          await updateDocumentStatus(fd);
        } catch {
          /* already sent / not permitted — ignore */
        }
      }
    },
  };
}

/** Download a blob via a plain anchor (no picker). The tray owns the object
 *  URL and revokes it later, so this does NOT revoke. */
function anchorDownload(url: string, name: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * THE single send engine. Phase 1: prepare each selected document (render or
 * fetch → download → tray), then open the mail client pre-filled. Phase 2 will
 * replace this function's body with a server action of the same signature.
 */
export async function deliver(opts: {
  documents: DeliverableDocument[];
  to: string;
  subject: string;
  body: string;
  onAfterSend?: () => void;
}): Promise<{ prepared: number }> {
  const { documents, to, subject, body, onAfterSend } = opts;
  const single = documents.length === 1;
  let prepared = 0;
  for (const doc of documents) {
    let blob: Blob;
    try {
      blob = await doc.resolve();
    } catch {
      // Couldn't produce the bytes (e.g. a cross-origin signed URL blocked
      // fetch) → open the file directly so the user still gets it; skip tray.
      if (doc.fallbackHref) window.open(doc.fallbackHref, "_blank", "noopener");
      continue;
    }
    const url = URL.createObjectURL(blob);
    // One file → native Save-As picker (nice). Many → plain anchor downloads
    // (the picker needs live user activation, lost after the first await).
    if (single) {
      try {
        await saveBlobAs(blob, doc.name);
      } catch {
        anchorDownload(url, doc.name);
      }
    } else {
      anchorDownload(url, doc.name);
    }
    pushToTray({ name: doc.name, kindLabel: doc.kindLabel, blobUrl: url });
    try {
      await doc.onDelivered?.();
    } catch {
      /* per-doc side effect best-effort */
    }
    prepared++;
  }
  window.location.href =
    `mailto:${encodeURIComponent(to)}` +
    `?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(body)}`;
  onAfterSend?.();
  return { prepared };
}
