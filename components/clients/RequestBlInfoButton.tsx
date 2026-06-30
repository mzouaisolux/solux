"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestBlInfoFromSales } from "@/app/(app)/production/orders/actions";
import { toast } from "@/components/feedback/toast-store";

/**
 * "Request information from Sales" — the BL workflow trigger with REAL
 * feedback. The server action already does the heavy lifting (HIGH event
 * → sales owner's bell, planned action on the affair, affair history,
 * anti-duplicate gate); this client wrapper makes the outcome VISIBLE to
 * Operations: success toast + inline confirmation, or the server's
 * explanation ("Request already sent on …") instead of a silent reload.
 */
export function RequestBlInfoButton({
  orderId,
  tone,
}: {
  orderId: string;
  /** "missing" → rose, anything else → amber (mirrors the status badge). */
  tone: "missing" | "partial";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  function submit() {
    setNote(null);
    const fd = new FormData();
    fd.set("id", orderId);
    startTransition(async () => {
      try {
        await requestBlInfoFromSales(fd);
        setSent(true);
        setNote("Request sent — the sales owner has been notified and tasked.");
        toast.success("✓ Request sent to Sales (notification + to-do created)");
        router.refresh();
      } catch (e: any) {
        // Not necessarily an error: the anti-duplicate gate answers here
        // ("Request already sent on …"). Show it inline, calmly.
        setNote(e?.message ?? "The request could not be sent.");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={submit}
        disabled={pending || sent}
        className={`rounded-md px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-60 ${
          tone === "missing"
            ? "bg-rose-600 hover:bg-rose-700"
            : "bg-amber-600 hover:bg-amber-700"
        }`}
      >
        {pending
          ? "Sending…"
          : sent
          ? "✓ Request sent"
          : tone === "missing"
          ? "Request information from Sales"
          : "Request completion"}
      </button>
      {note && (
        <p className="max-w-[260px] text-right text-[10px] leading-snug text-neutral-500">
          {note}
        </p>
      )}
    </div>
  );
}
