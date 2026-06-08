"use client";

import { useTransition } from "react";

/**
 * Generic "destructive action" button — red, with a confirm prompt.
 *
 * Wraps a server action that takes a FormData with `id`. Prompts the
 * user with window.confirm() before invoking, so a misclick can't
 * permanently delete a record.
 *
 * Use for irreversible operations (delete row, etc.). For reversible
 * operations like archive/cancel, prefer a plain form without
 * confirmation — they can be undone.
 */
export function DangerDeleteButton({
  action,
  id,
  label,
  confirmMessage,
  size = "md",
}: {
  /** Server action that accepts a FormData with `id`. */
  action: (formData: FormData) => Promise<void>;
  /** The id value to send. */
  id: string;
  /** Button label, e.g. "Delete task list". */
  label: string;
  /** Confirm dialog text. */
  confirmMessage: string;
  size?: "sm" | "md";
}) {
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (pending) return;
    if (!window.confirm(confirmMessage)) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", id);
      await action(fd);
    });
  }

  const padding =
    size === "sm"
      ? "px-2.5 py-1 text-[11px]"
      : "px-3 py-1.5 text-xs";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={`inline-flex items-center gap-1.5 rounded-md border border-rose-300 bg-rose-50 font-semibold text-rose-700 hover:bg-rose-100 hover:border-rose-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${padding}`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className="h-3 w-3"
        aria-hidden
      >
        <path
          fillRule="evenodd"
          d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443a44 44 0 0 0-1.998.15.75.75 0 1 0 .12 1.495l.158-.012 1.187 12.078A2.25 2.25 0 0 0 7.708 20h4.584a2.25 2.25 0 0 0 2.24-2.096l1.188-12.078.158.012a.75.75 0 0 0 .12-1.495 44 44 0 0 0-1.998-.15v-.443A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4Z"
          clipRule="evenodd"
        />
      </svg>
      {pending ? "Deleting…" : label}
    </button>
  );
}
