"use client";

/**
 * Shipping Documents — the order's EXPORT DOCUMENTATION PACKAGE (m115).
 *
 * One checklist per sales order answering "is the shipment paperwork
 * ready?": Commercial Invoice, Packing List, B/L / AWB, COO, inspection
 * certificates, LC package… Requirements are DERIVED (lib/shipping-docs)
 * from the payment mode + the client's BL profile — nothing stored.
 *
 * Per row: ✓/○ status · Generate (CI — the document Solux authors) ·
 * View · Upload / Upload signed version. Files live in the existing
 * m099 order-documents hub (category "shipping", kind = canonical key),
 * so versioning, audit trail and the Documents tab all keep working
 * unchanged — uploading over an existing kind creates a new VERSION of
 * the same logical document (that IS "upload signed version").
 *
 * The Commercial Invoice number (CI-XXXX) is minted server-side ONCE
 * (assignCommercialInvoiceNumber); regeneration reuses it and versions
 * the same document.
 */

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { pdf } from "@react-pdf/renderer";
import { createClient as createBrowserSupabase } from "@/lib/supabase/client";
import { toast } from "@/components/feedback/toast-store";
import {
  ATTACHMENTS_BUCKET,
  ATTACHMENT_MAX_BYTES,
  formatFileSize,
} from "@/lib/attachments";
import CommercialInvoicePDF, {
  type CommercialInvoicePDFData,
} from "@/components/CommercialInvoicePDF";
import {
  recordOrderDocument,
  assignCommercialInvoiceNumber,
} from "@/app/(app)/production/orders/[id]/document-actions";
import type { ShippingDocRequirement } from "@/lib/shipping-docs";
import { buildPdfFilename } from "@/lib/pdf-filename";

export type ShippingDocPresent = {
  groupId: string;
  name: string;
  version: number;
  signedUrl: string | null;
};

const LEVEL_LABEL: Record<ShippingDocRequirement["level"], string> = {
  mandatory: "Required",
  required: "Required",
  optional: "Optional",
};

