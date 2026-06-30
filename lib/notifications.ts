/**
 * Notification bell — server-side aggregation of unread operational
 * comments for the current user.
 *
 * Drives the bell icon in the top nav: counts events with at least
 * one unread comment, plus a short list of the most recent ones for
 * the dropdown panel.
 *
 * The data is scoped by RLS (events + event_comments policies from
 * m046 + event_reads from m045), so each user only sees notifications
 * for events they can see. Sales: their deals. Technical: everything.
 *
 * Implementation notes
 * --------------------
 * We could expose a single SECURITY DEFINER RPC that does the whole
 * aggregation in SQL, but the JS approach reuses existing helpers
 * (listOperationsFeed + getUnreadCommentCountsForUser) and keeps the
 * RLS surface unchanged. Cost: ~4 small queries on each nav render —
 * acceptable for a sub-second SSR path.
 */

import { createClient } from "@/lib/supabase/server";
import {
  listOperationsFeed,
  getUnreadCommentCountsForUser,
  getEventLastReadMap,
} from "@/lib/events";
import {
  eventEntityHref,
  eventTypeLabel,
  eventRaisesBell,
} from "@/lib/events-shared";
import type { EventRow, EventEntityType } from "@/lib/events-shared";
import {
  resolveNotificationChannel,
  type NotificationChannel,
} from "@/lib/notification-catalog";
import {
  getUnreadEntityMessagesForUser,
  type UnreadEntityThread,
} from "@/lib/entity-messages";
import { type Role } from "@/lib/types";
import { hasCapability } from "@/lib/permissions";

/** What produced a bell item — drives how it renders. */
export type NotificationSource = "event" | "comment" | "message" | "review";

export type NotificationItem = {
  /** event_id (used as React key). */
  id: string;
  /** Display label for the entity ("PO-005", "Q-024", "TL-12"). */
  entityLabel: string;
  /** Client / counterparty name when available. */
  clientName: string | null;
  /** Event type label ("Status changed", "Deadline changed"…). */
  eventTypeLabel: string;
  /** One-line event message. */
  message: string;
  /** How many unread comments since the user's last_read_at. */
  unreadCount: number;
  /** Latest unread comment preview (~80 chars). */
  latestCommentPreview: string | null;
  /** Latest unread comment timestamp (ISO). */
  latestCommentAt: string | null;
  /** Where to route on click (entity detail page). */
  href: string;
  /** Severity of the underlying event — drives the dot color. */
  severity: EventRow["severity"];
  /** Entity type for context icon. */
  entityType: EventEntityType;
  /** What produced this item — drives rendering in the bell. */
  source: NotificationSource;
  /** Unified timestamp the whole list is sorted by (desc). */
  sortAt: string;
};

export type NotificationSummary = {
  /** Total unread events (capped at 20 — beyond shows "20+"). */
  totalUnreadEvents: number;
  /** Top N unread events for the dropdown panel. */
  items: NotificationItem[];
};

const MAX_PANEL_ITEMS = 10;
const HARD_CAP_COUNT = 20;

/**
 * Compute the notification summary for the current user.
 *
 * Soft-fails to {totalUnreadEvents: 0, items: []} when:
 *   - User is not authenticated (caller should hide the bell anyway)
 *   - m045 / m039 not applied (returns empty list)
 *   - DB errors (logged, swallowed)
 */
/**
 * Load this role's notification channel overrides into an event_key →
 * channel map.
 *
 * Step 1 (m136): the bell is now ONE consumer of the unified event
 * registry. Its per-role overrides live in event_routing where
 * consumer='notification'; config.channel holds bell/feed/off.
 *
 * Defensive: a missing table (pre-m136) or any error ⇒ empty map ⇒ the
 * legacy defaults (defaultChannel == eventRaisesBell), so the registry is
 * invisible until a rule is added — identical to the m123 guarantee.
 */
async function loadNotificationRules(
  supabase: ReturnType<typeof createClient>,
  role: Role
): Promise<Map<string, NotificationChannel>> {
  const map = new Map<string, NotificationChannel>();
  try {
    const { data, error } = await supabase
      .from("event_routing")
      .select("event_key, config")
      .eq("consumer", "notification")
      .eq("role", role);
    if (error) return map;
    for (const r of (data ?? []) as any[]) {
      const ch = r?.config?.channel;
      if (r.event_key && (ch === "bell" || ch === "feed" || ch === "off")) {
        map.set(r.event_key, ch as NotificationChannel);
      }
    }
  } catch {
    /* table absent or transient error → defaults */
  }
  return map;
}

