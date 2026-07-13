"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient as createBrowserSupabase } from "@/lib/supabase/client";
import { recordAttachment } from "@/app/(app)/_actions/attachments";
import {
  ATTACHMENT_TYPES,
  ATTACHMENTS_BUCKET,
  ATTACHMENT_MAX_BYTES,
  formatFileSize,
  type AttachmentType,
} from "@/lib/attachments";

/**
 * AttachmentUploader — drag & drop, multi-file, queued uploader.
 *
 * Drop a folder of files (or click Browse, `multiple`) and every file is
 * queued and uploaded automatically — no repeated Upload→Select→Upload.
 * Each file is INDEPENDENT: one failure never blocks the others, and a
 * failed file can be retried in place.
 *
 * Flow per file (unchanged, proven): the browser uploads straight to the
 * `documents` bucket under attachments/<affairId>/…, then a server action
 * records the row (RLS scopes it to the affair). Metadata — original name,
 * extension, size, timestamp, uploaded-by, project link — is captured
 * automatically; a category + audience visibility can OPTIONALLY be set as
 * batch defaults, but are never required to upload (assign/replace later).
 *
 * Supabase JS `.upload()` exposes no byte-level progress event, so each
 * file shows a status chip (queued → uploading → done/failed) rather than a
 * percentage — the same honest signal Dropbox/Drive fall back to per file.
 */

type QueueStatus = "queued" | "uploading" | "success" | "error";
type QueueItem = {
  id: string;
  file: File;
  name: string;
  size: number;
  status: QueueStatus;
  error?: string;
};

// How many files upload at once. Keeps a folder-drop fast without hammering
// Storage / the record action; the rest wait their turn in the queue.
const UPLOAD_CONCURRENCY = 3;

function fileExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 && i < name.length - 1 ? name.slice(i + 1).toUpperCase() : "";
}

