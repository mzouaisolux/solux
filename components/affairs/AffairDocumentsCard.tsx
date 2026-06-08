"use client";

// =====================================================================
// Documents — OPERATIONAL documents for the deal: Task List, Production
// Order, and uploaded attachments (Packing List, Bill of Lading, Photos,
// Other). Quotations live in their own section. Calm grayscale, every
// action visible. "Assign existing quotation" is demoted to a disclosure.
// =====================================================================

import { useState } from "react";
import Link from "next/link";
import type { AffairFile } from "@/lib/affairs-prototype";
import { AttachmentUploader } from "@/components/attachments/AttachmentUploader";
import { AttachmentDeleteButton } from "@/components/attachments/AttachmentDeleteButton";
import { AttachmentReplaceButton } from "@/components/affairs/AttachmentReplaceButton";
import {
  AssignDocumentPanel,
  type AssignableDoc,
} from "@/components/affairs/AssignDocumentPanel";

const ACT = "text-[11px] font-medium text-neutral-500 hover:text-neutral-900";

function RecordRow({ label, href }: { label: string; href: string }) {
  return (
    <li className="flex items-center gap-2.5 py-2">
      <span className="text-[13px] leading-none" aria-hidden>
        📄
      </span>
      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-neutral-800">
        {label}
      </span>
      <Link href={href} className={ACT}>
        Open
      </Link>
    </li>
  );
}

export function AffairDocumentsCard({
  files,
  affairId,
  documentId,
  taskListId,
  productionOrderId,
  assignableDocs = [],
}: {
  files: AffairFile[];
  affairId: string;
  documentId: string | null;
  taskListId: string | null;
  productionOrderId: string | null;
  assignableDocs?: AssignableDoc[];
}) {
  const [adding, setAdding] = useState(false);
  const attachments = files.filter((f) => f.kind === "attachment");
  const count =
    attachments.length + (taskListId ? 1 : 0) + (productionOrderId ? 1 : 0);

  return (
    <section>
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
          Documents
          <span className="ml-1.5 font-normal text-neutral-400">{count}</span>
        </h3>
        {documentId && (
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="text-[11px] font-medium text-neutral-600 hover:text-neutral-900"
          >
            {adding ? "Close" : "+ Add file"}
          </button>
        )}
      </div>

      {count === 0 ? (
        <p className="mt-2 text-[12px] text-neutral-400">
          No operational documents yet — task list, production order, packing list,
          BL and photos appear here as the deal progresses.
        </p>
      ) : (
        <ul className="mt-1 divide-y divide-neutral-100 border-t border-neutral-100">
          {taskListId && (
            <RecordRow label="Task List" href={`/task-lists/${taskListId}`} />
          )}
          {productionOrderId && (
            <RecordRow
              label="Production Order"
              href={`/production/orders/${productionOrderId}`}
            />
          )}
          {attachments.map((f) => (
            <li key={f.key} className="flex items-center gap-2.5 py-2">
              <span className="text-[13px] leading-none" aria-hidden>
                📄
              </span>
              <a
                href={f.href}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-neutral-800 hover:text-neutral-950 hover:underline"
                title={f.name}
              >
                {f.name}
              </a>
              {f.sizeLabel && (
                <span className="text-[11px] text-neutral-400">{f.sizeLabel}</span>
              )}
              <div className="flex shrink-0 items-center gap-2.5">
                <a href={f.href} target="_blank" rel="noreferrer" className={ACT}>
                  Open
                </a>
                {f.downloadHref && (
                  <a href={f.downloadHref} download={f.name} className={ACT}>
                    Download
                  </a>
                )}
                {f.attachmentId && f.documentId && (
                  <AttachmentReplaceButton
                    attachmentId={f.attachmentId}
                    documentId={f.documentId}
                    attachmentType={f.attachmentType}
                  />
                )}
                {f.attachmentId && f.documentId && (
                  <AttachmentDeleteButton
                    id={f.attachmentId}
                    documentId={f.documentId}
                    fileName={f.name}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {adding && documentId && (
        <div className="mt-2">
          <AttachmentUploader documentId={documentId} affairId={documentId} />
        </div>
      )}

      {/* Assign existing quotation — minimized (disclosure). */}
      {assignableDocs.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] font-medium text-neutral-400 hover:text-neutral-600">
            Assign existing quotation
          </summary>
          <div className="mt-1.5">
            <AssignDocumentPanel affairId={affairId} docs={assignableDocs} />
          </div>
        </details>
      )}
    </section>
  );
}
