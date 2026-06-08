"use client";

import { useState, useTransition } from "react";
import {
  DOC_STATUSES,
  DOC_STATUS_LABEL,
  type DocStatus,
} from "@/lib/types";
import { updateDocumentStatus } from "@/app/(app)/documents/[id]/actions";

/**
 * One-click status selector for a quotation. Renders as a styled <select>
 * whose color matches the current status (matching StatusBadge). Picking
 * a new option fires the existing `updateDocumentStatus` server action.
 *
 * No save button — every change persists immediately. The native <select>
 * gives mobile/keyboard accessibility for free.
 */
const SELECT_STYLES: Record<DocStatus, string> = {
  draft: "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50",
  sent: "border-sky-300 bg-sky-50 text-sky-800 hover:bg-sky-100",
  negotiating:
    "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100",
  won: "border-emerald-500 bg-emerald-500 text-white hover:bg-emerald-600",
  lost: "border-red-300 bg-red-50 text-red-700 hover:bg-red-100",
  cancelled:
    "border-neutral-200 bg-neutral-50 text-neutral-500 hover:bg-neutral-100",
};

export default function InlineStatusSwitcher({
  docId,
  current,
}: {
  docId: string;
  current: DocStatus;
}) {
  const [pending, startTransition] = useTransition();
  // Local "optimistic" mirror — lets us revert visually if the action
  // throws, so the dropdown shows the value that the server actually
  // accepted.
  const [shown, setShown] = useState<DocStatus>(current);

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as DocStatus;
    if (next === shown) return;
    const previous = shown;
    setShown(next); // optimistic update
    const fd = new FormData();
    fd.set("id", docId);
    fd.set("status", next);
    startTransition(async () => {
      try {
        await updateDocumentStatus(fd);
      } catch (err: any) {
        // Server-side throws (NEXT_REDIRECT, NotFound, capability denied)
        // — NEXT_REDIRECT is success in disguise, re-throw so navigation
        // happens. Everything else is a real error: surface it via alert
        // (the parent <select> lives in a `"use client"` tree, so a thrown
        // error otherwise vanishes into the "1 error" toast like the
        // client-delete bug we fixed earlier).
        if (err?.digest && String(err.digest).startsWith("NEXT_REDIRECT")) {
          throw err;
        }
        setShown(previous); // revert the optimistic flip
        window.alert(err?.message || "Could not change status.");
      }
    });
  }

  return (
    <span className="relative inline-flex items-center">
      <select
        value={shown}
        onChange={handleChange}
        disabled={pending}
        aria-busy={pending}
        className={`appearance-none rounded-full border px-3 py-1 text-xs font-medium cursor-pointer transition-colors disabled:cursor-wait ${
          pending ? "opacity-70" : ""
        } ${SELECT_STYLES[shown]}`}
        style={{
          // While pending: hide the caret (the spinner overlay replaces it).
          // Idle: standard chevron caret.
          backgroundImage: pending
            ? "none"
            : "url(\"data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 12 12'%3e%3cpath stroke='currentColor' stroke-width='1.5' d='m3 5 3 3 3-3'/%3e%3c/svg%3e\")",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 0.5rem center",
          backgroundSize: "0.65em",
          paddingRight: "1.6rem",
        }}
      >
        {DOC_STATUSES.map((s) => (
          <option key={s} value={s}>
            {DOC_STATUS_LABEL[s]}
          </option>
        ))}
      </select>
      {/* Spinner overlay — sits where the caret would be. Pure CSS,
          no z-index gymnastics; pointer-events-none lets clicks pass
          through to the (disabled anyway) select. */}
      {pending && (
        <svg
          className="animate-spin h-3 w-3 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden
        >
          <circle
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="3"
            strokeOpacity="0.25"
          />
          <path
            d="M22 12a10 10 0 0 1-10 10"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>
      )}
    </span>
  );
}