export function AttachmentUploader({
  documentId,
  affairId,
}: {
  documentId: string;
  affairId: string;
}) {
  const router = useRouter();

  // The work list lives in a ref (mutated in place by the async workers so
  // they always read the latest status) and is mirrored to state for render.
  const queueRef = useRef<QueueItem[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const processingRef = useRef(false);
  const [processing, setProcessing] = useState(false);

  const [dragOver, setDragOver] = useState(false);
  const [showDefaults, setShowDefaults] = useState(false);
  // Batch defaults applied to every file in a drop — all optional.
  const [type, setType] = useState<AttachmentType>("other");
  const [note, setNote] = useState("");
  const [vis, setVis] = useState({
    sales: true,
    ops: true,
    factory: true,
    client: false,
  });
  const inputRef = useRef<HTMLInputElement>(null);

  const sync = useCallback(() => setQueue([...queueRef.current]), []);

  const uploadOne = useCallback(
    async (item: QueueItem, supabase: ReturnType<typeof createBrowserSupabase>) => {
      // Sanitize the name + make the path collision-proof even for same-named
      // files dropped in the same millisecond (id disambiguates).
      const safeName = item.file.name.replace(/[^\w.\-]+/g, "_");
      const path = `attachments/${affairId}/${Date.now()}-${item.id.slice(0, 8)}-${safeName}`;
      const { error: upErr } = await supabase.storage
        .from(ATTACHMENTS_BUCKET)
        .upload(path, item.file, {
          contentType: item.file.type || "application/octet-stream",
          upsert: false,
        });
      if (upErr) throw new Error(upErr.message);

      const fd = new FormData();
      fd.set("document_id", documentId);
      fd.set("storage_path", path);
      fd.set("file_name", item.file.name);
      fd.set("file_size", String(item.file.size));
      fd.set("mime_type", item.file.type || "");
      fd.set("attachment_type", type);
      fd.set("note", note);
      fd.set("visible_sales", vis.sales ? "1" : "0");
      fd.set("visible_ops", vis.ops ? "1" : "0");
      fd.set("visible_factory", vis.factory ? "1" : "0");
      fd.set("visible_client", vis.client ? "1" : "0");
      await recordAttachment(fd);
    },
    [affairId, documentId, type, note, vis]
  );

  // Drain the queue with a bounded number of parallel workers. Each worker
  // grabs the next "queued" item (find + status flip are synchronous, so two
  // workers never claim the same file), uploads it, then loops. Independent:
  // an item's failure only marks that item — others keep going.
  const process = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    setProcessing(true);
    const supabase = createBrowserSupabase();

    const worker = async () => {
      for (;;) {
        const next = queueRef.current.find((x) => x.status === "queued");
        if (!next) return;
        next.status = "uploading";
        sync();
        try {
          await uploadOne(next, supabase);
          next.status = "success";
        } catch (e: any) {
          next.status = "error";
          next.error = e?.message ?? "Upload failed";
        }
        sync();
      }
    };

    await Promise.all(
      Array.from({ length: UPLOAD_CONCURRENCY }, () => worker())
    );

    processingRef.current = false;
    setProcessing(false);
    // Surface the newly-recorded rows in the server-rendered list.
    router.refresh();
  }, [router, sync, uploadOne]);

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files);
      if (!list.length) return;
      const items: QueueItem[] = list.map((file) => {
        const tooBig = file.size > ATTACHMENT_MAX_BYTES;
        return {
          id: crypto.randomUUID(),
          file,
          name: file.name,
          size: file.size,
          status: tooBig ? "error" : "queued",
          error: tooBig
            ? `Too large (max ${formatFileSize(ATTACHMENT_MAX_BYTES)})`
            : undefined,
        };
      });
      queueRef.current.push(...items);
      sync();
      void process();
      if (inputRef.current) inputRef.current.value = "";
    },
    [process, sync]
  );

  const retry = useCallback(
    (id: string) => {
      const it = queueRef.current.find((x) => x.id === id);
      if (!it || it.status !== "error") return;
      if (it.size > ATTACHMENT_MAX_BYTES) return; // unrecoverable
      it.status = "queued";
      it.error = undefined;
      sync();
      void process();
    },
    [process, sync]
  );

  const clearDone = useCallback(() => {
    queueRef.current = queueRef.current.filter((x) => x.status !== "success");
    sync();
  }, [sync]);

  const done = queue.filter((q) => q.status === "success").length;
  const failed = queue.filter((q) => q.status === "error").length;
  const active = queue.filter(
    (q) => q.status === "queued" || q.status === "uploading"
  ).length;

  return (
    <div className="space-y-2.5">
      {/* ---------- Drop zone ---------- */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        className={`cursor-pointer rounded-lg border-2 border-dashed px-4 py-6 text-center transition ${
          dragOver
            ? "border-solux bg-solux/5"
            : "border-neutral-300 bg-neutral-50/60 hover:border-neutral-400 hover:bg-neutral-50"
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          className="mx-auto h-6 w-6 text-neutral-400"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden
        >
          <path
            d="M12 16V4m0 0L7 9m5-5l5 5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"
            strokeLinecap="round"
          />
        </svg>
        <p className="mt-1.5 text-[13px] font-medium text-neutral-700">
          {dragOver ? "Drop files here" : "Drag & drop files, or click to browse"}
        </p>
        <p className="mt-0.5 text-[11px] text-neutral-500">
          PDF · DWG · DXF · XLSX · DOCX · ZIP · JPG · PNG · multiple at once
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && addFiles(e.target.files)}
        />
        <p className="mt-2 text-[10px] text-neutral-400">
          Max {formatFileSize(ATTACHMENT_MAX_BYTES)} per file · category optional
        </p>
      </div>

      {/* ---------- Optional batch defaults ---------- */}
      <details
        open={showDefaults}
        onToggle={(e) => setShowDefaults((e.target as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer select-none text-[11px] font-medium text-neutral-400 hover:text-neutral-600">
          Category & visibility (optional — applies to this batch)
        </summary>
        <div className="mt-2 space-y-2 rounded-lg border border-neutral-200 bg-white p-2.5">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
                Type
              </span>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as AttachmentType)}
                className="mt-0.5 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs focus:border-neutral-400 focus:outline-none"
              >
                {ATTACHMENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
                Comment (applies to all)
              </span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="e.g. Approved dims rev B — verify before cutting."
                className="mt-0.5 w-full resize-y rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs focus:border-neutral-400 focus:outline-none"
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
              Visible to
            </span>
            {(
              [
                ["sales", "Sales"],
                ["ops", "Ops"],
                ["factory", "Factory"],
                ["client", "Client"],
              ] as const
            ).map(([key, label]) => (
              <label
                key={key}
                className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-neutral-600"
              >
                <input
                  type="checkbox"
                  checked={vis[key]}
                  onChange={(e) =>
                    setVis((s) => ({ ...s, [key]: e.target.checked }))
                  }
                  className="h-3.5 w-3.5 rounded border-neutral-300"
                />
                {label}
              </label>
            ))}
          </div>
        </div>
      </details>

      {/* ---------- Upload queue ---------- */}
      {queue.length > 0 && (
        <div className="rounded-lg border border-neutral-200 bg-white">
          <div className="flex items-center justify-between border-b border-neutral-100 px-2.5 py-1.5">
            <span className="text-[11px] font-medium text-neutral-600">
              {processing || active > 0
                ? `Uploading ${done + failed}/${queue.length}…`
                : `${done} uploaded${failed ? ` · ${failed} failed` : ""}`}
            </span>
            {!processing && active === 0 && done > 0 && (
              <button
                type="button"
                onClick={clearDone}
                className="text-[11px] font-medium text-neutral-400 hover:text-neutral-700"
              >
                Clear completed
              </button>
            )}
          </div>
          <ul className="max-h-56 divide-y divide-neutral-50 overflow-y-auto">
            {queue.map((item) => {
              const ext = fileExt(item.name);
              return (
                <li
                  key={item.id}
                  className="flex items-center gap-2.5 px-2.5 py-1.5"
                >
                  <span className="inline-flex h-6 w-8 shrink-0 items-center justify-center rounded bg-neutral-100 text-[9px] font-semibold text-neutral-500">
                    {ext || "—"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] text-neutral-800">
                      {item.name}
                    </div>
                    <div className="text-[10px] text-neutral-400">
                      {formatFileSize(item.size) || `${item.size} B`}
                      {item.status === "error" && item.error
                        ? ` · ${item.error}`
                        : ""}
                    </div>
                  </div>
                  <StatusChip status={item.status} />
                  {item.status === "error" &&
                    item.size <= ATTACHMENT_MAX_BYTES && (
                      <button
                        type="button"
                        onClick={() => retry(item.id)}
                        className="shrink-0 rounded border border-neutral-200 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600 hover:bg-neutral-50"
                      >
                        Retry
                      </button>
                    )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function StatusChip({ status }: { status: QueueStatus }) {
  if (status === "success")
    return (
      <span
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white"
        title="Uploaded"
        aria-label="Uploaded"
      >
        <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden>
          <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  if (status === "error")
    return (
      <span
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-rose-500 text-white"
        title="Failed"
        aria-label="Failed"
      >
        <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden>
          <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
        </svg>
      </span>
    );
  if (status === "uploading")
    return (
      <span
        className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-neutral-300 border-t-solux"
        title="Uploading"
        aria-label="Uploading"
      />
    );
  return (
    <span className="shrink-0 text-[10px] text-neutral-400" title="Queued">
      Queued
    </span>
  );
}
