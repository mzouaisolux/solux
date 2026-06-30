"use client";

import { useState, useTransition } from "react";
import { startWithoutDeposit } from "@/app/(app)/production/orders/actions";

/**
 * Deposit-override button.
 *
 * Renders a small "Start without deposit" button. When clicked, expands
 * inline to show a REQUIRED reason field + explicit Confirm action.
 * The reason is mandatory (audit 2026-06-11 P0) — the server action
 * rejects empty reasons too; this UI just surfaces the rule early.
 *
 * Why inline (not a modal)?
 * - Keeps the UI light — no portal/overlay machinery.
 * - The confirmation is unambiguous because the user has to click a
 *   second button labelled "Confirm: start production".
 * - Easy to dismiss with Cancel.
 *
 * Backend gating is the source of truth: even if a sales user crafts
 * a request that hits the action, `requireAdmin()` rejects it.
 *
 * Mounting rule (set by the parent page):
 *   - status === 'awaiting_deposit'
 *   - deposit_override_at IS NULL
 *   - caller is admin/super_admin
 * If any of those drop, the button shouldn't be rendered at all.
 */
export function StartWithoutDepositButton({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startActionTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    const trimmed = reason.trim();
    if (!trimmed) {
      setError(
        "A reason is required — record why production starts before the deposit (e.g. trusted client, written approval)."
      );
      return;
    }
    const fd = new FormData();
    fd.set("id", orderId);
    fd.set("reason", trimmed);
    startActionTransition(async () => {
      try {
        await startWithoutDeposit(fd);
        setOpen(false);
        setReason("");
      } catch (e: any) {
        setError(e?.message ?? "Failed to activate override.");
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-900 hover:bg-amber-100 transition-colors"
        title="Manually launch production before the deposit is received. Use for trusted long-term clients only."
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
            d="M8.485 2.495c.667-1.32 2.363-1.32 3.03 0l6.28 12.43c.6 1.187-.237 2.575-1.515 2.575H3.72c-1.278 0-2.115-1.388-1.515-2.575l6.28-12.43ZM10 6a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 6Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
            clipRule="evenodd"
          />
        </svg>
        Start without deposit
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50/50 p-3 space-y-2 max-w-md">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-widerx text-amber-900">
          Confirm exception
        </div>
        <p className="text-xs text-amber-900 mt-0.5 leading-relaxed">
          You&apos;re about to launch production <b>before</b> the deposit
          is received. This is a manual business exception — typically
          used only for long-term trusted clients. The action is logged
          and visible to sales, admin and management.
        </p>
      </div>
      <label className="block">
        <span className="text-[11px] font-semibold text-neutral-700">
          Reason <span className="font-normal text-neutral-500">(required)</span>
        </span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. 5-year trusted client, CFO approval verbal"
          rows={2}
          disabled={pending}
          className="mt-1 w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-xs disabled:bg-neutral-50"
        />
      </label>
      {error && (
        <div className="rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-[11px] text-rose-700">
          {error}
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setReason("");
            setError(null);
          }}
          disabled={pending}
          className="rounded-md border border-neutral-200 bg-white px-2.5 py-1 text-[11px] font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending || !reason.trim()}
          title={
            !reason.trim() ? "Enter a reason first — it's required." : undefined
          }
          className="rounded-md bg-amber-900 px-3 py-1 text-[11px] font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
        >
          {pending ? "Confirming…" : "Confirm: start production"}
        </button>
      </div>
    </div>
  );
}

/**
 * Read-only badge that surfaces an active deposit override.
 *
 * Use anywhere the order is rendered (table rows, detail header,
 * dashboard widgets) so the exception is unmistakable.
 */
export function DepositOverrideBadge({
  activatedAt,
  reason,
  size = "sm",
}: {
  activatedAt: string;
  reason?: string | null;
  size?: "xs" | "sm";
}) {
  const padding =
    size === "xs"
      ? "px-1.5 py-0.5 text-[10px]"
      : "px-2 py-0.5 text-[11px]";
  const date = new Date(activatedAt).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    year: "2-digit",
  });
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 font-semibold text-amber-900 ${padding}`}
      title={`Production started without deposit on ${date}${reason ? ` — ${reason}` : ""}`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className="h-2.5 w-2.5"
        aria-hidden
      >
        <path
          fillRule="evenodd"
          d="M8.485 2.495c.667-1.32 2.363-1.32 3.03 0l6.28 12.43c.6 1.187-.237 2.575-1.515 2.575H3.72c-1.278 0-2.115-1.388-1.515-2.575l6.28-12.43Z"
          clipRule="evenodd"
        />
      </svg>
      No deposit
    </span>
  );
}
