"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { NotificationItem } from "@/lib/notifications";

/**
 * Top-nav bell icon + dropdown panel summarising unread operational
 * comments for the current user.
 *
 * Receives a snapshot from the server (count + top 10 items) — no
 * client-side polling. The snapshot refreshes naturally on every
 * navigation since the Nav is a server component.
 *
 * Visual rules
 * ------------
 *   - 0 unread → bell shown in muted neutral; click opens "all clear"
 *     dropdown so users get an explicit confirmation.
 *   - ≥1 unread → rose dot badge with the count (capped at "20+").
 *     A subtle pulse on the dot when the count is ≥1.
 *   - Click outside → close.
 *   - ESC → close.
 *   - Click an item → route to entity page (closes panel).
 *
 * Lightweight on purpose — no inline ack/resolve buttons. The
 * dropdown is a "where do I go next?" map, not a workspace. Real
 * action happens on the destination page (drawer + comments live
 * on /operations and entity detail pages).
 */
export function NotificationBell({
  count,
  items,
}: {
  /** Total unread events. Already capped at 20 by the server helper. */
  count: number;
  /** Top N items for the dropdown. */
  items: NotificationItem[];
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const hasUnread = count > 0;

  // Click-outside-to-close — listener active only while open to keep
  // the event surface tiny.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // ESC closes the dropdown.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={
          hasUnread
            ? `${count} unread operational update${count === 1 ? "" : "s"}`
            : "Operational updates"
        }
        aria-expanded={open}
        className={`relative inline-flex items-center justify-center h-8 w-8 rounded-md border transition-colors ${
          hasUnread
            ? "border-rose-200 bg-rose-50/40 text-rose-700 hover:bg-rose-50"
            : "border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50 hover:text-neutral-800"
        }`}
        title={
          hasUnread
            ? `${count} unread operational update${count === 1 ? "" : "s"}`
            : "No unread updates"
        }
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-4 w-4"
          aria-hidden
        >
          <path d="M10 2a1 1 0 0 1 1 1v.07A7.002 7.002 0 0 1 17 10v3.586l1.707 1.707A1 1 0 0 1 18 17H2a1 1 0 0 1-.707-1.707L3 13.586V10a7.002 7.002 0 0 1 6-6.93V3a1 1 0 0 1 1-1Zm-2 16a2 2 0 1 0 4 0H8Z" />
        </svg>
        {hasUnread && (
          <span
            className="absolute -top-1 -right-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-600 px-1 text-[9px] font-bold text-white tabular-nums shadow-sm"
            title={`${count} unread`}
          >
            {count >= 20 ? "20+" : count}
          </span>
        )}
        {hasUnread && (
          // Subtle outer pulse — animate-ping on a separate absolutely
          // positioned element so the badge itself doesn't blur.
          <span
            className="pointer-events-none absolute -top-1 -right-1 inline-flex h-4 w-4 rounded-full bg-rose-400 opacity-40 animate-ping"
            aria-hidden
          />
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-[340px] max-w-[90vw] rounded-lg border border-neutral-200 bg-white shadow-xl z-50 overflow-hidden"
        >
          {/* Header */}
          <div className="px-3 py-2 border-b border-neutral-100 bg-neutral-50/50 flex items-baseline justify-between gap-2">
            <div>
              <div className="text-[10px] uppercase tracking-widerx text-neutral-500 font-semibold">
                Operational updates
              </div>
              <div className="text-[11px] text-neutral-700 mt-0.5">
                {hasUnread
                  ? `${count}${count >= 20 ? "+" : ""} unread update${count === 1 ? "" : "s"}`
                  : "All clear"}
              </div>
            </div>
            <Link
              href="/operations"
              onClick={() => setOpen(false)}
              className="text-[10px] text-neutral-500 hover:text-neutral-900 hover:underline shrink-0"
            >
              Open /operations →
            </Link>
          </div>

          {/* Items */}
          {items.length === 0 ? (
            <div className="px-3 py-6 text-center">
              <p className="text-xs text-neutral-500 italic">
                No unread updates. You&apos;re caught up.
              </p>
            </div>
          ) : (
            <ul className="max-h-[420px] overflow-y-auto divide-y divide-neutral-100">
              {items.map((it) => {
                const badge = badgeFor(it);
                return (
                <li key={it.id}>
                  <Link
                    href={it.href}
                    onClick={() => setOpen(false)}
                    className="block px-3 py-2 hover:bg-rose-50/40 transition-colors"
                  >
                    {/* Row 1: entity ref + client + source badge */}
                    <div className="flex items-center justify-between gap-2 min-w-0">
                      <div className="flex items-baseline gap-1.5 min-w-0">
                        <span className="font-mono text-[10.5px] text-neutral-500 shrink-0">
                          {it.entityLabel}
                        </span>
                        {it.clientName && (
                          <span className="text-[11px] text-neutral-800 font-semibold truncate">
                            · {it.clientName}
                          </span>
                        )}
                      </div>
                      <span
                        className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-widerx border shrink-0 ${badge.cls}`}
                      >
                        <span className={`w-1 h-1 rounded-full ${badge.dot}`} />
                        {badge.text}
                      </span>
                    </div>
                    {/* Row 2: type · message preview */}
                    <div className="mt-0.5 text-[11px] text-neutral-600 truncate">
                      <span className="font-medium text-neutral-700">
                        {it.eventTypeLabel}:
                      </span>{" "}
                      {it.message}
                    </div>
                    {/* Row 3: latest comment preview (comment items only) */}
                    {it.source === "comment" && it.latestCommentPreview && (
                      <div className="mt-1 text-[10px] text-rose-700 italic truncate">
                        💬 {it.latestCommentPreview}
                      </div>
                    )}
                    {/* Row 4: timestamp */}
                    <div className="mt-1 text-[10px] text-neutral-400 tabular-nums">
                      {relativeTimeShort(it.sortAt)}
                    </div>
                  </Link>
                </li>
                );
              })}
            </ul>
          )}
          {/* Footer — task cards (deposit / BL / escalations) live in the
              Action Center; keep it one click away (owner chose not to inline
              them into the bell). */}
          <div className="px-3 py-2 border-t border-neutral-100 bg-neutral-50/50">
            <Link
              href="/dashboard"
              onClick={() => setOpen(false)}
              className="text-[11px] font-medium text-neutral-600 hover:text-neutral-900 hover:underline"
            >
              Open Action Center →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

/** Source-specific badge (label + colour) for a notification row. */
function badgeFor(it: NotificationItem): {
  text: string;
  cls: string;
  dot: string;
} {
  if (it.source === "message") {
    return {
      text: `${it.unreadCount} note${it.unreadCount === 1 ? "" : "s"}`,
      cls: "border-violet-300 bg-violet-100 text-violet-800",
      dot: "bg-violet-600",
    };
  }
  if (it.source === "event") {
    const sev = it.severity;
    const hot = sev === "critical" || sev === "high";
    return {
      text:
        sev === "critical"
          ? "Critical"
          : sev === "high"
          ? "Important"
          : sev === "medium"
          ? "Update"
          : "Info",
      cls: hot
        ? "border-rose-300 bg-rose-100 text-rose-800"
        : "border-amber-300 bg-amber-100 text-amber-800",
      dot: hot ? "bg-rose-600" : "bg-amber-500",
    };
  }
  // comment + review items keep the rose "N new" badge
  return {
    text: `${it.unreadCount} new`,
    cls: "border-rose-300 bg-rose-100 text-rose-800",
    dot: "bg-rose-600",
  };
}

/** Compact relative time matching the OperationsFeed row formatting. */
function relativeTimeShort(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "now";
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", {
    month: "short",
    day: "numeric",
  });
}
