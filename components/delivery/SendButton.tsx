"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { openSendModal } from "./send-modal-store";
import {
  deliverableFromQuotation,
  deliverableFromProjectDocument,
  type DeliverableDocument,
} from "@/lib/document-delivery";
import type { QuotationPDFData } from "@/components/QuotationPDF";
import type { ProjectDocument } from "@/lib/project-documents";

/**
 * The ONE generic Send trigger for the Document Delivery System. Feed it any of:
 *   - `quotation` (pdfData) → builds a client-rendered quotation deliverable
 *     (memoized on the id/status so the PDF isn't re-rendered each render),
 *   - `projectDocuments` (repository rows) → stored-file deliverables,
 *   - `deliverables` (already built).
 * Opens the generic `SendDocumentsModal`. Same button everywhere; Phase 2 is
 * invisible (only the engine inside `deliver()` changes).
 */
export function SendButton({
  quotation,
  projectDocuments,
  deliverables,
  affairId = null,
  clientId = null,
  clientEmail = null,
  affairName = null,
  preselectedIds,
  label = "📧 Send",
  className,
  title = "Prepare an email with the document(s) attached",
}: {
  quotation?: {
    pdfData: QuotationPDFData;
    filename: string;
    quotationId: string;
    status: string;
    kindLabel?: string;
  };
  projectDocuments?: ProjectDocument[];
  deliverables?: DeliverableDocument[];
  affairId?: string | null;
  clientId?: string | null;
  clientEmail?: string | null;
  affairName?: string | null;
  preselectedIds?: string[];
  label?: string;
  className?: string;
  title?: string;
}) {
  const router = useRouter();

  const docs = useMemo<DeliverableDocument[]>(() => {
    if (quotation)
      return [
        deliverableFromQuotation(quotation.pdfData, quotation.filename, {
          quotationId: quotation.quotationId,
          markSent: quotation.status === "draft",
          kindLabel: quotation.kindLabel,
        }),
      ];
    if (projectDocuments)
      return projectDocuments
        .map(deliverableFromProjectDocument)
        .filter((d): d is DeliverableDocument => d !== null);
    return deliverables ?? [];
    // Key the quotation deliverable on stable primitives so the expensive PDF
    // render isn't recreated on every parent re-render (shared-blob cache).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotation?.quotationId, quotation?.status, projectDocuments, deliverables]);

  return (
    <button
      type="button"
      onClick={() =>
        openSendModal({
          documents: docs,
          preselectedIds,
          affairId,
          clientId,
          clientEmail,
          affairName,
          onAfterSend: () => router.refresh(),
        })
      }
      className={
        className ??
        "rounded bg-solux px-3 py-2 text-sm font-semibold text-white hover:bg-solux-dark"
      }
      title={title}
    >
      {label}
    </button>
  );
}
