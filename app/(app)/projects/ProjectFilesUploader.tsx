"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient as createBrowserSupabase } from "@/lib/supabase/client";
import { recordProjectFile } from "./actions";
import { toast } from "@/components/feedback/toast-store";
import {
  ATTACHMENTS_BUCKET,
  ATTACHMENT_MAX_BYTES,
  formatFileSize,
} from "@/lib/attachments";
import {
  PROJECT_FILE_CATEGORY_LABEL,
  PROJECT_FILE_SPECIALIZED_CATEGORIES,
  type ProjectRequestFileCategory,
} from "@/lib/types";

/**
 * Multi-file uploader for a Project Request. Browser uploads each file to the
 * `documents` bucket under project-requests/<id>/…, then a server action
 * records the row. Mirrors AttachmentUploader without coupling to documents.
 */
// Advisory `accept` hint per category (UX audit). Falls back to any file.
const ACCEPT_BY_CATEGORY: Partial<Record<ProjectRequestFileCategory, string>> = {
  costing: ".xlsx,.xls,.csv",
  pole_drawing: ".pdf,.dwg,.dxf,.jpg,.jpeg,.png",
  packing: ".pdf,.xlsx,.xls,.csv",
};

export function ProjectFilesUploader({
  projectId,
  fixedCategory,
  label,
}: {
  projectId: string;
  /** When set, the category is locked (no dropdown) — e.g. "packing". */
  fixedCategory?: ProjectRequestFileCategory;
  /** Optional override for the hint line. */
  label?: string;
}) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [category, setCategory] = useState<ProjectRequestFileCategory>(fixedCategory ?? "tender");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setFiles([]);
    if (inputRef.current) inputRef.current.value = "";
  };

  const onUpload = () => {
    if (!files.length) {
      setError("Choose one or more files first.");
      return;
    }
    const tooBig = files.find((f) => f.size > ATTACHMENT_MAX_BYTES);
    if (tooBig) {
      setError(`"${tooBig.name}" is too large (max ${formatFileSize(ATTACHMENT_MAX_BYTES)}).`);
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const supabase = createBrowserSupabase();
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          setProgress(`Uploading ${i + 1}/${files.length}…`);
          const safeName = file.name.replace(/[^\w.\-]+/g, "_");
          const path = `project-requests/${projectId}/${Date.now()}-${safeName}`;
          const { error: upErr } = await supabase.storage
            .from(ATTACHMENTS_BUCKET)
            .upload(path, file, {
              contentType: file.type || "application/octet-stream",
              upsert: false,
            });
          if (upErr) throw new Error(upErr.message);
          const fd = new FormData();
          fd.set("project_id", projectId);
          fd.set("storage_path", path);
          fd.set("file_name", file.name);
          fd.set("file_size", String(file.size));
          fd.set("mime_type", file.type || "");
          fd.set("category", category);
          await recordProjectFile(fd);
        }
        setProgress(null);
        reset();
        toast.success(`✓ ${files.length} file${files.length === 1 ? "" : "s"} uploaded`);
        router.refresh();
      } catch (e: any) {
        setProgress(null);
        setError(e?.message ?? "Upload failed.");
      }
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        {!fixedCategory && (
          <label className="block">
            <span className="text-[11px] text-neutral-500">Category</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as ProjectRequestFileCategory)}
              className="mt-0.5 block rounded border border-neutral-200 px-2 py-1.5 text-sm"
            >
              {(Object.keys(PROJECT_FILE_CATEGORY_LABEL) as ProjectRequestFileCategory[])
                .filter((k) => !PROJECT_FILE_SPECIALIZED_CATEGORIES.has(k))
                .map((k) => (
                  <option key={k} value={k}>
                    {PROJECT_FILE_CATEGORY_LABEL[k]}
                  </option>
                ))}
            </select>
          </label>
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          // UX audit: steer the picker toward the expected formats per category
          // (costing = spreadsheet, pole drawing = drawing/image, packing = doc).
          // Advisory only — the size guard stays the hard limit.
          accept={ACCEPT_BY_CATEGORY[category]}
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          className="text-sm"
        />
        <button
          type="button"
          onClick={onUpload}
          disabled={pending || files.length === 0}
          className="btn-secondary text-sm disabled:opacity-50"
        >
          {pending ? progress ?? "Uploading…" : `Upload${files.length ? ` ${files.length}` : ""}`}
        </button>
      </div>
      {error && <p className="text-xs text-rose-600">{error}</p>}
      <p className="text-[11px] text-neutral-400">
        {label ?? "Tender documents, technical specs, drawings, images, customer requirements."} Max{" "}
        {formatFileSize(ATTACHMENT_MAX_BYTES)} each.
      </p>
    </div>
  );
}
