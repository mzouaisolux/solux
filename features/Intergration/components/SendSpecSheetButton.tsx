"use client";

// Integrations — "Send spec sheet" on a quotation. Fires the spec_sheet.sent
// event (→ webhook → n8n delivers the PDF). Optional spec-sheet link + note.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/feedback/toast-store";
import { sendSpecSheet } from "@/features/Intergration/actions/spec-sheet";

export function SendSpecSheetButton({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [specUrl, setSpecUrl] = useState("");
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      try {
        await sendSpecSheet({ documentId, specUrl: specUrl || null, note: note || null });
        toast.success("Spec sheet sent");
        setOpen(false);
        setSpecUrl("");
        setNote("");
        router.refresh();
      } catch (e: any) {
        toast.error(e?.message ?? "Could not send spec sheet");
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-neutral-200 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
      >
        Send spec sheet
      </button>
    );
  }

  return (
    <div className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
      <div className="text-sm font-semibold">Send spec sheet to customer</div>
      <p className="mt-0.5 text-xs text-neutral-500">
        Triggers the spec_sheet.sent automation. Paste a spec-sheet link to include, or leave blank.
      </p>
      <input
        className="mt-2 w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm"
        placeholder="https://… spec sheet PDF (optional)"
        value={specUrl}
        onChange={(e) => setSpecUrl(e.target.value)}
      />
      <input
        className="mt-2 w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm"
        placeholder="Note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="inline-flex items-center rounded-md border border-neutral-900 bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Sending…" : "Send"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={pending}
          className="rounded-md border border-neutral-200 px-3 py-1.5 text-sm hover:bg-neutral-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export default SendSpecSheetButton;