export async function getNotificationSummary(
  userId: string | null,
  role: Role | null = null
): Promise<NotificationSummary> {
  const empty: NotificationSummary = { totalUnreadEvents: 0, items: [] };
  if (!userId) return empty;

  // Role-aware action signal: technical reviewers (TLM / ops / admin) get a
  // "task lists awaiting your review" item — derived live from current state
  // (self-clears on validation, no read-tracking). Merged into the unified
  // sorted list below.
  const review = await buildReviewNotification(role);
  const supabase = createClient();

  // Phase 3C: per-role notification rules (read-time channel overrides).
  // Empty map (default / pre-m123) ⇒ legacy eventRaisesBell behavior.
  const rulesMap = role ? await loadNotificationRules(supabase, role) : new Map<string, NotificationChannel>();

  // Finalizer — merge review + event + note items into one list, newest first,
  // capped for the dropdown. The total counts every unread source.
  const finalize = (
    eventItems: NotificationItem[],
    messageItems: NotificationItem[]
  ): NotificationSummary => {
    const all = [
      ...(review ? [review.item] : []),
      ...eventItems,
      ...messageItems,
    ].sort((a, b) => (b.sortAt ?? "").localeCompare(a.sortAt ?? ""));
    return {
      totalUnreadEvents: Math.min(
        (review?.count ?? 0) + eventItems.length + messageItems.length,
        HARD_CAP_COUNT
      ),
      items: all.slice(0, MAX_PANEL_ITEMS),
    };
  };

  // ---- H8: unread project/order notes (entity_messages) ------------------
  // RLS-scoped to entities the user can see — safe to surface counts.
  let messageThreads: UnreadEntityThread[];
  try {
    messageThreads = await getUnreadEntityMessagesForUser(userId);
  } catch (err) {
    console.warn("[getNotificationSummary] note threads failed:", err);
    messageThreads = [];
  }

  // ---- H7: operational events — unread COMMENTS (existing) + CREATION of
  // high/critical/actionable-medium events (Decision D). RLS-scoped feed.
  let events: EventRow[];
  try {
    events = await listOperationsFeed({
      daysBack: 30,
      limit: 50,
      recentResolvedHours: 24,
    });
  } catch (err) {
    console.warn("[getNotificationSummary] feed fetch failed:", err);
    events = [];
  }

  const unreadMap = new Map<string, number>(); // event_id → unread comment count
  const latestByEvent = new Map<string, { preview: string; at: string }>();
  let surfacedEvents: EventRow[] = [];

  if (events.length > 0) {
    const eventIds = events.map((e) => e.id);
    const commentUnread = await getUnreadCommentCountsForUser(userId, eventIds);
    for (const [k, v] of commentUnread) unreadMap.set(k, v);
    const lastReadMap = await getEventLastReadMap(userId, eventIds);

    surfacedEvents = events.filter((e) => {
      if (unreadMap.has(e.id)) return true; // unread comments
      const channel = resolveNotificationChannel({
        eventKey: e.event_type,
        severity: e.severity,
        rule: rulesMap.get(e.event_type) ?? null,
      });
      if (channel !== "bell" || e.status === "resolved") return false;
      const lastRead = lastReadMap.get(e.id);
      return (
        !lastRead ||
        new Date(e.created_at).getTime() > new Date(lastRead).getTime()
      ); // creation-unread (Decision D)
    });

    // Latest unread comment per surfaced event → preview text + timestamp.
    const commentEventIds = surfacedEvents
      .filter((e) => unreadMap.has(e.id))
      .map((e) => e.id);
    if (commentEventIds.length > 0) {
      const { data: comments, error: cErr } = await supabase
        .from("event_comments")
        .select("event_id, user_id, comment, created_at")
        .in("event_id", commentEventIds)
        .neq("user_id", userId) // self-comments excluded
        .order("created_at", { ascending: false });
      if (cErr) {
        console.warn(
          "[getNotificationSummary] comments fetch failed:",
          cErr.message
        );
      }
      for (const c of (comments ?? []) as Array<{
        event_id: string;
        comment: string;
        created_at: string;
      }>) {
        if (latestByEvent.has(c.event_id)) continue; // already have newest
        const preview =
          c.comment.length > 80 ? c.comment.slice(0, 78) + "…" : c.comment;
        latestByEvent.set(c.event_id, { preview, at: c.created_at });
      }
    }
  }

  if (surfacedEvents.length === 0 && messageThreads.length === 0) {
    return finalize([], []);
  }

  // Resolve entity labels (doc/PO/TL/client number + client name) for BOTH
  // surfaced events AND note threads. Group by entity_type for batched lookups.
  const byType: Record<EventEntityType, string[]> = {
    document: [],
    task_list: [],
    production_order: [],
    client: [],
    project_request: [],
    affair: [],
    system: [],
  };
  for (const e of surfacedEvents) {
    if (e.entity_id) byType[e.entity_type].push(e.entity_id);
  }
  for (const t of messageThreads) {
    byType[t.entity_type].push(t.entity_id);
  }
  type Label = {
    number: string | null;
    clientName: string | null;
    /** Affair / project name — preferred in the notification headline so
     *  the reader instantly knows WHICH project, not just a number. */
    affairName: string | null;
  };
  const labelByEntityId = new Map<string, Label>();
  // Documents
  if (byType.document.length > 0) {
    const { data } = await supabase
      .from("documents")
      .select("id, number, affair_name, clients:client_id(company_name)")
      .in("id", byType.document);
    for (const r of (data ?? []) as any[]) {
      labelByEntityId.set(r.id, {
        number: r.number ?? null,
        clientName: r.clients?.company_name ?? null,
        affairName: r.affair_name ?? null,
      });
    }
  }
  // Production orders (affair name comes from the linked quotation)
  if (byType.production_order.length > 0) {
    const { data } = await supabase
      .from("production_orders")
      .select(
        "id, number, documents:quotation_id(affair_name), clients:client_id(company_name)"
      )
      .in("id", byType.production_order);
    for (const r of (data ?? []) as any[]) {
      labelByEntityId.set(r.id, {
        number: r.number ?? null,
        clientName: r.clients?.company_name ?? null,
        affairName: r.documents?.affair_name ?? null,
      });
    }
  }
  // Task lists
  if (byType.task_list.length > 0) {
    const { data } = await supabase
      .from("production_task_lists")
      .select(
        "id, number, documents:quotation_id(affair_name, clients:client_id(company_name))"
      )
      .in("id", byType.task_list);
    for (const r of (data ?? []) as any[]) {
      labelByEntityId.set(r.id, {
        number: r.number ?? null,
        clientName: r.documents?.clients?.company_name ?? null,
        affairName: r.documents?.affair_name ?? null,
      });
    }
  }
  // Project requests (entity_id IS the project; its name is the headline)
  if (byType.project_request.length > 0) {
    const { data } = await supabase
      .from("project_requests")
      .select("id, name, clients:client_id(company_name)")
      .in("id", byType.project_request);
    for (const r of (data ?? []) as any[]) {
      labelByEntityId.set(r.id, {
        number: r.name ?? null,
        clientName: r.clients?.company_name ?? null,
        affairName: r.name ?? null,
      });
    }
  }
  // Affairs (entity_id IS the affair; its name is the headline) — m103
  if (byType.affair.length > 0) {
    const { data } = await supabase
      .from("affairs")
      .select("id, name, clients:client_id(company_name)")
      .in("id", byType.affair);
    for (const r of (data ?? []) as any[]) {
      labelByEntityId.set(r.id, {
        number: r.name ?? null,
        clientName: r.clients?.company_name ?? null,
        affairName: r.name ?? null,
      });
    }
  }
  // Clients (event entity_type='client' → the entity_id IS the client)
  if (byType.client.length > 0) {
    const { data } = await supabase
      .from("clients")
      .select("id, company_name, client_code")
      .in("id", byType.client);
    for (const r of (data ?? []) as any[]) {
      labelByEntityId.set(r.id, {
        number: r.client_code ?? null,
        clientName: r.company_name ?? null,
        affairName: null,
      });
    }
  }

  // Build event items (unread comments and/or creation-unread per Decision D).
  const eventItems: NotificationItem[] = surfacedEvents.map((e) => {
    const label = labelByEntityId.get(e.entity_id);
    const latest = latestByEvent.get(e.id);
    const unread = unreadMap.get(e.id) ?? 0;
    return {
      id: e.id,
      // Lead with the affair / project name when we have it (the team
      // recognizes projects, not numbers); fall back to the doc/PO/TL number,
      // then a short id stub.
      entityLabel:
        label?.affairName ??
        label?.number ??
        `${e.entity_type}·${e.entity_id.slice(0, 6)}`,
      clientName: label?.clientName ?? null,
      eventTypeLabel: eventTypeLabel(e.event_type),
      message: e.message,
      unreadCount: unread,
      latestCommentPreview: latest?.preview ?? null,
      latestCommentAt: latest?.at ?? null,
      // Entity detail page + ?event=<id>: the page overlays the event
      // discussion drawer and marks the event read (clearing it from the bell).
      // Falls back to /operations for entity types without a dedicated page.
      href: (() => {
        const entityHref = eventEntityHref(e);
        if (entityHref) return `${entityHref}?event=${e.id}`;
        return `/operations?event=${e.id}`;
      })(),
      severity: e.severity,
      entityType: e.entity_type,
      // A comment-bearing item reads as a "comment"; a pure creation alert
      // (Decision D) reads as an "event".
      source: unread > 0 ? "comment" : "event",
      sortAt: latest?.at ?? e.created_at,
    };
  });

  // Build note items (entity_messages threads) — H8.
  const messageItems: NotificationItem[] = messageThreads.map((t) => {
    const label = labelByEntityId.get(t.entity_id);
    const base = eventEntityHref({
      entity_type: t.entity_type,
      entity_id: t.entity_id,
    });
    return {
      id: `msg:${t.entity_type}:${t.entity_id}`,
      entityLabel:
        label?.affairName ??
        label?.number ??
        `${t.entity_type}·${t.entity_id.slice(0, 6)}`,
      clientName: label?.clientName ?? null,
      eventTypeLabel: "Note",
      message: t.latestPreview,
      unreadCount: t.count,
      latestCommentPreview: t.latestPreview,
      latestCommentAt: t.latestAt,
      // ?chat=1 → the entity page auto-opens the conversation drawer.
      href: base ? `${base}?chat=1` : "/operations",
      severity: "low",
      entityType: t.entity_type,
      source: "message",
      sortAt: t.latestAt,
    };
  });

  return finalize(eventItems, messageItems);
}

