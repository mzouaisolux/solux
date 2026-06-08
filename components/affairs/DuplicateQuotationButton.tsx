"use client";

// Duplicate a quotation (new draft in the same project), then refresh.
// Wraps the gated `duplicateDocument` server action; surfaces errors.

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { duplicateDocument } from "@/app/(app)/clients/actions";

export function DuplicateQuotationButton({
  id,
  className,
}: {
  id: string;
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (pending) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", id);
      try {
        await duplicateDocument(fd);
        router.refresh();
      } catch (err: any) {
        if (err?.digest && String(err.digest).startsWith("NEXT_REDIRECT")) throw err;
        window.alert(err?.message || "Duplicate failed.");
      }
    });
  }

  return (
    <button type="button" onClick={onClick} disabled={pending} className={className}>
      {pending ? "Duplicating…" : "Duplicate"}
    </button>
  );
}
