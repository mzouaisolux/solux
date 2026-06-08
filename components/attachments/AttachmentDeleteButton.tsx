"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteAttachment } from "@/app/(app)/_actions/attachments";

/** Small inline delete control for an attachment row. Confirms first. */
export function AttachmentDeleteButton({
  id,
  documentId,
  fileName,
}: {
  id: string;
  documentId: string;
  fileName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const onDelete = () => {
    if (!window.confirm(`Delete "${fileName}"? This cannot be undone.`)) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", id);
      fd.set("document_id", documentId);
      try {
        await deleteAttachment(fd);
        router.refresh();
      } catch (e: any) {
        window.alert(e?.message ?? "Delete failed");
      }
    });
  };

  return (
    <button
      type="button"
      onClick={onDelete}
      disabled={pending}
      className="text-[11px] text-neutral-400 hover:text-rose-600 disabled:opacity-50"
      title="Delete attachment"
    >
      {pending ? "…" : "Delete"}
    </button>
  );
}
