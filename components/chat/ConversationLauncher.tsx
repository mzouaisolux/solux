"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { resolveConversationContext } from "@/lib/conversation-context";
import { ConversationDrawer } from "./ConversationDrawer";

/**
 * Floating conversation launcher — bottom-right, persistent across
 * EVERY workspace route so the communication tool is always within
 * reach (previously it vanished on list pages / the dashboard, which
 * made it feel hidden).
 *
 * Behaviour
 * ---------
 * - On a record detail route (document / task list / production order /
 *   client) the button opens the contextual thread for that record and
 *   shows an unread badge.
 * - On any other route there's no record to attach a thread to (A1),
 *   so the button opens a short guidance panel pointing the user to a
 *   record. (Free-standing topics arrive in A2.)
 *
 * Mounted ONCE in `app/(app)/layout.tsx`.
 */
export function ConversationLauncher() {
  const pathname = usePathname();
  const ctx = resolveConversationContext(pathname);
  const router = useRouter();
  const searchParams = useSearchParams();

  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  /* ───── Fetch unread count on entity change + on drawer close ───── */
  const refreshUnread = useCallback(async () => {
    if (!ctx) {
      setUnread(0);
      return;
    }
    try {
      const r = await fetch(
        `/api/conversations/${ctx.entityType}/${ctx.entityId}`,
        { cache: "no-store" }
      );
      if (!r.ok) return;
      const data = (await r.json()) as { unread?: number };
      setUnread(data.unread ?? 0);
    } catch {
      /* soft-fail */
    }
  }, [ctx]);

  useEffect(() => {
    if (!ctx) {
      setUnread(0);
      return;
    }
    refreshUnread();
  }, [ctx?.entityType, ctx?.entityId, refreshUnread]);

  /* ───── Auto-open from a ?chat=1 deep-link (a "note" bell item) ─────
     Open the contextual drawer once on arrival, then strip the param so a
     refresh / back-nav doesn't keep re-opening it. */
  useEffect(() => {
    if (searchParams.get("chat") !== "1" || !ctx) return;
    setOpen(true);
    const next = new URLSearchParams(searchParams.toString());
    next.delete("chat");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [searchParams, ctx?.entityType, ctx?.entityId, pathname, router]);

  const hasContext = !!ctx;

  return (
    <>
      <button
        type="button"
        aria-label={
          unread > 0
            ? `Open conversation (${unread} unread)`
            : "Open conversation"
        }
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-30 inline-flex items-center gap-2 rounded-full bg-neutral-900 text-white shadow-lg hover:bg-neutral-800 active:scale-95 transition-all h-12 pl-3.5 pr-4"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5 shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M21 12a8 8 0 0 1-11.6 7.15L4 20l1-4.2A8 8 0 1 1 21 12z" />
        </svg>
        <span className="text-[13px] font-medium">Messages</span>
        {unread > 0 && (
          <span
            aria-hidden
            className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-semibold tabular-nums grid place-items-center ring-2 ring-white"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {hasContext && ctx ? (
        <ConversationDrawer
          entityType={ctx.entityType}
          entityId={ctx.entityId}
          open={open}
          onClose={() => {
            setOpen(false);
            setTimeout(refreshUnread, 250);
          }}
          onCountsChanged={(n) => setUnread(n)}
        />
      ) : (
        <NoContextDrawer open={open} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

/**
 * Shown when the launcher is opened on a route with no record context.
 * Keeps the comms tool present + discoverable everywhere, and explains
 * how to start a conversation (it's attached to a specific record).
 */
function NoContextDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      <div
        aria-hidden={!open}
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-neutral-900/20 backdrop-blur-[2px] transition-opacity ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        aria-hidden={!open}
        aria-label="Conversations"
        className={`fixed top-0 right-0 z-50 h-[100dvh] w-full max-w-md bg-white border-l border-neutral-200 shadow-2xl flex flex-col transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="shrink-0 px-4 py-3 border-b border-neutral-200 flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-medium">
              Conversations
            </div>
            <h2 className="text-sm font-semibold text-neutral-900">
              Pick something to discuss
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-900 transition-colors p-1 -m-1"
            aria-label="Close"
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          <p className="text-xs text-neutral-600 leading-relaxed">
            Conversations are attached to a specific record so the whole
            team keeps the discussion in context. Open a quotation, task
            list, production order or client, then tap{" "}
            <span className="font-medium text-neutral-800">Messages</span> to
            chat about it.
          </p>
          <div className="mt-4 space-y-2">
            <Link
              href="/clients"
              onClick={onClose}
              className="flex items-center justify-between rounded-md border border-neutral-200 px-3 py-2.5 text-sm text-neutral-800 hover:bg-neutral-50"
            >
              <span>Clients &amp; quotations</span>
              <span className="text-neutral-400">→</span>
            </Link>
            <Link
              href="/task-lists"
              onClick={onClose}
              className="flex items-center justify-between rounded-md border border-neutral-200 px-3 py-2.5 text-sm text-neutral-800 hover:bg-neutral-50"
            >
              <span>Task lists</span>
              <span className="text-neutral-400">→</span>
            </Link>
            <Link
              href="/operations"
              onClick={onClose}
              className="flex items-center justify-between rounded-md border border-neutral-200 px-3 py-2.5 text-sm text-neutral-800 hover:bg-neutral-50"
            >
              <span>Operations feed</span>
              <span className="text-neutral-400">→</span>
            </Link>
          </div>
        </div>
      </aside>
    </>
  );
}
