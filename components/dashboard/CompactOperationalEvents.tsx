"use client";

import Link from "next/link";
import { useState } from "react";
import {
  eventTypeLabel,
  eventEntityHref,
  STATUS_PILL,
  STATUS_LABEL,
  WAITING_FOR_PILL,
  WAITING_FOR_LABEL,
  type EventRow,
  type EventStatus,
  type EventWaitingFor,
} from "@/lib/events-shared";

/**
 * Compact 3-column operational events summary.
 *
 * Designed for the /operations footer: the PO table is the primary
 * artifact, this strip sits below as a "what's been happening" awareness
 * layer that doesn't dominate the page.
 *
 * Layout:
 *   ┌───────────┬───────────┬─────────────┐
 *   │ Critical  │ Production│ Quotations  │
 *   │ (top 5)   │ (top 5)   │ (top 5)     │
 *   └───────────┴───────────┴─────────────┘
 *
 * Each row is a 1-line link to the entity page with `?event=<id>`,
 * which mounts the drawer overlay (same flow as the notification bell).
 * Resolved events are excluded — this is a "things to look at" view,
 * not an audit log.
 *
 * Unread visualisation
 * --------------------
 * Subtle: a small rose dot at the left of the row + slightly bolder
 * primary text. No row-level background — that would re-explode the
 * vertical space. Visible enough for awareness, quiet enough not to
 * scream.
 */

type CategoryKey = "critical" | "production" | "quotations";

const CATEGORY_META: Record<
  CategoryKey,
  { label: string; icon: string; ring: string; tint: string; dot: string }
> = {
  critical: {
    label: "Critical",
    icon: "●",
    ring: "border-rose-200",
    tint: "bg-rose-50/30",
    dot: "text-rose-600",
  },
  production: {
    label: "Production",
    icon: "◆",
    ring: "border-sky-200",
    tint: "bg-sky-50/20",
    dot: "text-sky-600",
  },
  quotations: {
    label: "Quotations",
    icon: "▤",
    ring: "border-neutral-200",
    tint: "bg-white",
    dot: "text-neutral-600",
  },
};

/** Map event into one of the 3 visible buckets. Resolved → null (skip). */
function categorize(e: EventRow): CategoryKey | null {
  const status = (e.status ?? "open") as EventStatus;
  if (status === "resolved") return null;

  // Anything flagged critical AND not resolved → Critical column.
  if (e.severity === "critical") return "critical";

  const t = e.event_type;
  if (t.startsWith("po.") || t.startsWith("tl.")) return "production";
  if (t.startsWith("doc.") || t.startsWith("client.")) return "quotations";
  return "production"; // default catch-all
}

/** Urgency rank — lower = more urgent (renders first). */
function urgencyRank(e: EventRow): number {
  const status = (e.status ?? "open") as EventStatus;
  // Escalated jumps to top (needs management).
  if (status === "escalated") return 0;
  if (status === "open") return 1;
  if (status === "acknowledged") return 2;
  if (status === "working") return 3;
  if (status === "waiting") return 4;
  return 9;
}

const MAX_PER_CATEGORY = 5;

