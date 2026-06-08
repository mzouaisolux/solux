"use client";

import { useMemo, useState } from "react";
import {
  SEVERITY_DOT,
  STATUS_PILL,
  STATUS_LABEL,
  WAITING_FOR_LABEL,
  WAITING_FOR_PILL,
  eventTypeLabel,
  type EventRow,
  type EventComment,
  type EventSeverity,
  type EventStatus,
  type EventWaitingFor,
} from "@/lib/events-shared";
import { EventDetailDrawer } from "./EventDetailDrawer";

/**
 * Operations Feed — operational command center, not an activity log.
 *
 * Design rules (per UI refinement spec):
 *   1. DEFAULT VIEW = "Action required" — open events only, not the
 *      full history. The dashboard mustn't drown the user in resolved
 *      noise; resolved/acknowledged events live behind a fold.
 *   2. PRIORITY ORDER — within a category, sort by status (open ahead
 *      of acknowledged ahead of waiting ahead of resolved), then by
 *      severity (critical → low), then by recency.
 *   3. CATEGORIES — events are bucketed into Critical / Production /
 *      Payments / Shipping / Quotations / Task lists / Other. A
 *      category renders a card only if it has events; categories with
 *      ≥1 open events are expanded, categories with only resolved
 *      events are collapsed by default.
 *   4. COMPACT ROWS — single-line message + inline metadata. Comment
 *      preview becomes a single italic line. Whole row is half the
 *      vertical space of the v1 implementation.
 *   5. RESOLVED TAIL — every resolved event in the current filter
 *      bucket lands in a single "Recently resolved" collapsible at the
 *      bottom. Always collapsed by default; expands to show all.
 *   6. ALL mode caps each category at top N (default 4) with a
 *      "+N more" expand toggle. Action-required mode shows every
 *      open event (rarely many in practice).
 *
 * Filter / state:
 *   - mode: "action_required" (default) | "all"
 *   - expandedFull: set of category keys that show all events (not
 *     capped). Action-required mode ignores the cap entirely.
 *   - resolvedOpen: bottom resolved tail expand toggle
 */

type FilterMode = "action_required" | "all";

type CategoryKey =
  | "critical"
  | "production"
  | "payments"
  | "shipping"
  | "documents"
  | "tasks"
  | "other";

const CATEGORY_ORDER: CategoryKey[] = [
  "critical",
  "production",
  "payments",
  "shipping",
  "documents",
  "tasks",
  "other",
];

const CATEGORY_META: Record<
  CategoryKey,
  { label: string; icon: string; ring: string; tint: string; dot: string }
> = {
  // Critical: rose. Always at the top of the feed.
  critical: {
    label: "Critical",
    icon: "●",
    ring: "border-rose-200",
    tint: "bg-rose-50/60",
    dot: "text-rose-600",
  },
  production: {
    label: "Production",
    icon: "◆",
    ring: "border-sky-200",
    tint: "bg-sky-50/40",
    dot: "text-sky-600",
  },
  payments: {
    label: "Payments",
    icon: "$",
    ring: "border-emerald-200",
    tint: "bg-emerald-50/40",
    dot: "text-emerald-600",
  },
  shipping: {
    label: "Shipping",
    icon: "→",
    ring: "border-violet-200",
    tint: "bg-violet-50/40",
    dot: "text-violet-600",
  },
  documents: {
    label: "Quotations",
    icon: "▤",
    ring: "border-amber-200",
    tint: "bg-amber-50/40",
    dot: "text-amber-700",
  },
  tasks: {
    label: "Task lists",
    icon: "✓",
    ring: "border-indigo-200",
    tint: "bg-indigo-50/40",
    dot: "text-indigo-600",
  },
  other: {
    label: "Other",
    icon: "·",
    ring: "border-neutral-200",
    tint: "bg-neutral-50/40",
    dot: "text-neutral-600",
  },
};

const DEFAULT_PER_CATEGORY = 4;

/* ===========================================================================
   Sorting + categorization helpers — pure, exported for testability if
   anyone wants to hook tests later.
   =========================================================================== */

function categorize(e: EventRow): CategoryKey {
  const status = (e.status ?? "open") as EventStatus;
  // Critical bucket pulls in any non-resolved critical event regardless
  // of type — these always deserve top billing.
  if (e.severity === "critical" && status !== "resolved") return "critical";

  const t = e.event_type;
  if (t.startsWith("po.")) {
    if (t.includes("deposit") || t.includes("balance")) return "payments";
    if (t.includes("shipment")) return "shipping";
    return "production";
  }
  if (t.startsWith("doc.") || t.startsWith("client.")) return "documents";
  if (t.startsWith("tl.")) return "tasks";
  return "other";
}