/**
 * "N task lists awaiting your review" — a single aggregated bell item for
 * technical reviewers, derived from current state (status = under_validation).
 * Self-clears when the lists are validated. RLS scopes the count (technical
 * roles see all task lists). Soft-fails to null on missing tables / errors.
 */
async function buildReviewNotification(
  role: Role | null
): Promise<{ item: NotificationItem; count: number } | null> {
  // Capability-gated (NOT raw role): only reviewers who can actually validate
  // get the "N task lists awaiting your review" bell item. Operations without
  // task_list.validate no longer sees a review prompt it can't action.
  if (!role || !(await hasCapability("task_list.validate", role))) return null;
  const supabase = createClient();
  const { data, error } = await supabase
    .from("production_task_lists")
    .select("id, submitted_at")
    .eq("status", "under_validation")
    .order("submitted_at", { ascending: false })
    .limit(HARD_CAP_COUNT);
  if (error || !data || data.length === 0) return null;
  const count = data.length;
  const latest =
    (data[0] as any)?.submitted_at ?? new Date().toISOString();
  return {
    count,
    item: {
      id: "tl-awaiting-review",
      entityLabel: `${count} task list${count === 1 ? "" : "s"} awaiting your review`,
      clientName: null,
      eventTypeLabel: "Needs review",
      message: "Submitted for production validation — review to release.",
      unreadCount: count,
      latestCommentPreview: null,
      latestCommentAt: latest, // sorts near the top among recent items
      // Deep-link to the single waiting list, else the filtered review queue,
      // instead of dumping the reviewer on the full unfiltered list (NOTIF-1).
      href:
        count === 1
          ? `/task-lists/${(data[0] as any).id}`
          : "/task-lists?status=under_validation",
      severity: "high",
      entityType: "task_list",
      source: "review",
      sortAt: latest,
    },
  };
}
