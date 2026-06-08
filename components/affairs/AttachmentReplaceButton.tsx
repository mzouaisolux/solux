"use client";

// =====================================================================
// Replace an existing attachment in place: pick a new file → upload to
// Storage (browser, same path the uploader uses) → record the new row
// (preserving the attachment type) → delete the old row. Reuses the proven
// two-step attachment flow. Compact inline control for the Files card.
// =====================================================================

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient as createBrowserSupabase } from "@/lib/supabase/client";
import { recordAttachment, deleteAttachment } from "@/app/(app)/_actions/attachments";
import {
  ATTACHMENTS_BUCKET,
  ATTACHMENT_MAX_BYTES,
  formatFileSize,
} from "@/lib/attachments";

export function AttachmentReplaceButton({
  attachmentId,
  documentId,
  attachmentType,
}: {
  attachmentId: string;
  documentId: string;
  attachmentType: string | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (inputRef.current) inputRef.current.value = "";
    if (!file) return;
    if (file.size > ATTACHMENT_MAX_BYTES) {
      window.alert(`File too large (max ${formatFileSize(ATTACHMENT_MAX_BYTES)}).`);
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
        fd.set("attachment_type", attachmentType || "other");
        await recordAttachment(fd);

        const del = new FormData();
        del.set("id", attachmentId);
        del.set("document_id", documentId);
        await deleteAttachment(del);

        router.refresh();
      } catch (err: any) {
        window.alert(err?.message || "Replace failed.");
      }
    });
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        onChange={onPick}
        className="hidden"
        aria-hidden
      />
      <button
        type="button"
        disabled={pending}
        onClick={() => inputRef.current?.click()}
        className="text-[11px] font-medium text-neutral-500 hover:text-solux-dark disabled:opacity-60"
        title="Upload a new version of this file (replaces it)"
      >
        {pending ? "Replacing…" : "Replace"}
      </button>
    </>
  );
}