const SEVERITY_ORDER: Record<EventSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

// Priority order for sorting events within a category. Most urgent
// states first (open = highest priority because no one has triaged).
// m044: 'working' and 'escalated' added — working sits between
// acknowledged and waiting (someone is actively on it but not blocked),
// escalated sits at the top tier (needs management attention).
const STATUS_ORDER: Record<EventStatus, number> = {
  escalated: 6,
  open: 5,
  acknowledged: 4,
  working: 3,
  waiting: 2,
  resolved: 1,
};

function sortForFeed(events: EventRow[]): EventRow[] {
  return [...events].sort((a, b) => {
    const sa = STATUS_ORDER[(a.status ?? "open") as EventStatus];
    const sb = STATUS_ORDER[(b.status ?? "open") as EventStatus];
    if (sa !== sb) return sb - sa;
    const va = SEVERITY_ORDER[a.severity];
    const vb = SEVERITY_ORDER[b.severity];
    if (va !== vb) return vb - va;
    return (
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  });
}

function isActionRequired(e: EventRow): boolean {
  return (e.status ?? "open") === "open";
}

/* ===========================================================================
   Component
   =========================================================================== */

export function OperationsFeed({
  events,
  latestCommentByEvent,
  commentsByEvent,
  actorLabel,
  commentCountByEvent,
  unreadCountByEvent,
  lastReadByEvent,
  autoOpenEventId,
  currentUserId,
}: {
  events: EventRow[];
  latestCommentByEvent: Record<string, EventComment>;
  commentsByEvent: Record<string, EventComment[]>;
  actorLabel: Record<string, string>;
  /** Total comment count per event (server-side aggregate). */
  commentCountByEvent?: Record<string, number>;
  /** Unread comment count per event for the current user. */
  unreadCountByEvent?: Record<string, number>;
  /** ISO `last_read_at` per event id for the current user. Used to
   *  highlight comments newer than the snapshot inside the drawer. */
  lastReadByEvent?: Record<string, string>;
  /** Auto-open the drawer on this event id on initial mount. Used by
   *  the notification bell to land directly on the conversation. */
  autoOpenEventId?: string | null;
  /** Current user id — needed by the drawer to exclude self-comments
   *  from the "unread" highlight. */
  currentUserId?: string | null;
}) {
  // Auto-open: when the URL carries a ?event=<id> AND that event is in
  // our visible set, prepare the drawer to open on initial render. We
  // also default the feed to "all" mode in that case so the underlying
  // row is reachable when the event is resolved (action_required would
  // hide it). Lazy-init useStates so the computation runs once.
  const initialOpenId =
    autoOpenEventId && events.some((e) => e.id === autoOpenEventId)
      ? autoOpenEventId
      : null;
  const [mode, setMode] = useState<FilterMode>(() => {
    if (!initialOpenId) return "action_required";
    const target = events.find((e) => e.id === initialOpenId);
    if (target && (target.status ?? "open") === "resolved") return "all";
    return "action_required";
  });
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const [expandedFull, setExpandedFull] = useState<Set<CategoryKey>>(
    new Set()
  );
  const [resolvedOpen, setResolvedOpen] = useState(false);

  const actorMap = useMemo(
    () => new Map<string, string>(Object.entries(actorLabel)),
    [actorLabel]
  );
  const activeEvent = openId
    ? events.find((e) => e.id === openId) ?? null
    : null;
  const activeComments = openId ? commentsByEvent[openId] ?? [] : [];

  /* ---- Derived buckets ---- */
  const totalCount = events.length;
  const actionRequiredCount = useMemo(
    () => events.filter(isActionRequired).length,
    [events]
  );

  const filtered = useMemo(() => {
    if (mode === "action_required") return events.filter(isActionRequired);
    return events;
  }, [events, mode]);

  // Resolved go to the bottom tail in BOTH modes (when present).
  // Action-required mode filters them out anyway via `isActionRequired`,
  // so this only matters in All mode.
  const nonResolved = useMemo(
    () =>
      filtered.filter((e) => (e.status ?? "open") !== "resolved"),
    [filtered]
  );
  const resolved = useMemo(
    () =>
      filtered.filter((e) => (e.status ?? "open") === "resolved"),
    [filtered]
  );

  // Group + sort non-resolved by category.
  const byCategory = useMemo(() => {
    const out: Record<CategoryKey, EventRow[]> = {
      critical: [],
      production: [],
      payments: [],
      shipping: [],
      documents: [],
      tasks: [],
      other: [],
    };
    for (const e of nonResolved) {
      out[categorize(e)].push(e);
    }
    for (const k of CATEGORY_ORDER) {
      out[k] = sortForFeed(out[k]);
    }
    return out;
  }, [nonResolved]);

  function toggleExpand(cat: CategoryKey) {
    setExpandedFull((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  /* ---- Empty states ---- */
  if (totalCount === 0) {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50/40 px-3 py-4 text-xs text-emerald-800 italic flex items-center gap-2">
        <span className="text-base">✓</span>
        No operational events. Everything is on track.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* ---- Filter bar ---- */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <FilterPill
            active={mode === "action_required"}
            onClick={() => setMode("action_required")}
            tone="amber"
          >
            Action required
            <CountBadge count={actionRequiredCount} active={mode === "action_required"} />
          </FilterPill>
          <FilterPill
            active={mode === "all"}
            onClick={() => setMode("all")}
            tone="neutral"
          >
            All
            <CountBadge count={totalCount} active={mode === "all"} />
          </FilterPill>
        </div>
        <span className="text-[10px] text-neutral-500 italic">
          {mode === "action_required"
            ? "Showing open events only. Toggle All for full history."
            : `Top events per category — expand for more.`}
        </span>
      </div>

      {/* ---- Action-required empty state ---- */}
      {mode === "action_required" && actionRequiredCount === 0 && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50/40 px-3 py-3 text-xs text-emerald-800 flex items-center gap-2">
          <span className="text-base">✓</span>
          <div>
            <b>Nothing to action.</b> {totalCount > 0 && (
              <button
                type="button"
                onClick={() => setMode("all")}
                className="ml-1 underline hover:no-underline"
              >
                View all {totalCount} events
              </button>
            )}
          </div>
        </div>
      )}

      {/* ---- Categories ---- */}
      {CATEGORY_ORDER.map((cat) => {
        const evs = byCategory[cat];
        if (evs.length === 0) return null;
        const isExpanded = expandedFull.has(cat);
        const openInCat = evs.filter(isActionRequired).length;
        // In action_required mode, show all (no cap — rare to have many).
        // In all mode, cap at DEFAULT_PER_CATEGORY unless expanded.
        const shown =
          mode === "action_required" || isExpanded
            ? evs
            : evs.slice(0, DEFAULT_PER_CATEGORY);
        const hiddenCount = evs.length - shown.length;
        return (
          <CategoryCard
            key={cat}
            category={cat}
            total={evs.length}
            openCount={openInCat}
            events={shown}
            hiddenCount={hiddenCount}
            onExpandToggle={() => toggleExpand(cat)}
            isExpanded={isExpanded}
            latestCommentByEvent={latestCommentByEvent}
            actorMap={actorMap}
            commentCountByEvent={commentCountByEvent}
            unreadCountByEvent={unreadCountByEvent}
            onOpenEvent={(id) => setOpenId(id)}
          />
        );
      })}

      {/* ---- Resolved tail (always at the bottom, only shown in All
          mode since action_required already excludes resolved). ---- */}
      {mode === "all" && resolved.length > 0 && (
        <ResolvedTail
          events={sortForFeed(resolved)}
          open={resolvedOpen}
          onToggle={() => setResolvedOpen((v) => !v)}
          latestCommentByEvent={latestCommentByEvent}
          actorMap={actorMap}
          commentCountByEvent={commentCountByEvent}
          unreadCountByEvent={unreadCountByEvent}
          onOpenEvent={(id) => setOpenId(id)}
        />
      )}

      <EventDetailDrawer
        event={activeEvent}
        initialComments={activeComments}
        open={openId !== null}
        onClose={() => setOpenId(null)}
        actorLabel={actorMap}
        currentUserId={currentUserId ?? null}
        initialLastReadAt={
          openId ? lastReadByEvent?.[openId] ?? null : null
        }
      />
    </div>
  );
}

/* ===========================================================================
   Filter pill — simple toggle button used for the filter bar.
   =========================================================================== */

function FilterPill({
  children,
  active,
  onClick,
  tone,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  tone: "amber" | "neutral";
}) {
  const activeClass =
    tone === "amber"
      ? "bg-amber-100 text-amber-900 border-amber-300"
      : "bg-neutral-900 text-white border-neutral-900";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
        active
          ? activeClass
          : "bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-50"
      }`}
    >
      {children}
    </button>
  );
}

function CountBadge({ count, active }: { count: number; active: boolean }) {
  return (
    <span
      className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold tabular-nums ${
        active
          ? "bg-white/80 text-neutral-900"
          : "bg-neutral-100 text-neutral-600"
      }`}
    >
      {count}
    </span>
  );
}

