"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  launchProduction,
  updateDocumentStatus,
} from "@/app/(app)/documents/[id]/actions";

/**
 * The quotation's PRIMARY workflow actions, grouped in the page header
 * (redesign #3/#4/#5). One contextual row — no more actions scattered
 * between the header, a yellow card, and a footer:
 *
 *   draft            → Continue editing (primary) · Mark as sent
 *   sent/negotiating → Mark Won (primary, in-app confirm) · Edit → new version
 *   won              → Launch Production / → View command / → Task list
 *   lost/cancelled   → (nothing)
 *
 * "Create invoice" is rendered beside this by the server (InvoiceCreateMenu,
 * which needs the precomputed amounts). Mark Won uses an in-app confirm — the
 * old window.confirm froze the tab and looked unbranded (audit P2).
 */

type Props = {
  doc: { id: string; status: string; type?: string };
  taskList: { id: string; number: string | null } | null;
  command?: { id: string; number: string | null } | null;
};

const PRIMARY =
  "inline-flex items-center gap-1.5 rounded-md bg-solux px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-solux-dark disabled:opacity-50";
const SECONDARY =
  "inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3.5 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-50";

export default function QuotationActionBar({ doc, taskList, command = null }: Props) {
  const [pending, startTransition] = useTransition();
  // null = closed. "direct" = sent/negotiating → Won. "fromDraft" = a Draft
  // jumped straight to Won (we mark it Sent + Won in one confirm).
  const [confirmWon, setConfirmWon] = useState<null | "direct" | "fromDraft">(null);

  function flip(next: string) {
    const fd = new FormData();
    fd.set("id", doc.id);
    fd.set("status", next);
    startTransition(async () => {
      await updateDocumentStatus(fd);
    });
  }

  /**
   * Mark Won — the ERP adapts to the sales workflow (owner 2026-07-03). A rep
   * whose customer accepted a still-Draft quote clicks Won directly; we record
   * BOTH steps (Draft→Sent→Won) so the trail stays honest, in one action.
   */
  function markWon(fromDraft: boolean) {
    startTransition(async () => {
      if (fromDraft) {
        const fdSent = new FormData();
        fdSent.set("id", doc.id);
        fdSent.set("status", "sent");
        await updateDocumentStatus(fdSent);
      }
      const fdWon = new FormData();
      fdWon.set("id", doc.id);
      fdWon.set("status", "won");
      await updateDocumentStatus(fdWon);
    });
  }

  function launch() {
    const fd = new FormData();
    fd.set("quotation_id", doc.id);
    startTransition(async () => {
      try {
        await launchProduction(fd);
      } catch (err: any) {
        if (err?.digest && String(err.digest).startsWith("NEXT_REDIRECT")) throw err;
        window.alert(err?.message || "Could not launch production.");
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Already in production → task list. */}
      {taskList && (
        <Link href={`/task-lists/${taskList.id}`} className={SECONDARY}>
          → Task list
        </Link>
      )}

      {doc.status === "draft" && (
        <>
          <Link href={`/documents/new?edit=${doc.id}`} className={PRIMARY}>
            Continue editing
          </Link>
          <button
            type="button"
            disabled={pending}
            onClick={() => flip("sent")}
            className={SECONDARY}
          >
            {pending ? "Saving…" : "Mark as sent →"}
          </button>
          {/* Customer already accepted? Jump straight to Won (we handle Sent). */}
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirmWon("fromDraft")}
            className={SECONDARY}
          >
            {pending ? "Saving…" : "Mark Won"}
          </button>
        </>
      )}

      {(doc.status === "sent" || doc.status === "negotiating") && (
        <>
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirmWon("direct")}
            className={PRIMARY}
          >
            {pending ? "Saving…" : "Mark Won"}
          </button>
          <Link href={`/documents/new?revise=${doc.id}`} className={SECONDARY}>
            Edit → new version
          </Link>
        </>
      )}

      {doc.status === "won" &&
        !taskList &&
        (command ? (
          <Link href={`/documents/${command.id}`} className={SECONDARY}>
            → View command
          </Link>
        ) : (
          <button type="button" disabled={pending} onClick={launch} className={SECONDARY}>
            {pending ? "Launching…" : "🚀 Launch Production"}
          </button>
        ))}

      {/* In-app confirm for Mark Won — records revenue + unlocks production.
          From a Draft, it offers "Mark as Sent and Won" (both in one step). */}
      {confirmWon && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-4"
          onClick={() => !pending && setConfirmWon(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-semibold text-neutral-900">
              {confirmWon === "fromDraft"
                ? "This quotation hasn't been marked as Sent yet"
                : "Mark this quotation as Won?"}
            </div>
            <p className="mt-2 text-[13px] text-neutral-500">
              {confirmWon === "fromDraft"
                ? "The customer accepted? We'll mark it Sent and Won in one step — recording the deal as revenue and unlocking invoicing and Launch Production."
                : "This records the deal as revenue and unlocks invoicing and Launch Production."}
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmWon(null)}
                disabled={pending}
                className={SECONDARY}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  const fromDraft = confirmWon === "fromDraft";
                  setConfirmWon(null);
                  markWon(fromDraft);
                }}
                className={PRIMARY}
              >
                {confirmWon === "fromDraft" ? "Mark as Sent and Won" : "Mark Won"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