export function CompactOperationalEvents({
  events,
  commentCountByEvent,
  unreadCountByEvent,
}: {
  events: EventRow[];
  commentCountByEvent?: Record<string, number>;
  unreadCountByEvent?: Record<string, number>;
}) {
  // Bucket + sort.
  const byCategory: Record<CategoryKey, EventRow[]> = {
    critical: [],
    production: [],
    quotations: [],
  };
  for (const e of events) {
    const cat = categorize(e);
    if (cat) byCategory[cat].push(e);
  }
  for (const k of Object.keys(byCategory) as CategoryKey[]) {
    byCategory[k].sort((a, b) => {
      const pa = urgencyRank(a);
      const pb = urgencyRank(b);
      if (pa !== pb) return pa - pb;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }

  const totalOpen =
    byCategory.critical.length +
    byCategory.production.length +
    byCategory.quotations.length;

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-3 space-y-2.5">
      {/* Compact header bar */}
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-widerx text-neutral-500">
            Operational events
          </div>
          <p className="text-[10px] text-neutral-500 mt-0.5">
            {totalOpen === 0
              ? "No open events. Everything is on track."
              : `${totalOpen} open event${totalOpen === 1 ? "" : "s"} across categories — click any row to open the conversation thread on its entity page.`}
          </p>
        </div>
      </div>

      {/* 3 columns */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {(Object.keys(byCategory) as CategoryKey[]).map((cat) => (
          <Column
            key={cat}
            category={cat}
            events={byCategory[cat]}
            commentCountByEvent={commentCountByEvent}
            unreadCountByEvent={unreadCountByEvent}
          />
        ))}
      </div>
    </section>
  );
}

function Column({
  category,
  events,
  commentCountByEvent,
  unreadCountByEvent,
}: {
  category: CategoryKey;
  events: EventRow[];
  commentCountByEvent?: Record<string, number>;
  unreadCountByEvent?: Record<string, number>;
}) {
  const meta = CATEGORY_META[category];
  // "+N more" toggles the column between collapsed (top 5) and
  // expanded (all events, with internal scroll past ~10). Per-column
  // state lives client-side — no URL plumbing, no extra fetch since
  // the parent already has every event.
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? events : events.slice(0, MAX_PER_CATEGORY);
  const overflow = expanded
    ? 0
    : Math.max(0, events.length - MAX_PER_CATEGORY);
  const totalUnread = events.reduce(
    (s, e) => s + (unreadCountByEvent?.[e.id] ?? 0),
    0
  );

  return (
    <div
      className={`rounded-lg border-2 ${meta.ring} ${meta.tint} flex flex-col overflow-hidden shadow-sm hover:shadow-md transition-shadow`}
    >
      {/* Column header — slightly stronger so the whole card reads as
          one cohesive interactive surface. */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b-2 border-neutral-200/60 bg-white/50">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={`text-base leading-none ${meta.dot}`}
            aria-hidden
          >
            {meta.icon}
          </span>
          <span className="text-[11px] font-bold uppercase tracking-widerx text-neutral-800">
            {meta.label}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[11px] font-bold tabular-nums text-neutral-700">
            {events.length}
          </span>
          {totalUnread > 0 && (
            <span
              className="inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full bg-rose-100 text-rose-700 text-[10px] font-bold tabular-nums border border-rose-200"
              title={`${totalUnread} unread comment${totalUnread === 1 ? "" : "s"}`}
            >
              {totalUnread}
            </span>
          )}
        </div>
      </div>

      {/* Rows */}
      {visible.length === 0 ? (
        <div className="px-2.5 py-3 text-center">
          <p className="text-[10px] text-neutral-400 italic">
            All clear in this category.
          </p>
        </div>
      ) : (
        <ul
          // When expanded, cap the column height so a category with
          // many open events doesn't blow up the page; scroll inside.
          className={`divide-y divide-neutral-100 bg-white ${
            expanded && events.length > 10 ? "max-h-[420px] overflow-y-auto" : ""
          }`}
        >
          {visible.map((e) => (
            <CompactEventLink
              key={e.id}
              event={e}
              commentCount={commentCountByEvent?.[e.id] ?? 0}
              unreadCount={unreadCountByEvent?.[e.id] ?? 0}
            />
          ))}
        </ul>
      )}

      {/* Expand / collapse footer — clickable, with clear affordance.
          "+N more" shows when collapsed and there are hidden events;
          "Show less" shows when expanded. Renders nothing when there's
          nothing to toggle. */}
      {overflow > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="group flex w-full items-center justify-between gap-2 px-3 py-1.5 border-t border-neutral-200/60 bg-neutral-50/80 hover:bg-neutral-100 cursor-pointer transition-colors"
          aria-expanded={false}
          title={`Show all ${events.length} open in ${meta.label.toLowerCase()}`}
        >
          <span className="text-[10px] font-semibold text-neutral-700 group-hover:text-neutral-900">
            +{overflow} more open in {meta.label.toLowerCase()}
          </span>
          <span
            className="text-[11px] leading-none text-neutral-400 group-hover:text-neutral-800 group-hover:translate-y-0.5 transition-all"
            aria-hidden
          >
            ▾
          </span>
        </button>
      ) : expanded && events.length > MAX_PER_CATEGORY ? (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="group flex w-full items-center justify-between gap-2 px-3 py-1.5 border-t border-neutral-200/60 bg-neutral-50/80 hover:bg-neutral-100 cursor-pointer transition-colors"
          aria-expanded={true}
          title="Collapse to top 5"
        >
          <span className="text-[10px] font-semibold text-neutral-600 group-hover:text-neutral-900">
            Show less
          </span>
          <span
            className="text-[11px] leading-none text-neutral-400 group-hover:text-neutral-800 group-hover:-translate-y-0.5 transition-all"
            aria-hidden
          >
            ▴
          </span>
        </button>
      ) : null}
    </div>
  );
}

function CompactEventLink({
  event,
  commentCount,
  unreadCount,
}: {
  event: EventRow;
  commentCount: number;
  unreadCount: number;
}) {
  const status = (event.status ?? "open") as EventStatus;
  const waitingFor = (event.waiting_for ?? null) as EventWaitingFor | null;
  const hasUnread = unreadCount > 0;
  const showWaitingForPill = status === "waiting" && waitingFor;
  const entityHref = eventEntityHref(event);
  // Route to the entity page with the drawer auto-opened — same flow
  // as the notification bell. The compact summary is just the entry
  // point; full conversation context lives on the entity page.
  const href = entityHref ? `${entityHref}?event=${event.id}` : "#";

  return (
    <li>
      <Link
        href={href}
        className={`group block px-3 py-2 cursor-pointer transition-all border-l-2 ${
          hasUnread
            ? "bg-rose-50/40 border-l-rose-400 hover:bg-rose-50 hover:border-l-rose-600"
            : "border-l-transparent hover:bg-neutral-100/80 hover:border-l-neutral-400"
        }`}
        title={`Open conversation: ${event.message}`}
      >
        <div className="flex items-center gap-2 min-w-0">
          {/* Subtle unread dot — small but visible */}
          <span
            className={`shrink-0 w-1.5 h-1.5 rounded-full ${
              hasUnread ? "bg-rose-600" : "bg-transparent"
            }`}
            aria-hidden
          />
          <span
            className={`text-[11px] truncate flex-1 min-w-0 ${
              hasUnread ? "font-semibold text-neutral-900" : "text-neutral-800"
            }`}
            title={`${eventTypeLabel(event.event_type)}: ${event.message}`}
          >
            <span className="text-neutral-500 mr-0.5">
              {eventTypeLabel(event.event_type)}:
            </span>
            {event.message}
          </span>
          {/* Right side: status pill + comment count + time + chevron */}
          <div className="flex items-center gap-1 shrink-0">
            {showWaitingForPill ? (
              <span
                className={`inline-flex items-center px-1 py-0 rounded text-[9px] font-semibold uppercase tracking-widerx border ${WAITING_FOR_PILL[waitingFor!]}`}
                title={WAITING_FOR_LABEL[waitingFor!]}
              >
                {WAITING_FOR_LABEL[waitingFor!].replace("Waiting ", "")}
              </span>
            ) : status !== "open" ? (
              <span
                className={`inline-flex items-center px-1 py-0 rounded text-[9px] font-semibold uppercase tracking-widerx border ${STATUS_PILL[status]}`}
                title={STATUS_LABEL[status]}
              >
                {STATUS_LABEL[status]}
              </span>
            ) : null}
            {commentCount > 0 && (
              <span
                className={`text-[9px] tabular-nums font-medium ${
                  hasUnread ? "text-rose-700" : "text-neutral-500"
                }`}
                title={
                  hasUnread
                    ? `${commentCount} comment${commentCount === 1 ? "" : "s"} · ${unreadCount} unread for you`
                    : `${commentCount} comment${commentCount === 1 ? "" : "s"}`
                }
              >
                💬{commentCount}
              </span>
            )}
            <span className="text-[9px] tabular-nums text-neutral-400">
              {relTime(event.created_at)}
            </span>
            {/* Affordance chevron — always reserved, dims by default
                and brightens + slides on hover so the row's
                interactivity reads instantly. */}
            <span
              className="text-[11px] leading-none text-neutral-300 group-hover:text-neutral-700 group-hover:translate-x-0.5 transition-all shrink-0"
              aria-hidden
            >
              →
            </span>
          </div>
        </div>
      </Link>
    </li>
  );
}

/** Ultra-compact relative time: "5m", "3h", "2d", "Apr 18". */
function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "now";
  const m = Math.floor(ms / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString("en-GB", {
    month: "short",
    day: "numeric",
  });
}
