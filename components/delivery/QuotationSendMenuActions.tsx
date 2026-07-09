"use client";

import { useRouter } from "next/navigation";
import { openSendModal } from "./send-modal-store";
import { deliverableFromQuotation } from "@/lib/document-delivery";
import { pushToast } from "@/components/feedback/toast-store";
import type { QuotationPDFData } from "@/components/QuotationPDF";

/**
 * The document-actions rows for the quotation page "…" menu — grouped with the
 * other document actions per the owner's spec. Goes INSIDE <ContextMenu>; the
 * send modal opens via the global host (`openSendModal`), so it survives the
 * menu unmounting its children on click.
 */
export function QuotationSendMenuActions({
  pdfData,
  filename,
  quotationId,
  status,
  kindLabel,
  clientId = null,
  clientEmail = null,
  affairName = null,
  downloadUrl = null,
}: {
  pdfData: QuotationPDFData;
  filename: string;
  quotationId: string;
  status: string;
  kindLabel?: string;
  clientId?: string | null;
  clientEmail?: string | null;
  affairName?: string | null;
  downloadUrl?: string | null;
}) {
  const router = useRouter();
  const itemCls =
    "block w-full text-left px-3 py-2 text-xs text-neutral-700 hover:bg-neutral-50";

  return (
    <>
      <button
        type="button"
        className={itemCls}
        onClick={() =>
          openSendModal({
            documents: [
              deliverableFromQuotation(pdfData, filename, {
                quotationId,
                markSent: status === "draft",
                kindLabel,
              }),
            ],
            clientId,
            clientEmail,
            affairName,
            onAfterSend: () => router.refresh(),
          })
        }
      >
        📧 Send by email
      </button>
      {downloadUrl && (
        <button
          type="button"
          className={itemCls}
          onClick={() => {
            navigator.clipboard
              .writeText(downloadUrl)
              .then(() => pushToast("🔗 Download link copied"))
              .catch(() => pushToast("Could not copy the link", "error"));
          }}
        >
          Copy download link
        </button>
      )}
    </>
  );
}
