"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { saveBlobAs } from "@/lib/saveBlob";
import { buildPdfFilename } from "@/lib/pdf-filename";
import { markInvoiceSent } from "@/app/(app)/invoicing/actions";
import { formatInvoiceAmount } from "@/lib/invoicing";
import type { InvoicePDFData } from "@/components/InvoicePDF";

/**
 * A proper "Send invoice" flow (audit P1). One modal that:
 *   1. renders + PREVIEWS the exact invoice PDF inline (no guessing which
 *      file),
 *   2. lets the user confirm the recipient / subject / message,
 *   3. on send: MARKS the invoice as sent (+ stores the date, server action),
 *      DOWNLOADS the correct PDF ready to attach, and opens the mail client
 *      pre-addressed. (No server mailer exists yet — the PDF is attached
 *      manually; the modal makes that one obvious step, and the send is
 *      recorded either way. A `sendInvoiceEmail` server action can slot in
 *      later without changing this UI.)
 *
 * Cancelled invoices can never be sent — the caller hides the trigger, and
 * this component refuses to open for a cancelled status as a second guard.
 */

export default function SendInvoiceModal({
  open,
  onClose,
  invoiceId,
  status,
  data,
  clientName,
  clientEmail,
  affair,
  storageKey,
}: {
  open: boolean;
  onClose: () => void;
  invoiceId: string;
  status: string;
  data: InvoicePDFData;
  clientName: string | null;
  clientEmail: string | null;
  affair?: string | null;
  storageKey?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blobRef = useRef<Blob | null>(null);

  const [to, setTo] = useState(clientEmail ?? "");
  const [subject, setSubject] = useState(
    `Invoice ${data.accounting_number} — ${data.type_title ?? data.type_label ?? ""}`.trim()
  );
  const amountStr = formatInvoiceAmount(Number(data.amount) || 0, data.currency ?? null);
  const [body, setBody] = useState(
    `Dear ${clientName ?? "customer"},\n\n` +
      `Please find attached invoice ${data.accounting_number} for ${amountStr}.\n\n` +
      `Best regards,\nSOLUX Technology`
  );

  const isCancelled = status === "cancelled";

  // Render the PDF once when the modal opens, for the inline preview.
  useEffect(() => {
    if (!open || isCancelled) return;
    let revoked = false;
    setError(null);
    setRendering(true);
    (async () => {
      try {
        const [{ pdf }, { default: InvoicePDF }] = await Promise.all([
          import("@react-pdf/renderer"),
          import("@/components/InvoicePDF"),
        ]);
        const blob = await pdf(<InvoicePDF data={data} />).toBlob();
        if (revoked) return;
        blobRef.current = blob;
        setPreviewUrl(URL.createObjectURL(blob));
      } catch (e: any) {
        if (!revoked) setError(e?.message ?? "Could not render the PDF preview");
      } finally {
        if (!revoked) setRendering(false);
      }
    })();
    return () => {
      revoked = true;
      setPreviewUrl((u) => {
        if (u) URL.revokeObjectURL(u);
        return null;
      });
      blobRef.current = null;
    };
  }, [open, isCancelled, data]);

  if (!open) return null;

  const filename = buildPdfFilename({
    kind: "commercial_invoice",
    number: data.accounting_number,
    client: clientName,
    affair: affair ?? null,
  });

  async function ensureBlob(): Promise<Blob> {
    if (blobRef.current) return blobRef.current;
    const [{ pdf }, { default: InvoicePDF }] = await Promise.all([
      import("@react-pdf/renderer"),
      import("@/components/InvoicePDF"),
    ]);
    const blob = await pdf(<InvoicePDF data={data} />).toBlob();
    blobRef.current = blob;
    return blob;
  }

  function send() {
    if (isCancelled) return;
    startTransition(async () => {
      try {
        const blob = await ensureBlob();
        // Cache a copy (best-effort) so the PDF is retrievable server-side.
        if (storageKey) {
          try {
            await createClient()
              .storage.from("documents")
              .upload(storageKey, blob, { contentType: "application/pdf", upsert: true });
          } catch {
            /* non-blocking */
          }
        }
        // Download the exact PDF so it's ready to attach.
        await saveBlobAs(blob, filename);
        // Record the send (status → sent, sent_at stamped). Draft-only guard
        // is inside the action; ignore its "already sent" error so re-sends
        // still open the mail client.
        try {
          await markInvoiceSent(invoiceId);
        } catch {
          /* already sent — fine */
        }
        // Open the mail client, pre-addressed.
        const mailto =
          `mailto:${encodeURIComponent(to)}` +
          `?subject=${encodeURIComponent(subject)}` +
          `&body=${encodeURIComponent(body)}`;
        window.location.href = mailto;
        onClose();
        router.refresh();
      } catch (e: any) {
        setError(e?.message ?? "Send failed");
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/50 p-4"
      onClick={() => !pending && onClose()}
    >
      <div
        className="flex w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left — live PDF preview */}
        <div className="hidden w-1/2 border-r border-neutral-200 bg-neutral-100 md:block">
          {isCancelled ? (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-neutral-500">
              This invoice is cancelled and cannot be sent.
            </div>
          ) : rendering || !previewUrl ? (
            <div className="flex h-full items-center justify-center text-sm text-neutral-400">
              Rendering preview…
            </div>
          ) : (
            <iframe
              title="Invoice preview"
              src={`${previewUrl}#toolbar=0&navpanes=0`}
              className="h-full w-full"
            />
          )}
        </div>

        {/* Right — recipient + message + send */}
        <div className="flex w-full flex-col md:w-1/2">
          <div className="border-b border-neutral-100 px-5 py-4">
            <div className="eyebrow mb-1">Send invoice</div>
            <div className="text-sm font-semibold text-neutral-900">
              {data.type_title ?? data.type_label}{" "}
              <span className="font-mono">{data.accounting_number}</span>
            </div>
            <div className="text-xs text-neutral-500">
              {data.commercial_number} · {amountStr}
            </div>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
            <label className="block text-xs font-medium text-neutral-600">
              To
              <input
                type="email"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="customer@company.com"
                className="mt-1 w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm"
              />
            </label>
            <label className="block text-xs font-medium text-neutral-600">
              Subject
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="mt-1 w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm"
              />
            </label>
            <label className="block text-xs font-medium text-neutral-600">
              Message
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={6}
                className="mt-1 w-full resize-none rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm"
              />
            </label>
            <p className="rounded-md bg-neutral-50 px-3 py-2 text-[11px] text-neutral-500">
              On send, this invoice is marked <b>Sent</b> (with today&apos;s date), the
              PDF <span className="font-mono">{filename}</span> is downloaded ready to
              attach, and your email client opens pre-addressed.
            </p>
            {error && <p className="text-xs text-rose-600">{error}</p>}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-neutral-100 px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="rounded-md border border-neutral-300 bg-white px-3.5 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={send}
              disabled={pending || isCancelled || !to}
              className="rounded-md bg-solux px-3.5 py-2 text-sm font-semibold text-white hover:bg-solux-dark disabled:opacity-50"
            >
              {pending ? "Sending…" : "✉ Mark sent & open email"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
