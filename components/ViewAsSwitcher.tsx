"use client";

import { useEffect, useRef, useState } from "react";
import {
  ROLE_LABEL,
  VIEW_AS_ROLES,
  type Role,
} from "@/lib/types";
import {
  clearViewAsRole,
  setViewAsRole,
} from "@/app/(app)/view-as/actions";

/**
 * Super-admin-only dropdown that picks which role the UI should render as.
 * Calls into the `setViewAsRole` server action, which writes a cookie and
 * revalidates the layout. Backend permissions are unaffected.
 *
 * Implementation notes
 * --------------------
 * Previously used `useTransition` to manage the pending state, but in
 * React 18 `startTransition(async () => …)` is an anti-pattern: the
 * async callback fires-and-forgets, and the `pending` flag can stick
 * to true if the server action revalidates the layout (which re-renders
 * this component while the old transition is still pending).
 *
 * That left the toggle button **permanently disabled** after the first
 * role switch, which manifested as "clicking the button does nothing".
 * Switching to plain `useState` removes the ambiguity:
 *   - submitting → tracks "we're calling the server action"
 *   - the toggle button is NEVER disabled (you can always re-open the menu)
 *   - only the menu items are disabled while a switch is in flight
 *
 * Also added: click-outside to close (avoids the menu sticking open when
 * the user clicks away).
 */
export default function ViewAsSwitcher({
  realRole,
  effectiveRole,
  isSimulating,
}: {
  realRole: Role;
  effectiveRole: Role;
  isSimulating: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Click-outside-to-close. The dropdown is rendered via `{open && (...)}`
  // so we wire the listener only while open — keeps the event surface
  // minimal and avoids leaking listeners.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  // ESC to close — small accessibility win.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  async function pick(role: Role) {
    if (submitting) return;
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.set("role", role);
      await setViewAsRole(fd);
      setOpen(false);
    } catch (err) {
      // Surface to console — the layout revalidation will reflect the
      // (un)changed state anyway. Swallowing the error here keeps the UI
      // from white-screening if the server action throws.
      console.error("[ViewAsSwitcher] setViewAsRole failed:", err);
    } finally {
      setSubmitting(false);
    }
  }

  async function reset() {
    if (submitting) return;
    setSubmitting(true);
    try {
      await clearViewAsRole();
      setOpen(false);
    } catch (err) {
      console.error("[ViewAsSwitcher] clearViewAsRole failed:", err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        // IMPORTANT: never disable the toggle. The toggle is purely
        // client-side state; disabling it on `submitting` was the root
        // cause of the "clicking does nothing" regression.
        aria-haspopup="menu"
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ${
          isSimulating
            ? "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100"
            : "border-[#34341f] bg-[rgba(85,255,126,0.08)] text-[#E9F7ED] hover:bg-[rgba(85,255,126,0.14)]"
        }`}
        title="Preview the UI as another role — does not affect backend permissions."
      >
        <span className="text-base leading-none">👁</span>
        {isSimulating ? (
          <>
            Viewing as <b className="font-semibold">{ROLE_LABEL[effectiveRole]}</b>
          </>
        ) : (
          <>View As</>
        )}
        <span className="text-neutral-400">▾</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-1 w-56 rounded-md border border-neutral-200 bg-white shadow-lg z-50 overflow-hidden"
        >
          <div className="px-3 py-2 border-b border-neutral-100 bg-neutral-50">
            <div className="text-[10px] uppercase tracking-widerx text-neutral-500 font-semibold">
              Dev simulator
            </div>
            <div className="text-[11px] text-neutral-600 leading-snug mt-0.5">
              Frontend only — backend stays as <b>{ROLE_LABEL[realRole]}</b>.
            </div>
          </div>
          <ul className="py-1">
            {VIEW_AS_ROLES.map((r) => {
              const active = r === effectiveRole;
              return (
                <li key={r}>
                  <button
                    type="button"
                    onClick={() => pick(r)}
                    disabled={submitting}
                    role="menuitemradio"
                    aria-checked={active}
                    className={`flex w-full items-center justify-between px-3 py-1.5 text-xs disabled:opacity-50 ${
                      active
                        ? "bg-solux/10 text-neutral-900 font-medium"
                        : "text-neutral-700 hover:bg-neutral-50"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-sm">
                        {r === "super_admin"
                          ? "★"
                          : r === "admin"
                            ? "◆"
                            : r === "task_list_manager"
                              ? "⚙"
                              : r === "operations"
                                ? "⚒"
                                : "•"}
                      </span>
                      {ROLE_LABEL[r]}
                    </span>
                    {active && (
                      <span className="text-emerald-600 text-sm">✓</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          {isSimulating && (
            <div className="border-t border-neutral-100 px-2 py-1.5">
              <button
                type="button"
                onClick={reset}
                disabled={submitting}
                className="w-full text-left text-[11px] text-neutral-500 hover:text-neutral-900 hover:underline px-1 disabled:opacity-50"
              >
                ← Reset to my real role
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
