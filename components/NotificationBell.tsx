"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { NotificationItem } from "@/lib/notifications";
import { NavGlyph, NavArrow } from "@/components/NavIcons";

/**
 * Premium top-nav bell + slide-in notifications drawer.
 *
 * Receives a server snapshot (count + top items) — no client polling; it
 * refreshes on every navigation since the Nav is a server component. Critical /
 * high-severity items get the Hazard treatment (ink icon + striped rail), so
 * the bell speaks the same "critical" language as the rest of the app.
 */
export function NotificationBell({
  count,
  items,
}: {
  /** Total unread events (capped at 20 by the server helper). */
  count: number;
  /** Top N items for the drawer. */
  items: NotificationItem[];
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"all" | "alerts">("all");
  const rootRef = useRef<HTMLDivElement>(null);
  const hasUnread = count > 0;
  const alertItems = items.filter(
    (it) => it.severity === "critical" || it.severity === "high"
  );
  const shown = tab === "alerts" ? alertItems : items;

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

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
        className={`sx-bell ${open ? "is-open" : ""}`}
        title={hasUnread ? `${count} unread` : "No unread updates"}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {hasUnread && <span className="sx-bdg">{count > 9 ? "9+" : count}</span>}
      </button>

      {open && (
        <div role="menu" className="sx-noti">
          {/* HEAD */}
          <div className="sx-noti-head">
            <div className="sx-noti-top">
              <span className="htxt">
                <span className="lbl">Operational updates</span>
                <span className="sub">
                  {hasUnread ? (
                    <>
                      <b>
                        {count}
                        {count >= 20 ? "+" : ""}
                      </b>{" "}
                      unread update{count === 1 ? "" : "s"}
                    </>
                  ) : (
                    "You're all caught up"
                  )}
                </span>
              </span>
              <Link
                href="/operations"
                onClick={() => setOpen(false)}
                className="sx-noti-open"
              >
                <NavArrow /> Open /operations
              </Link>
            </div>
            <div className="sx-noti-tabs">
              <button
                type="button"
                className={`sx-noti-tab ${tab === "all" ? "on" : ""}`}
                onClick={() => setTab("all")}
              >
                All <span className="tcnt">{items.length}</span>
              </button>
              <button
                type="button"
                className={`sx-noti-tab ${tab === "alerts" ? "on" : ""}`}
                onClick={() => setTab("alerts")}
              >
                Alerts <span className="tcnt">{alertItems.length}</span>
              </button>
            </div>
          </div>

          {/* LIST */}
          {shown.length === 0 ? (
            <div className="sx-noti-empty">
              {tab === "alerts"
                ? "No alerts right now."
                : "No unread updates. You're caught up."}
            </div>
          ) : (
            <div className="sx-noti-list">
              {shown.map((it) => {
                const tag = tagFor(it);
                return (
                  <Link
                    key={it.id}
                    href={it.href}
                    onClick={() => setOpen(false)}
                    className={`sx-noti-item unread ${
                      tag.icon === "hazard" ? "haz" : ""
                    }`}
                  >
                    <span className={`sx-niic ${tag.icon}`}>
                      <NavGlyph name={notifGlyph(it.entityType)} />
                    </span>
                    <span className="sx-nibody">
                      <span className="sx-niref">
                        <span className="rid">
                          <b>{it.entityLabel}</b>
                          {it.clientName ? ` · ${it.clientName}` : ""}
                        </span>
                        <span className={`sx-nitag ${tag.cls}`}>{tag.text}</span>
                      </span>
                      <span className="sx-nititle">
                        <b>{it.eventTypeLabel}</b>{" "}
                        <span className="desc">{it.message}</span>
                      </span>
                      <span className="sx-nitime">
                        {relativeTimeShort(it.sortAt)}
                      </span>
                    </span>
                    <span className="sx-nidot" />
                  </Link>
                );
              })}
            </div>
          )}

          {/* FOOT */}
          <div className="sx-noti-foot">
            <Link
              href="/dashboard"
              onClick={() => setOpen(false)}
              className="vall"
            >
              <NavArrow /> Open Action Center
            </Link>
            <span
              style={{
                marginLeft: "auto",
                fontSize: "12px",
                fontWeight: 600,
                color: "var(--mute)",
              }}
              title="Open an item to mark it read"
            >
              Mark all read
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/** Glyph for a notification by its entity type. */
function notifGlyph(entityType: string): string {
  switch (entityType) {
    case "production_order":
      return "package";
    case "document":
      return "file";
    case "task_list":
      return "list";
    case "client":
      return "users";
    case "project_request":
      return "check";
    default:
      return "dot";
  }
}

/** Contextual tag (text + colour class + icon variant) for a notification.
 *  Update = green (positive), Action = amber (needs input), Alert = hazard. */
function tagFor(it: NotificationItem): {
  text: string;
  cls: string;
  icon: string;
} {
  const hot = it.severity === "critical" || it.severity === "high";
  const s = `${it.eventTypeLabel ?? ""} ${it.message ?? ""}`.toLowerCase();
  if (hot || /delay|late|overdue|behind|blocked|cancel/.test(s))
    return { text: "Alert", cls: "haz", icon: "hazard" };
  if (it.source === "comment" || it.source === "review" || it.source === "message")
    return { text: "Reply", cls: "amb", icon: "amber" };
  if (/request|to enter|awaiting|approval|needs|action/.test(s))
    return { text: "Action", cls: "amb", icon: "amber" };
  if (/received|confirmed|approved|validated|completed|paid|won|deposit/.test(s))
    return { text: "Update", cls: "", icon: "green" };
  return { text: "Update", cls: "amb", icon: "amber" };
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
