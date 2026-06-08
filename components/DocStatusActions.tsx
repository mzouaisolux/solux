"use client";

import { useState, useTransition } from "react";
import {
  DOC_STATUSES,
  DOC_STATUS_LABEL,
  type DocStatus,
} from "@/lib/types";
import { describeCascade } from "@/lib/lifecycle";
import { updateDocumentStatus } from "@/app/(app)/documents/[id]/actions";

/**
 * Secondary status transitions for a quotation — the compact "Other status:"
 * row on the document page. Replaces the previous bare `<form action>` buttons
 * with the three guarantees the lifecycle audit (H1 / H3) required:
 *
 *  1. A WON quote no longer offers the editable reverts (draft / sent /
 *     negotiating) — those are the de-sync backdoor (H1). Only Cancelled /
 *     Lost are offered; the server action (updateDocumentStatus) remains the
 *     authoritative backstop for every other entry point.
 *  2. Cancelling / marking-lost a WON quote shows a confirm listing the
 *     cascade (linked task lists + production orders get cancelled too) before
 *     it fires (H3). The cascade text comes from describeCascade(), which the
 *     audit found was previously dead code.
 *  3. Server-side guard throws (e.g. won→draft when production exists) surface
 *     as a clean alert instead of a Next error page — same pattern as
 *     components/InlineStatusSwitcher.tsx.
 */
export default function DocStatusActions({
  docId,
  current,
}: {
  docId: string;
  current: DocStatus;
}) {
  const [pending, startTransition] = useTransition();
  const [busyTarget, setBusyTarget] = useState<DocStatus | null>(null);

  // A WON quote may only move to the cascade-terminal statuses; the editable
  // reverts are withheld (H1). Everything else keeps the original candidate
  // list: all statuses except the current one and `won` (which has its own
  // primary button elsewhere on the page).
  const candidates: DocStatus[] =
    current === "won"
      ? ["cancelled", "lost"]
      : DOC_STATUSES.filter((s) => s !== current && s !== "won");

  function go(next: DocStatus) {
    // Cancelling / losing a WON quote cascades to its task lists + POs —
    // confirm with the explicit cascade summary before firing (H3).
    if ((next === "cancelled" || next === "lost") && current === "won") {
      const msg =
        `Mark quotation as “${DOC_STATUS_LABEL[next]}”?\n\n` +
        describeCascade("document")
          .map((l) => `• ${l}`)
          .join("\n") +
        `\n\nRe-opening later won't restore the cancelled production.`;
      if (!window.confirm(msg)) return;
    }

    setBusyTarget(next);
    const fd = new FormData();
    fd.set("id", docId);
    fd.set("status", next);
    startTransition(async () => {
      try {
        await updateDocumentStatus(fd);
      } catch (err: any) {
        // NEXT_REDIRECT is success in disguise — re-throw so navigation
        // happens. Everything else is a real error (e.g. a lifecycle guard
        // throw): surface it instead of letting it vanish into a toast.
        if (err?.digest && String(err.digest).startsWith("NEXT_REDIRECT")) {
          throw err;
        }
        window.alert(err?.message || "Could not change status.");
      } finally {
        setBusyTarget(null);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 mt-3 text-xs">
      <span className="text-neutral-500">Other status:</span>
      {candidates.map((s) => (
        <button
          key={s}
          type="button"
          disabled={pending}
          onClick={() => go(s)}
          className="rounded border border-neutral-200 px-2 py-0.5 hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-wait"
        >
          {busyTarget === s ? "…" : DOC_STATUS_LABEL[s]}
        </button>
      ))}
    </div>
  );
}