export function ShippingDocumentsCard({
  orderId,
  canGenerate,
  ciNumber,
  requirements,
  docs,
  ciData,
  clientName = null,
  affairName = null,
}: {
  orderId: string;
  /** UI gate — the server action enforces the real capability. */
  canGenerate: boolean;
  /** Already-minted CI reference (CI-XXXX), if any. */
  ciNumber: string | null;
  requirements: ShippingDocRequirement[];
  /** Best (current) document per kind, from the m099 hub. */
  docs: Record<string, ShippingDocPresent | undefined>;
  /** Server-assembled CI payload; null when the order has no priced
   *  proforma lines yet (Generate is then disabled with a hint). */
  ciData: Omit<CommercialInvoicePDFData, "ci_number" | "date"> | null;
  /** Client + affair names — for the canonical CI filename. */
  clientName?: string | null;
  affairName?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [generating, setGenerating] = useState(false);
  const [uploadKind, setUploadKind] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const readyCount = requirements.filter((r) => docs[r.kind]).length;

  async function uploadToHub(args: {
    blobOrFile: Blob;
    fileName: string;
    mime: string;
    kind: string;
  }) {
    const supabase = createBrowserSupabase();
    const safe = args.fileName.replace(/[^\w.\-]+/g, "_");
    const path = `orders/${orderId}/${Date.now()}-${safe}`;
    const { error: upErr } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .upload(path, args.blobOrFile, { contentType: args.mime, upsert: false });
    if (upErr) throw new Error(upErr.message);

    const fd = new FormData();
    fd.set("order_id", orderId);
    fd.set("storage_path", path);
    fd.set("file_name", args.fileName);
    fd.set("file_size", String(args.blobOrFile.size));
    fd.set("mime_type", args.mime);
    fd.set("category", "shipping");
    fd.set("kind", args.kind);
    const existing = docs[args.kind];
    if (existing) fd.set("replace_group_id", existing.groupId);
    await recordOrderDocument(fd);
  }

  function generateCommercialInvoice() {
    if (!ciData) return;
    setGenerating(true);
    startTransition(async () => {
      try {
        // 1. Mint (or reuse) the CI number — server-side, idempotent.
        const number = ciNumber ?? (await assignCommercialInvoiceNumber(orderId));
        // 2. Render the PDF in the browser (same pipeline as quotations).
        const data: CommercialInvoicePDFData = {
          ...ciData,
          ci_number: number,
          date: new Date().toISOString().slice(0, 10),
        };
        const blob = await pdf(<CommercialInvoicePDF data={data} />).toBlob();
        // 3. Preview immediately…
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank", "noopener,noreferrer");
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        // 4. …and file it in the shipping package (new version if it exists).
        await uploadToHub({
          blobOrFile: blob,
          fileName: buildPdfFilename({
            kind: "commercial_invoice",
            number,
            client: clientName,
            affair: affairName,
          }),
          mime: "application/pdf",
          kind: "commercial_invoice",
        });
        toast.success(`✓ ${number} generated and filed under Shipping documents`);
        router.refresh();
      } catch (e: any) {
        toast.error(e?.message ?? "Failed to generate the Commercial Invoice.");
      } finally {
        setGenerating(false);
      }
    });
  }

  function onPickedFile(files: FileList | null) {
    const kind = uploadKind;
    setUploadKind(null);
    if (!files?.length || !kind) return;
    const file = files[0];
    if (file.size > ATTACHMENT_MAX_BYTES) {
      toast.error(
        `"${file.name}" is too large (max ${formatFileSize(ATTACHMENT_MAX_BYTES)}).`
      );
      return;
    }
    startTransition(async () => {
      try {
        await uploadToHub({
          blobOrFile: file,
          fileName: file.name,
          mime: file.type || "application/octet-stream",
          kind,
        });
        toast.success(
          docs[kind] ? "✓ New signed version uploaded" : "✓ Document uploaded"
        );
        router.refresh();
      } catch (e: any) {
        toast.error(e?.message ?? "Upload failed.");
      } finally {
        if (fileRef.current) fileRef.current.value = "";
      }
    });
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="eyebrow">Shipping documents</div>
          <p className="text-xs text-neutral-500 mt-0.5 max-w-xl">
            The export documentation package for this shipment — customs,
            import, freight forwarder and bank/LC paperwork. Derived from the
            payment terms and the client&apos;s BL profile.
          </p>
        </div>
        <span className="text-[11px] font-semibold text-neutral-600 tabular-nums">
          {readyCount}/{requirements.length} ready
          {ciNumber ? ` · ${ciNumber}` : ""}
        </span>
      </div>

      <input
        ref={fileRef}
        type="file"
        className="hidden"
        onChange={(e) => onPickedFile(e.target.files)}
      />

      <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
        {requirements.map((req) => {
          const present = docs[req.kind];
          const isCI = req.kind === "commercial_invoice";
          return (
            <li
              key={req.kind}
              className="flex items-center justify-between gap-3 px-3 py-2"
            >
              <div className="min-w-0 flex items-start gap-2.5">
                <span
                  aria-hidden
                  className={`mt-0.5 text-sm font-bold ${
                    present ? "text-emerald-600" : "text-neutral-300"
                  }`}
                >
                  {present ? "✓" : "○"}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-neutral-900">
                      {req.label}
                    </span>
                    <span
                      className={`text-[10px] uppercase tracking-widerx font-semibold ${
                        req.level === "optional"
                          ? "text-neutral-400"
                          : "text-neutral-600"
                      }`}
                    >
                      {LEVEL_LABEL[req.level]}
                    </span>
                  </div>
                  <div className="text-[11px] text-neutral-500 truncate">
                    {present
                      ? `${present.name} · v${present.version}`
                      : req.hint}
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                {isCI && canGenerate && (
                  <button
                    type="button"
                    disabled={pending || generating || !ciData}
                    title={
                      !ciData
                        ? "No proforma lines found for this order yet."
                        : present
                        ? "Regenerate — creates a new version under the same CI number."
                        : "Generate the Commercial Invoice PDF and file it here."
                    }
                    onClick={generateCommercialInvoice}
                    className="rounded border border-neutral-200 bg-neutral-900 px-2 py-1 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
                  >
                    {generating
                      ? "Generating…"
                      : present
                      ? "Regenerate"
                      : "Generate"}
                  </button>
                )}
                {present?.signedUrl && (
                  <a
                    href={present.signedUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded border border-neutral-200 px-2 py-1 text-xs hover:bg-neutral-50"
                  >
                    View
                  </a>
                )}
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setUploadKind(req.kind);
                    fileRef.current?.click();
                  }}
                  className="rounded border border-neutral-200 px-2 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50"
                >
                  {present ? "Upload signed" : "Upload"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="text-[11px] text-neutral-400">
        Files land in the order&apos;s Documents hub below (category
        “Shipping”) with full version history — uploading over an existing
        document adds a new version, it never overwrites.
      </p>
    </div>
  );
}