/* ===========================================================================
   Category card — header with icon + counts + expand chevron, then
   the events list. Compact rows inside.
   =========================================================================== */

function CategoryCard({
  category,
  total,
  openCount,
  events,
  hiddenCount,
  onExpandToggle,
  isExpanded,
  latestCommentByEvent,
  actorMap,
  commentCountByEvent,
  unreadCountByEvent,
  onOpenEvent,
}: {
  category: CategoryKey;
  total: number;
  openCount: number;
  events: EventRow[];
  hiddenCount: number;
  onExpandToggle: () => void;
  isExpanded: boolean;
  latestCommentByEvent: Record<string, EventComment>;
  actorMap: Map<string, string>;
  commentCountByEvent?: Record<string, number>;
  unreadCountByEvent?: Record<string, number>;
  onOpenEvent: (id: string) => void;
}) {
  const meta = CATEGORY_META[category];
  return (
    <div
      className={`rounded-lg border ${meta.ring} ${meta.tint} overflow-hidden`}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3 py-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-base leading-none ${meta.dot}`} aria-hidden>
            {meta.icon}
          </span>
          <span className="text-[11px] font-bold uppercase tracking-widerx text-neutral-800">
            {meta.label}
          </span>
          <span className="text-[10px] tabular-nums text-neutral-500">
            {openCount > 0 ? (
              <>
                <b className="text-neutral-800">{openCount}</b> open · {total} total
              </>
            ) : (
              <>{total} resolved/closed</>
            )}
          </span>
        </div>
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={onExpandToggle}
            className="text-[10px] font-semibold text-neutral-600 hover:text-neutral-900 hover:underline whitespace-nowrap"
          >
            +{hiddenCount} more →
          </button>
        )}
        {hiddenCount === 0 && isExpanded && total > DEFAULT_PER_CATEGORY && (
          <button
            type="button"
            onClick={onExpandToggle}
            className="text-[10px] font-semibold text-neutral-500 hover:text-neutral-900 hover:underline whitespace-nowrap"
          >
            Show less ←
          </button>
        )}
      </div>
      {/* Events list */}
      <ul className="divide-y divide-neutral-100 bg-white">
        {events.map((e) => (
          <CompactRow
            key={e.id}
            event={e}
            latestComment={latestCommentByEvent[e.id] ?? null}
            actorMap={actorMap}
            commentCount={commentCountByEvent?.[e.id] ?? 0}
            unreadCount={unreadCountByEvent?.[e.id] ?? 0}
            onOpen={() => onOpenEvent(e.id)}
          />
        ))}
      </ul>
    </div>
  );
}

/* ===========================================================================
   Resolved tail — collapsible at the bottom of the feed in All mode.
   =========================================================================== */

function ResolvedTail({
  events,
  open,
  onToggle,
  latestCommentByEvent,
  actorMap,
  commentCountByEvent,
  unreadCountByEvent,
  onOpenEvent,
}: {
  events: EventRow[];
  open: boolean;
  onToggle: () => void;
  latestCommentByEvent: Record<string, EventComment>;
  actorMap: Map<string, string>;
  commentCountByEvent?: Record<string, number>;
  unreadCountByEvent?: Record<string, number>;
  onOpenEvent: (id: string) => void;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50/30 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-2 px-3 py-1.5 hover:bg-neutral-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-emerald-600 text-sm" aria-hidden>
            ✓
          </span>
          <span className="text-[11px] font-bold uppercase tracking-widerx text-neutral-700">
            Recently resolved
          </span>
          <span className="text-[10px] tabular-nums text-neutral-500">
            {events.length} event{events.length === 1 ? "" : "s"}
          </span>
        </div>
        <span className="text-[10px] text-neutral-500">
          {open ? "Hide ←" : "Show →"}
        </span>
      </button>
      {open && (
        <ul className="divide-y divide-neutral-100 bg-white opacity-70">
          {events.map((e) => (
            <CompactRow
              key={e.id}
              event={e}
              latestComment={latestCommentByEvent[e.id] ?? null}
              actorMap={actorMap}
              commentCount={commentCountByEvent?.[e.id] ?? 0}
              unreadCount={unreadCountByEvent?.[e.id] ?? 0}
              onOpen={() => onOpenEvent(e.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/* ===========================================================================
   Compact row — half the vertical space of the v1 row. Single-line
   message, inline metadata, optional comment preview as a single
   italic line below.
   =========================================================================== */

function CompactRow({
  event,
  latestComment,
  actorMap,
  commentCount,
  unreadCount,
  onOpen,
}: {
  event: EventRow;
  latestComment: EventComment | null;
  actorMap: Map<string, string>;
  commentCount: number;
  unreadCount: number;
  onOpen: () => void;
}) {
  const status = (event.status ?? "open") as EventStatus;
  const shouldPulse = event.severity === "critical" && status === "open";
  const isResolved = status === "resolved";
  const actor =
    event.actor_id && actorMap.get(event.actor_id)
      ? actorMap.get(event.actor_id)
      : null;
  const waitingFor = (event.waiting_for ?? null) as EventWaitingFor | null;
  const showWaitingForPill = status === "waiting" && waitingFor;
  const ownerLabel =
    event.owner_id && actorMap.get(event.owner_id)
      ? actorMap.get(event.owner_id)
      : event.owner_id
      ? event.owner_id.slice(0, 6) + "…"
      : null;
  // Conversation-aware visuals (m045):
  //   hasUnread  → highlight row + show "N new" badge in rose
  //   commentCount > 0 → show "💬 N" gray badge for context
  const hasUnread = unreadCount > 0;

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={`w-full text-left px-3 py-1.5 transition-colors ${
          isResolved ? "opacity-70" : ""
        } ${
          hasUnread
            ? "bg-rose-50/40 border-l-2 border-rose-400 hover:bg-rose-50/70"
            : "hover:bg-neutral-50"
        }`}
      >
        {/* Single-line: dot + message + status badges + (NEW unread badge) + comment count + time */}
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`inline-block w-2 h-2 rounded-full shrink-0 ${SEVERITY_DOT[event.severity]} ${
              shouldPulse ? "animate-pulse" : ""
            }`}
            aria-hidden
            title={event.severity}
          />
          <span className="text-[12px] text-neutral-900 truncate min-w-0 flex-1">
            <span className={`mr-1 ${hasUnread ? "font-bold text-rose-900" : "text-neutral-500 font-medium"}`}>
              {eventTypeLabel(event.event_type)}:
            </span>
            <span className={hasUnread ? "font-semibold text-neutral-900" : ""}>
              {event.message}
            </span>
          </span>
          {/* NEW unread badge — visible only when unreadCount > 0. */}
          {hasUnread && (
            <span
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-widerx border border-rose-300 bg-rose-100 text-rose-800 shrink-0 animate-pulse"
              title={`${unreadCount} new comment${unreadCount === 1 ? "" : "s"} since your last visit`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-rose-600" />
              {unreadCount} new
            </span>
          )}
          {showWaitingForPill ? (
            <span
              className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-widerx border shrink-0 ${WAITING_FOR_PILL[waitingFor!]}`}
            >
              {WAITING_FOR_LABEL[waitingFor!]}
            </span>
          ) : status !== "open" ? (
            <span
              className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-widerx border shrink-0 ${STATUS_PILL[status]}`}
            >
              {STATUS_LABEL[status]}
            </span>
          ) : null}
          <span className="text-[10px] tabular-nums text-neutral-400 shrink-0">
            {relativeTimeShort(event.created_at)}
          </span>
        </div>
        {/* Second line — context: owner / comment count / latest preview / due / actor. */}
        {(ownerLabel || latestComment || commentCount > 0 || event.due_date || actor) && (
          <div className="mt-0.5 ml-4 flex items-center gap-2 text-[10px] text-neutral-500 truncate">
            {ownerLabel && (
              <span
                className="font-medium text-neutral-700 shrink-0"
                title={`Owned by ${ownerLabel}`}
              >
                👤 {ownerLabel}
              </span>
            )}
            {commentCount > 0 && (
              <span
                className={`shrink-0 font-medium tabular-nums ${
                  hasUnread ? "text-rose-700" : "text-neutral-600"
                }`}
                title={`${commentCount} comment${commentCount === 1 ? "" : "s"}${
                  hasUnread ? ` · ${unreadCount} unread for you` : ""
                }`}
              >
                💬 {commentCount}
              </span>
            )}
            {latestComment && (
              <span className="italic truncate min-w-0">
                {latestComment.comment}
              </span>
            )}
            {event.due_date && (
              <span className="font-semibold text-amber-700 shrink-0">
                Due {new Date(event.due_date).toLocaleDateString("en-GB")}
              </span>
            )}
            {actor && !latestComment && !ownerLabel && commentCount === 0 && (
              <span className="shrink-0">{actor}</span>
            )}
          </div>
        )}
      </button>
    </li>
  );
}

/** Compact relative time: "5m", "3h", "2d", "Apr 18". */
function relativeTimeShort(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "now";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString("en-GB", {
    month: "short",
    day: "numeric",
  });
}
