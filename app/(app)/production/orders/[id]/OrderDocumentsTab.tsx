"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient as createBrowserSupabase } from "@/lib/supabase/client";
import { recordOrderDocument, archiveOrderDocument, restoreOrderDocument } from "./document-actions";
import { toast } from "@/components/feedback/toast-store";
import { ATTACHMENTS_BUCKET, ATTACHMENT_MAX_BYTES, formatFileSize } from "@/lib/attachments";
import {
  ORDER_DOC_CATEGORIES,
  ORDER_DOC_CATEGORY_LABEL,
  type OrderDocumentCategory,
} from "@/lib/types";

export type DocVersionView = {
  id: string;
  version: number;
  name: string;
  size: number | null;
  mime: string | null;
  createdAt: string;
  byLabel: string | null;
  signedUrl: string | null;
};
export type LogicalDocView = {
  groupId: string;
  category: string;
  current: DocVersionView;
  versions: DocVersionView[]; // all, newest first
};
export type AuditView = {
  id: string;
  action: string;
  fileName: string | null;
  byLabel: string | null;
  createdAt: string;
};

const ACTION_LABEL: Record<string, string> = {
  upload: "uploaded",
  replace: "replaced",
  archive: "archived",
  restore: "restored",
};

export default function OrderDocumentsTab({
  orderId,
  active,
  archived,
  audit,
}: {
  orderId: string;
  active: LogicalDocView[];
  archived: LogicalDocView[];
  audit: AuditView[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [progress, setProgress] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [category, setCategory] = useState<OrderDocumentCategory>("other");
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [replaceGroup, setReplaceGroup] = useState<string | null>(null);

  const dt = (s: string) => {
    try {
      return new Date(s).toLocaleDateString();
    } catch {
      return s;
    }
  };

  /** Upload a list of files. When `replaceGroupId` is set, each becomes a new
   *  version of that logical document; otherwise each is a brand-new document. */
  function uploadFiles(fileList: FileList | File[], replaceGroupId?: string) {
    const files = Array.from(fileList);
    if (!files.length) return;
    const tooBig = files.find((f) => f.size > ATTACHMENT_MAX_BYTES);
    if (tooBig) {
      toast.error(`"${tooBig.name}" is too large (max ${formatFileSize(ATTACHMENT_MAX_BYTES)}).`);
      return;
    }
    startTransition(async () => {
      try {
        const supabase = createBrowserSupabase();
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          setProgress(`Uploading ${i + 1}/${files.length}…`);
          const safeName = file.name.replace(/[^\w.\-]+/g, "_");
          const path = `orders/${orderId}/${Date.now()}-${i}-${safeName}`;
          const { error: upErr } = await supabase.storage
            .from(ATTACHMENTS_BUCKET)
            .upload(path, file, {
              contentType: file.type || "application/octet-stream",
              upsert: false,
            });
          if (upErr) throw new Error(upErr.message);
          const fd = new FormData();
          fd.set("order_id", orderId);
          fd.set("storage_path", path);
          fd.set("file_name", file.name);
          fd.set("file_size", String(file.size));
          fd.set("mime_type", file.type || "");
          fd.set("category", category);
          if (replaceGroupId) fd.set("replace_group_id", replaceGroupId);
          await recordOrderDocument(fd);
        }
        setProgress(null);
        if (inputRef.current) inputRef.current.value = "";
        if (replaceInputRef.current) replaceInputRef.current.value = "";
        toast.success(
          replaceGroupId
            ? "✓ New version uploaded"
            : `✓ ${files.length} document${files.length === 1 ? "" : "s"} uploaded`
        );
        router.refresh();
      } catch (e: any) {
        setProgress(null);
        toast.error(e?.message ?? "Upload failed.");
      }
    });
  }

  function runAction(
    fn: (fd: FormData) => Promise<void>,
    groupId: string,
    fileName: string,
    okMsg: string
  ) {
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("order_id", orderId);
        fd.set("group_id", groupId);
        fd.set("file_name", fileName);
        await fn(fd);
        toast.success(okMsg);
        router.refresh();
      } catch (e: any) {
        toast.error(e?.message ?? "Action failed.");
      }
    });
  }

  const byCategory = (cat: string) => active.filter((d) => d.category === cat);

  return (
    <div className="space-y-5">
      {/* ---- Drop zone / uploader ---- */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files);
        }}
        className={`rounded-xl border-2 border-dashed p-6 text-center transition ${
          dragOver ? "border-solux bg-solux/5" : "border-neutral-300 bg-neutral-50"
        }`}
      >
        <p className="text-sm font-medium text-neutral-700">Drop files here</p>
        <p className="mt-0.5 text-xs text-neutral-500">
          PDF · Excel · Word · images · ZIP · CAD · Dialux · any standard format · multiple at once
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <label className="text-xs text-neutral-600">
            Category{" "}
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as OrderDocumentCategory)}
              className="rounded border border-neutral-200 px-2 py-1 text-sm"
            >
              {ORDER_DOC_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {ORDER_DOC_CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && uploadFiles(e.target.files)}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={pending}
            className="btn-primary text-sm disabled:opacity-50"
          >
            {pending ? progress ?? "Uploading…" : "Upload Document"}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-neutral-400">Max {formatFileSize(ATTACHMENT_MAX_BYTES)} per file.</p>
      </div>

      {/* hidden input used by Replace buttons */}
      <input
        ref={replaceInputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length && replaceGroup) uploadFiles(e.target.files, replaceGroup);
          setReplaceGroup(null);
        }}
      />

      {/* ---- Active documents, grouped by category ---- */}
      {active.length === 0 ? (
        <p className="text-sm text-neutral-500">No documents yet. Drop files above to start the order folder.</p>
      ) : (
        ORDER_DOC_CATEGORIES.filter((c) => byCategory(c).length > 0).map((cat) => (
          <div key={cat}>
            <div className="eyebrow mb-1.5">{ORDER_DOC_CATEGORY_LABEL[cat]}</div>
            <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white">
              {byCategory(cat).map((d) => (
                <DocRow
                  key={d.groupId}
                  doc={d}
                  pending={pending}
                  onReplace={() => {
                    setReplaceGroup(d.groupId);
                    replaceInputRef.current?.click();
                  }}
                  onArchive={() =>
                    runAction(archiveOrderDocument, d.groupId, d.current.name, "✓ Document archived")
                  }
                  dt={dt}
                />
              ))}
            </ul>
          </div>
        ))
      )}

      {/* ---- Archived (soft-deleted) ---- */}
      {archived.length > 0 && (
        <details className="rounded-lg border border-neutral-200 bg-neutral-50/60">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-neutral-600">
            Archived ({archived.length})
          </summary>
          <ul className="divide-y divide-neutral-100 border-t border-neutral-100">
            {archived.map((d) => (
              <li key={d.groupId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="truncate text-neutral-500 line-through">{d.current.name}</span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    runAction(restoreOrderDocument, d.groupId, d.current.name, "✓ Document restored")
                  }
                  className="shrink-0 rounded border border-neutral-200 px-2 py-1 text-xs hover:bg-white disabled:opacity-50"
                >
                  ↩ Restore
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* ---- Audit trail ---- */}
      {audit.length > 0 && (
        <details className="rounded-lg border border-neutral-200 bg-white">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-neutral-600">
            Activity log ({audit.length})
          </summary>
          <ul className="divide-y divide-neutral-100 border-t border-neutral-100 text-xs">
            {audit.slice(0, 50).map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-1.5">
                <span className="text-neutral-700">
                  <b>{a.byLabel ?? "Someone"}</b> {ACTION_LABEL[a.action] ?? a.action}
                  {a.fileName ? ` "${a.fileName}"` : ""}
                </span>
                <span className="shrink-0 text-neutral-400">{dt(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function DocRow({
  doc,
  pending,
  onReplace,
  onArchive,
  dt,
}: {
  doc: LogicalDocView;
  pending: boolean;
  onReplace: () => void;
  onArchive: () => void;
  dt: (s: string) => string;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const c = doc.current;
  return (
    <li className="px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <a
            href={c.signedUrl ?? "#"}
            target="_blank"
            rel="noreferrer"
            className="block truncate text-sm font-medium text-neutral-900 hover:underline"
          >
            {c.name}
          </a>
          <div className="text-[11px] text-neutral-500">
            v{c.version}
            {c.size != null ? ` · ${formatFileSize(c.size)}` : ""}
            {c.byLabel ? ` · ${c.byLabel}` : ""} · {dt(c.createdAt)}
            {doc.versions.length > 1 && (
              <>
                {" · "}
                <button type="button" onClick={() => setShowHistory((v) => !v)} className="text-solux-dark hover:underline">
                  {showHistory ? "hide history" : `${doc.versions.length} versions`}
                </button>
              </>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <a
            href={c.signedUrl ?? "#"}
            target="_blank"
            rel="noreferrer"
            className="rounded border border-neutral-200 px-2 py-1 text-xs hover:bg-neutral-50"
          >
            Download
          </a>
          <button
            type="button"
            disabled={pending}
            onClick={onReplace}
            className="rounded border border-neutral-200 px-2 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50"
          >
            Replace
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onArchive}
            className="rounded border border-neutral-200 px-2 py-1 text-xs text-rose-600 hover:bg-rose-50 disabled:opacity-50"
          >
            Archive
          </button>
        </div>
      </div>
      {showHistory && doc.versions.length > 1 && (
        <ul className="mt-2 space-y-1 border-l-2 border-neutral-100 pl-3 text-[11px]">
          {doc.versions.map((v) => (
            <li key={v.id} className="flex items-center justify-between gap-2">
              <a href={v.signedUrl ?? "#"} target="_blank" rel="noreferrer" className="truncate text-neutral-600 hover:underline">
                v{v.version} · {v.name}
              </a>
              <span className="shrink-0 text-neutral-400">
                {v.byLabel ? `${v.byLabel} · ` : ""}
                {dt(v.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
