"use client";

import { useRef, useState, useTransition } from "react";
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
 * AttachmentUploader — pick a file, tag its type + audience visibility,
 * add a note, upload.
 *
 * Two-step (matches the PDF flow): browser uploads to the `documents`
 * bucket under attachments/<affairId>/…, then a server action records
 * the row. Keeps it lightweight — no chunking, no OCR, no preview
 * processing.
 */
export function AttachmentUploader({
  documentId,
  affairId,
}: {
  documentId: string;
  affairId: string;
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [type, setType] = useState<AttachmentType>("technical_spec");
  const [note, setNote] = useState("");
  const [vis, setVis] = useState({
    sales: true,
    ops: true,
    factory: true,
    client: false,
  });
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setFile(null);
    setNote("");
    setType("technical_spec");
    setVis({ sales: true, ops: true, factory: true, client: false });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const onUpload = () => {
    if (!file) {
      setError("Choose a file first.");
      return;
    }
    if (file.size > ATTACHMENT_MAX_BYTES) {
      setError(`File too large (max ${formatFileSize(ATTACHMENT_MAX_BYTES)}).`);
      return;
    }
    setError(null);

    startTransition(async () => {
      try {
        setProgress("Uploading…");
        const supabase = createBrowserSupabase();
        // Sanitize the name + make the path collision-proof.
        const safeName = file.name.replace(/[^\w.\-]+/g, "_");
        const path = `attachments/${affairId}/${Date.now()}-${safeName}`;
        const { error: upErr } = await supabase.storage
          .from(ATTACHMENTS_BUCKET)
          .upload(path, file, {
            contentType: file.type || "application/octet-stream",
            upsert: false,
          });
        if (upErr) throw new Error(upErr.message);

        setProgress("Saving…");
        const fd = new FormData();
        fd.set("document_id", documentId);
        fd.set("storage_path", path);
        fd.set("file_name", file.name);
        fd.set("file_size", String(file.size));
        fd.set("mime_type", file.type || "");
        fd.set("attachment_type", type);
        fd.set("note", note);
        fd.set("visible_sales", vis.sales ? "1" : "0");
        fd.set("visible_ops", vis.ops ? "1" : "0");
        fd.set("visible_factory", vis.factory ? "1" : "0");
        fd.set("visible_client", vis.client ? "1" : "0");
        await recordAttachment(fd);

        reset();
        setProgress(null);
        router.refresh();
      } catch (e: any) {
        setProgress(null);
        setError(e?.message ?? "Upload failed");
      }
    });
  };

  return (
    <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50/50 p-3 space-y-3">
      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] text-rose-700">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setError(null);
          }}
          className="text-xs file:mr-2 file:rounded-md file:border-0 file:bg-neutral-900 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:bg-neutral-800"
        />
        {file && (
          <span className="text-[11px] text-neutral-500">
            {formatFileSize(file.size)}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-medium">
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
          <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-medium">
            Comment (specific to this file)
          </span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="e.g. Approved dims rev B — verify bracket width before cutting."
            className="mt-0.5 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs focus:border-neutral-400 focus:outline-none resize-y"
          />
        </label>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-medium">
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
            className="inline-flex items-center gap-1 text-[11px] text-neutral-600 cursor-pointer"
          >
            <input
              type="checkbox"
              checked={vis[key]}
              onChange={(e) => setVis((s) => ({ ...s, [key]: e.target.checked }))}
              className="h-3.5 w-3.5 rounded border-neutral-300"
            />
            {label}
          </label>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-neutral-400">{progress}</span>
        <button
          type="button"
          onClick={onUpload}
          disabled={pending || !file}
          className="rounded-md bg-neutral-900 text-white px-3 py-1.5 text-xs font-medium hover:bg-neutral-800 disabled:bg-neutral-300 disabled:cursor-not-allowed"
        >
          {pending ? "Working…" : "Upload attachment"}
        </button>
      </div>
    </div>
  );
}
