"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient as createBrowserSupabase } from "@/lib/supabase/client";
import { recordAttachment } from "@/app/(app)/_actions/attachments";
import {
  ATTACHMENTS_BUCKET,
  ATTACHMENT_MAX_BYTES,
  formatFileSize,
} from "@/lib/attachments";

/**
 * InlineLogoUpload — one-click logo/artwork upload that reuses the
 * affair attachments store. Used inside the stickers/branding section
 * so the logo can be added right where it's needed; the file then
 * appears in the Attachments panel (type "Logo"), shared across the
 * affair. No separate storage — same bucket + table as everything else.
 */
export function InlineLogoUpload({
  documentId,
  attachmentType = "logo",
  buttonLabel = "Upload logo",
  defaultNote = "Branding / logo artwork",
}: {
  /** Any document of the affair (the action resolves the affair root). */
  documentId: string;
  attachmentType?: "logo" | "packaging_artwork";
  buttonLabel?: string;
  defaultNote?: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onPick = (file: File | null) => {
    if (!file) return;
    setError(null);
    setDone(null);
    if (file.size > ATTACHMENT_MAX_BYTES) {
      setError(`Too large (max ${formatFileSize(ATTACHMENT_MAX_BYTES)}).`);
      return;
    }
    startTransition(async () => {
      try {
        const supabase = createBrowserSupabase();
        const safe = file.name.replace(/[^\w.\-]+/g, "_");
        const path = `attachments/${documentId}/${Date.now()}-${safe}`;
        const { error: upErr } = await supabase.storage
          .from(ATTACHMENTS_BUCKET)
          .upload(path, file, {
            contentType: file.type || "application/octet-stream",
            upsert: false,
          });
        if (upErr) throw new Error(upErr.message);

        const fd = new FormData();
        fd.set("document_id", documentId);
        fd.set("storage_path", path);
        fd.set("file_name", file.name);
        fd.set("file_size", String(file.size));
        fd.set("mime_type", file.type || "");
        fd.set("attachment_type", attachmentType);
        fd.set("note", defaultNote);
        // Logos are typically client-facing too.
        fd.set("visible_sales", "1");
        fd.set("visible_ops", "1");
        fd.set("visible_factory", "1");
        fd.set("visible_client", "1");
        await recordAttachment(fd);

        setDone(file.name);
        if (inputRef.current) inputRef.current.value = "";
        router.refresh();
      } catch (e: any) {
        setError(e?.message ?? "Upload failed");
      }
    });
  };

  return (
    <div className="inline-flex items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.pdf,.ai,.eps,.svg"
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />
      <button
        type="button"
        disabled={pending}
        onClick={() => inputRef.current?.click()}
        className="inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 text-[11px] font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
      >
        {pending ? "Uploading…" : `+ ${buttonLabel}`}
      </button>
      {done && (
        <span className="text-[10px] text-emerald-700 truncate max-w-[160px]">
          ✓ {done} — see Attachments
        </span>
      )}
      {error && <span className="text-[10px] text-rose-600">{error}</span>}
    </div>
  );
}
