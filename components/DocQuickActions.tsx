"use client";

import Link from "next/link";
import { useTransition } from "react";
import {
  launchProduction,
  updateDocumentStatus,
} from "@/app/(app)/documents/[id]/actions";

/**
 * Shared quick-actions row for a quotation. Renders the highest-leverage
 * next step the user can take, based on the doc's status:
 *
 *  - has a task list already → outlined **→ Task list** link (covers the
 *            proforma "command" page, which owns the task list).
 *  - draft → green **Continue editing** link (reopen the builder in
 *            edit-in-place mode). A draft isn't in the lifecycle yet, so
 *            "finish it" is the right next step, not "Mark Won".
 *  - sent/negotiating → **Mark Won** + **Edit → new version**. A sent quote
 *            is never edited in place (we keep the record of what the client
 *            received); after negotiation, "Edit" revises it into the next
 *            version (V2, V3…) — a fresh draft in the same affair.
 *  - won + not launched → green **🚀 Launch Production** (creates the proforma
 *            command + production task list in the background, then opens it —
 *            the commercial never touches proforma mechanics).
 *  - won + already launched → outlined **→ View command** link (the proforma).
 *  - lost → nothing rendered (terminal state).
 *
 * Used on /documents/[id], /dashboard rows, /clients/[id] rows so the
 * production handoff is always one click away.
 */
type Props = {
  doc: { id: string; status: string; type?: string };
  /** Pre-resolved by the parent page query — null = no task list exists. */
  taskList: { id: string; number: string | null } | null;
  /** For a WON quotation: the proforma "command" launched from it (if any). */
  command?: { id: string; number: string | null } | null;
  /** "md" = page header buttons. "sm" = inline list-row buttons. */
  size?: "sm" | "md";
};

export default function DocQuickActions({
  doc,
  taskList,
  command = null,
  size = "sm",
}: Props) {
  const [pending, startTransition] = useTransition();

  const base =
    size === "md"
      ? "inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-sm font-semibold shadow-sm transition-colors disabled:opacity-50"
      : "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50";

  function flipStatus(next: string) {
    const fd = new FormData();
    fd.set("id", doc.id);
    fd.set("status", next);
    startTransition(async () => {
      await updateDocumentStatus(fd);
    });
  }

  function launchProd() {
    const fd = new FormData();
    fd.set("quotation_id", doc.id);
    // launchProduction creates the proforma command + task list, then
    // redirect()s to the task list. Re-throw the redirect; surface real
    // errors (e.g. a lifecycle guard) as an alert instead of a crash.
    startTransition(async () => {
      try {
        await launchProduction(fd);
      } catch (err: any) {
        if (err?.digest && String(err.digest).startsWith("NEXT_REDIRECT")) {
          throw err;
        }
        window.alert(err?.message || "Could not launch production.");
      }
    });
  }

  // ----- Already in production → straight to the task list -----
  // Covers the proforma "command" page (the draft proforma that owns the task
  // list) and any doc whose production has already started.
  if (taskList) {
    return (
      <Link
        href={`/task-lists/${taskList.id}`}
        className={`${base} border border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50`}
        title={`Open ${taskList.number ?? "task list"}`}
      >
        → Task list
      </Link>
    );
  }

  // ----- Won quotation -----
  if (doc.status === "won") {
    // Already launched → point to the command (proforma) where production lives.
    if (command) {
      return (
        <Link
          href={`/documents/${command.id}`}
          className={`${base} border border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50`}
          title={`Open the production command ${command.number ?? ""}`}
        >
          → View command
        </Link>
      );
    }
    // Not launched yet → one-click handoff (creates proforma + task list).
    return (
      <button
        type="button"
        onClick={launchProd}
        disabled={pending}
        className={`${base} bg-solux text-white hover:bg-solux-dark`}
        title="Create the proforma command and production task list, then open it"
      >
        {pending ? "Launching…" : "🚀 Launch Production"}
      </button>
    );
  }

  // ----- Draft — work in progress: resume the builder, don't "win" yet -
  if (doc.status === "draft") {
    return (
      <Link
        href={`/documents/new?edit=${doc.id}`}
        className={`${base} bg-solux text-white hover:bg-solux-dark`}
        title="Continue editing this draft quotation"
      >
        Continue editing
      </Link>
    );
  }

  // ----- Sent / negotiating — Mark Won + Edit (revise into a new version) -
  // A sent quotation must NOT be edited in place — the sent version is the
  // record of what the client received. After negotiation, "Edit" creates
  // the NEXT version (V2, V3…): a fresh draft in the same affair via the
  // revise flow, leaving the original intact for history.
  if (doc.status === "sent" || doc.status === "negotiating") {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => {
            // Confirm — marking Won records revenue and unlocks Launch Production;
            // a mis-click here has real commercial consequences.
            if (
              window.confirm(
                "Mark this quotation as WON?\n\nThis records the deal as revenue and unlocks Launch Production."
              )
            )
              flipStatus("won");
          }}
          disabled={pending}
          className={`${base} bg-solux text-white hover:bg-solux-dark`}
          title="Mark this quotation as won"
        >
          {pending ? "Saving…" : "Mark Won"}
        </button>
        <Link
          href={`/documents/new?revise=${doc.id}`}
          className={`${base} border border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50`}
          title="Edit after client negotiation — creates the next version (V2, V3…). The sent version is preserved."
        >
          {size === "md" ? "Edit → new version" : "Revise"}
        </Link>
      </div>
    );
  }

  // ----- Lost / cancelled / unknown — terminal, no quick action -----
  return null;
}
