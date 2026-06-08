"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateAttachment } from "@/app/(app)/_actions/attachments";
import { ATTACHMENT_TYPES, type AttachmentType } from "@/lib/attachments";

/**
 * Inline per-file editor for an attachment's TYPE + COMMENT.
 *
 * Type changes auto-save on select; the comment saves on blur (or via
 * the small "Save" affordance that appears once edited). Keeps each
 * file individually classifiable + annotated after upload — not just at
 * upload time.
 */
export function AttachmentRowEditor({
  id,
  documentId,
  initialType,
  initialNote,
}: {
  id: string;
  documentId: string;
  initialType: AttachmentType;
  initialNote: string | null;
}) {
  const router = useRouter();
  const [type, setType] = useState<AttachmentType>(initialType);
  const [note, setNote] = useState(initialNote ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);

  const persist = (patch: { attachment_type?: string; note?: string }) => {
    setError(false);
    const fd = new FormData();
    fd.set("id", id);
    fd.set("document_id", documentId);
    if (patch.attachment_type !== undefined)
      fd.set("attachment_type", patch.attachment_type);
    if (patch.note !== undefined) fd.set("note", patch.note);
    startTransition(async () => {
      try {
        await updateAttachment(fd);
        router.refresh();
      } catch {
        setError(true);
      }
    });
  };

  const onType = (v: string) => {
    setType(v as AttachmentType);
    persist({ attachment_type: v });
  };

  const onNoteBlur = () => {
    if (note.trim() === (initialNote ?? "").trim()) return; // no change
    persist({ note });
  };

  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <div className="flex items-center gap-2">
        <select
          value={type}
          disabled={pending}
          onChange={(e) => onType(e.target.value)}
          className="rounded-md border border-neutral-200 bg-white px-1.5 py-0.5 text-[11px] focus:border-neutral-400 focus:outline-none disabled:opacity-60"
          aria-label="Attachment type"
        >
          {ATTACHMENT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        {pending && <span className="text-[10px] text-neutral-400">Saving…</span>}
        {error && <span className="text-[10px] text-rose-600">Failed</span>}
      </div>
      <input
        value={note}
        disabled={pending}
        placeholder="Comment for this file…"
        onChange={(e) => setNote(e.target.value)}
        onBlur={onNoteBlur}
        className="w-full max-w-md rounded-md border border-neutral-200 bg-white px-2 py-1 text-[11px] text-neutral-700 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none disabled:opacity-60"
      />
    </div>
  );
}
