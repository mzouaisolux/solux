"use client";

import { useTransition } from "react";

/**
 * Menu-item button that runs a server action and surfaces its error
 * to the user via a window.alert() — visible.
 *
 * Why this exists
 * ---------------
 * Server actions invoked from "use client" components don't propagate
 * thrown errors to error.tsx — Next.js silently swallows them and
 * shows only a tiny "1 error" toast in dev mode. That meant our
 * descriptive "Cannot delete this client — they have N quotations
 * linked. Use 'Archive client' instead..." message never reached the
 * user, even after the action raised it. This component closes that
 * gap: it catches the action's rejection inside useTransition and
 * surfaces the Error.message verbatim.
 *
 * Designed to drop into ContextMenu — visual treatment matches the
 * plain <button> items the menu hosts elsewhere.
 *
 * For irreversible operations, pass `confirmMessage` and the user
 * gets a window.confirm() before the action runs.
 */
export function ContextMenuActionItem({
  action,
  id,
  label,
  pendingLabel,
  confirmMessage,
  variant = "neutral",
}: {
  /** Server action accepting a FormData with `id`. */
  action: (formData: FormData) => Promise<void>;
  /** UUID to send as the `id` field. */
  id: string;
  /** Idle label. */
  label: string;
  /** Optional pending label (defaults to "Working…"). */
  pendingLabel?: string;
  /** If set, user must accept this window.confirm() before the action runs. */
  confirmMessage?: string;
  /**
   * Color treatment:
   *  - neutral: muted grey, for safe ops (archive, restore)
   *  - danger : red, for destructive ops (delete)
   *  - success: emerald, for restore-from-archive style ops
   */
  variant?: "neutral" | "danger" | "success";
}) {
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (pending) return;
    if (confirmMessage && !window.confirm(confirmMessage)) return;

    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", id);
      try {
        await action(fd);
      } catch (err: any) {
        // NEXT_REDIRECT is how Next.js implements server-side redirect
        // — it's not an error, it's the success path. Let it bubble.
        if (err?.digest && String(err.digest).startsWith("NEXT_REDIRECT")) {
          throw err;
        }
        // Everything else: surface the message. window.alert is ugly
        // but it GUARANTEES visibility — the user can't miss it and
        // the existing "1 error" toast no longer leaves them in the
        // dark.
        const msg =
          err?.message ||
          (typeof err === "string" ? err : "Action failed (no message).");
        window.alert(msg);
      }
    });
  }

  const variantClass =
    variant === "danger"
      ? "text-red-600 hover:bg-red-50"
      : variant === "success"
        ? "text-emerald-700 hover:bg-emerald-50"
        : "text-neutral-700 hover:bg-neutral-50";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={`block w-full text-left px-3 py-2 text-xs disabled:opacity-60 disabled:cursor-wait ${variantClass}`}
    >
      {pending ? (pendingLabel ?? "Working…") : label}
    </button>
  );
}
