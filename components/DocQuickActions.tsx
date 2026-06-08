"use client";

import Link from "next/link";
import { useTransition } from "react";
import {
  generateProductionTaskList,
  updateDocumentStatus,
} from "@/app/(app)/documents/[id]/actions";

/**
 * Shared quick-actions row for a quotation. Renders the highest-leverage
 * next step the user can take, based on the doc's status:
 *
 *  - draft → green **Continue editing** link (reopen the builder in
 *            edit-in-place mode). A draft isn't in the lifecycle yet, so
 *            "finish it" is the right next step, not "Mark Won".
 *  - sent/negotiating → **Mark Won** + **Edit → new version**. A sent quote
 *            is never edited in place (we keep the record of what the client
 *            received); after negotiation, "Edit" revises it into the next
 *            version (V2, V3…) — a fresh draft in the same affair.
 *  - won + no task list yet → green **+ Task list** (kicks off generation).
 *  - won + existing task list → outlined **→ Task list** link.
 *  - lost → nothing rendered (terminal state).
 *
 * Used on /documents/[id], /dashboard rows, /clients/[id] rows so the
 * production handoff is always one click away.
 */
type Props = {
  doc: { id: string; status: string };
  /** Pre-resolved by the parent page query — null = no task list exists. */
  taskList: { id: string; number: string | null } | null;
  /** "md" = page header buttons. "sm" = inline list-row buttons. */
  size?: "sm" | "md";
};

export default function DocQuickActions({ doc, taskList, size = "sm" }: Props) {
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

  function makeTaskList() {
    const fd = new FormData();
    fd.set("quotation_id", doc.id);
    // generateProductionTaskList calls redirect() to the new task list.
    startTransition(async () => {
      await generateProductionTaskList(fd);
    });
  }

  // ----- Won -----
  if (doc.status === "won") {
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
    return (
      <button
        type="button"
        onClick={makeTaskList}
        disabled={pending}
        className={`${base} bg-solux text-white hover:bg-solux-dark`}
        title="Generate a production task list from this quotation"
      >
        + Task list
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
          onClick={() => flipStatus("won")}
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
