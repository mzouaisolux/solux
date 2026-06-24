/**
 * Event log — collaborative operational visibility.
 *
 * Every critical workflow action emits an event via `emitEvent()`. Pages
 * read them via `listEvents()` to render timelines / cancellation banners
 * / dashboard activity feeds.
 *
 * Why this exists
 * ----------------
 * Previously, important changes (cancellation, deadline shift, deposit
 * received, task list deleted) happened with **zero traceability**. The
 * sales team could log in to find an order gone with no idea why or by
 * whom. This module is the bedrock of "what happened to this thing?"
 * answers that the whole UI now reads from.
 *
 * Architecture
 * ------------
 * - One `events` table, polymorphic on (entity_type, entity_id).
 * - Helpers below are intentionally thin: emit + list, no transformation
 *   logic. Callers (server actions) own the choice of severity + message.
 * - Severity is a 4-step ladder: low → medium → high → critical. Used to
 *   color badges and filter dashboard feeds.
 * - Events are immutable. RLS allows INSERT but never UPDATE/DELETE.
 */

import { createClient } from "@/lib/supabase/server";
import {
  NOTIFICATION_CATALOG,
  shouldEmitOnce,
} from "@/lib/notification-catalog";
import { getCurrentUserRole } from "@/lib/auth";

// Pure types + palettes live in `lib/events-shared.ts` so client
// components (OperationsFeed, EventDetailDrawer, etc.) can import
// them without dragging server-only deps (`next/headers` through
// `lib/auth.ts`) into the client bundle. This file re-exports them
// so any server-side code that historically did
//   `import { EventRow } from "@/lib/events"`
// keeps working with no change.
export * from "./events-shared";
import type {
  EventSeverity,
  EventEntityType,
  EventType,
  EventStatus,
  EventRow,
  EventComment,
} from "./events-shared";

// EventEntityType + EventType + EventStatus + EventRow + EventComment +
// EVENT_STATUSES + all palettes (SEVERITY_*, STATUS_*) + the pure
// helpers (eventEntityHref, eventTypeLabel) all live in
// `./events-shared` and are re-exported above. This file keeps only
// the server-side concerns (Supabase queries, emitEvent).

/** Default severity per event type — used when caller doesn't override. */
const DEFAULT_SEVERITY: Record<EventType, EventSeverity> = {
  "po.created": "medium",
  "po.status_changed": "medium",
  "po.deadline_changed": "high",
  // m074 — editing/deleting an existing delay event. Edits are routine
  // (recovery, attribution fix); deletions are higher signal.
  "po.delay_event_edited": "medium",
  "po.delay_event_deleted": "high",
  "po.timeline_set": "medium",
  "po.deposit_received": "medium",
  "po.balance_received": "medium",
  "po.deposit_override": "high",
  "po.shipment_updated": "medium",
  "po.production_completed": "high",
  "po.cancelled": "critical",
  "tl.submitted_for_validation": "low",
  "tl.validated": "medium",
  "tl.production_ready": "medium",
  "tl.needs_revision": "medium",
  "tl.reopened": "medium",
  "tl.cancelled": "critical",
  "tl.deleted": "critical",
  "tl.status_overridden": "high",
  "doc.created": "low",
  "doc.updated": "low",
  "doc.status_changed": "low",
  "doc.won": "medium",
  "doc.lost": "low",
  "doc.cancelled": "critical",
  "doc.deleted": "critical",
  // Validation loop (m068): a request needs a manager's eyes (high so it
  // surfaces in the ops feed); the outcomes notify the salesperson.
  "doc.validation_requested": "high",
  "doc.validation_approved": "medium",
  "doc.validation_rejected": "high",
  "tl.header_changed": "low",
  "client.created": "low",
  "client.updated": "low",
  "client.deleted": "critical",
  // Contacts (m101) + planned actions (m103): routine CRM bookkeeping —
  // timeline only, never the bell (PLAN_CRM_SOLUX §10's 3-tier rule).
  "client.contact_added": "low",
  "client.contact_updated": "low",
  "client.contact_deleted": "low",
  "affair.action_planned": "low",
  "affair.action_done": "low",
  "affair.action_deleted": "low",
  // BL workflow (Sales → Operations): the PO event is HIGH — it must ring
  // the sales owner's bell (booking is blocked until they act). The affair
  // mirror is the history entry only.
  "po.bl_info_requested": "high",
  // Resolution is MEDIUM: it lands in the timeline + feed ("blocker
  // lifted") without ringing anyone's bell — good news needs no alarm.
  "po.bl_info_resolved": "medium",
  "affair.bl_info_requested": "low",
  "pr.created": "low",
  "pr.submitted": "medium",
  "pr.approved": "medium",
  "pr.rejected": "medium",
  "pr.info_requested": "medium",
  "pr.cost_entered": "medium",
  "pr.cost_overridden": "high",
  "pr.logistics_entered": "low",
  "pr.packing_entered": "medium",
  "pr.freight_entered": "medium",
  "pr.freight_update_requested": "medium",
  "pr.freight_updated": "medium",
  "pr.ready_for_pricing": "medium",
  "pr.priced": "medium",
  "pr.quotation_generated": "medium",
  "pr.won": "medium",
  "pr.lost": "low",
  "pr.cancelled": "critical",
  "admin.permissions_changed": "high",
  "admin.user_role_changed": "high",
  "system.dev_reset": "critical",
  "note.added": "low",
};

// EventStatus / EVENT_STATUSES / EventRow / EventComment are
// re-exported from `./events-shared` (see top of file).

export type EmitEventArgs = {
  entity_type: EventEntityType;
  entity_id: string;
  event_type: EventType;
  message: string;
  payload?: Record<string, any>;
  severity?: EventSeverity;
  /** If true, swallow any insert error and console.warn instead. Use this
   *  when event emission is "nice to have" — never let the audit log
   *  block a real business action. */
  bestEffort?: boolean;
};

/**
 * Emit an event. Call from inside server actions, AFTER the main DB
 * mutation has succeeded. The event log is a side effect — it must not
 * gate the business action.
 *
 * Best practice:
 *   await mainMutation();
 *   await emitEvent({ ... bestEffort: true });
 *
 * That way an event-table outage doesn't break workflows; we just lose
 * the audit row and a console.warn surfaces it.
 */
export async function emitEvent(args: EmitEventArgs): Promise<void> {
  try {
    const supabase = createClient();
    const { userId } = await getCurrentUserRole();
    const severity = args.severity ?? DEFAULT_SEVERITY[args.event_type] ?? "low";

    const { error } = await supabase.from("events").insert({
      entity_type: args.entity_type,
      entity_id: args.entity_id,
      event_type: args.event_type,
      severity,
      message: args.message,
      payload: args.payload ?? {},
      actor_id: userId,
    });

    if (error) {
      console.error(
        "[emitEvent] failed to log",
        args.event_type,
        "for",
        args.entity_type,
        args.entity_id,
        "—",
        error.message
      );
      if (!args.bestEffort) {
        throw new Error(`Event emission failed: ${error.message}`);
      }
    }
  } catch (e: any) {
    console.error("[emitEvent] uncaught error:", e?.message);
    if (!args.bestEffort) throw e;
  }
}

/**
 * Typed notification emit (Phase 3C): derive entity_type + default
 * message from the catalog so call sites only pass the event key + the
 * entity id. Severity stays governed by DEFAULT_SEVERITY (not passed),
 * so the read-time channel resolution is unchanged.
 */
export async function emitNotificationEvent(
  eventKey: EventType,
  args: { entityId: string; message?: string; payload?: Record<string, any>; bestEffort?: boolean }
): Promise<void> {
  const entry = NOTIFICATION_CATALOG[eventKey];
  await emitEvent({
    entity_type: (entry?.entity ?? "system") as EventEntityType,
    entity_id: args.entityId,
    event_type: eventKey,
    message: args.message ?? entry?.label ?? eventKey,
    payload: args.payload,
    bestEffort: args.bestEffort,
  });
}

/**
 * Emit at most once per (event_type, entity, dedupKey) within a time
 * window — generic anti-spam, generalizing the BL request/resolve guard.
 * Returns true if emitted, false if skipped as a recent duplicate. The
 * dedup key is stored in payload.dedup_key. If the lookup errors we emit
 * anyway (never silently drop a real event).
 */
export async function emitEventOnce(
  args: EmitEventArgs & { dedupKey: string; windowMinutes: number }
): Promise<boolean> {
  const { dedupKey, windowMinutes, ...emitArgs } = args;
  try {
    const supabase = createClient();
    const { data } = await supabase
      .from("events")
      .select("created_at")
      .eq("event_type", emitArgs.event_type)
      .eq("entity_id", emitArgs.entity_id)
      .contains("payload", { dedup_key: dedupKey })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!shouldEmitOnce(data?.created_at ?? null, new Date().toISOString(), windowMinutes)) {
      return false;
    }
  } catch (e: any) {
    console.warn("[emitEventOnce] dedup lookup failed, emitting anyway:", e?.message);
  }
  await emitEvent({
    ...emitArgs,
    payload: { ...(emitArgs.payload ?? {}), dedup_key: dedupKey },
  });
  return true;
}

/**
 * Fetch events for a specific entity, newest first.
 *
 * Used by timeline panels on PO detail, client workspace, task list
 * detail. Limit defaults to 50 — the timeline UI should paginate beyond
 * that, but 50 is enough for most operational stories.
 */
export async function listEventsForEntity(
  entityType: EventEntityType,
  entityId: string,
  limit = 50
): Promise<EventRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[listEventsForEntity] failed:", error.message);
    return [];
  }
  return (data ?? []) as EventRow[];
}

/**
 * Fetch events for MANY entities at once, merged + sorted newest first.
 *
 * Use this to build aggregated activity feeds — e.g. a client workspace
 * timeline that shows the client's events + all their quotations' events
 * + all their task lists + all their POs in one feed.
 *
 * We do a single round-trip per entity_type (we can't easily group by
 * (entity_type, entity_id) tuples in a Supabase REST call, but we can
 * do one `.in(entity_id, ids)` per type). For a typical client with
 * a few dozen docs/POs, that's 3-4 queries — small and predictable.
 */
export async function listEventsForEntities(
  groups: { entity_type: EventEntityType; entity_ids: string[] }[],
  limit = 100
): Promise<EventRow[]> {
  const supabase = createClient();
  const all: EventRow[] = [];
  for (const g of groups) {
    if (g.entity_ids.length === 0) continue;
    const { data, error } = await supabase
      .from("events")
      .select("*")
      .eq("entity_type", g.entity_type)
      .in("entity_id", g.entity_ids)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      console.error(
        "[listEventsForEntities] failed for",
        g.entity_type,
        ":",
        error.message
      );
      continue;
    }
    all.push(...((data ?? []) as EventRow[]));
  }
  // Final merge sort newest-first + global cap so a noisy entity can't
  // dominate the feed.
  all.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return all.slice(0, limit);
}

/**
 * Fetch recent high/critical events across the whole company.
 *
 * Used by the dashboard "Recent critical events" widget. Caps at the
 * last 7 days by default and 20 rows so the widget stays scannable.
 */
export async function listRecentCriticalEvents(opts?: {
  daysBack?: number;
  limit?: number;
  minSeverity?: EventSeverity;
}): Promise<EventRow[]> {
  const daysBack = opts?.daysBack ?? 7;
  const limit = opts?.limit ?? 20;
  const minSeverity = opts?.minSeverity ?? "high";
  const severities =
    minSeverity === "critical" ? ["critical"] : ["high", "critical"];

  const since = new Date();
  since.setDate(since.getDate() - daysBack);

  const supabase = createClient();
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .in("severity", severities)
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[listRecentCriticalEvents] failed:", error.message);
    return [];
  }
  return (data ?? []) as EventRow[];
}

// SEVERITY_DOT / SEVERITY_PILL / SEVERITY_LABEL / STATUS_PILL /
// STATUS_LABEL are re-exported from `./events-shared` (see top of file).

/**
 * Operations Feed query — the heart of the cockpit view.
 *
 * Returns events that are either:
 *   - currently unresolved (status != 'resolved') — these are active
 *     operational concerns the team must see, OR
 *   - recently resolved (within `recentResolvedHours` hours) — kept
 *     temporarily so the team can confirm "yes that's done", then they
 *     drop off naturally.
 *
 * Sorted by:
 *   1. severity DESC (critical first)
 *   2. status priority (open > acknowledged > waiting > resolved)
 *   3. created_at DESC (newer first within the same bucket)
 *
 * Limit defaults to 50 — well past the visible-without-scroll mark
 * but small enough to render fast.
 */
export async function listOperationsFeed(opts?: {
  daysBack?: number;
  limit?: number;
  recentResolvedHours?: number;
}): Promise<EventRow[]> {
  const daysBack = opts?.daysBack ?? 30;
  const limit = opts?.limit ?? 50;
  const recentResolvedHours = opts?.recentResolvedHours ?? 24;

  const since = new Date();
  since.setDate(since.getDate() - daysBack);

  const supabase = createClient();

  // Try the query with the m039 columns. If they're missing (migration
  // not yet applied), retry without — operations feed still works,
  // just without the status workflow filtering.
  let rows: EventRow[] = [];
  const attempt = await supabase
    .from("events")
    .select("*")
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(limit * 2); // over-fetch then filter

  if (attempt.error) {
    console.error("[listOperationsFeed] query failed:", attempt.error.message);
    return [];
  }
  rows = (attempt.data ?? []) as EventRow[];

  const resolvedCutoff = new Date(
    Date.now() - recentResolvedHours * 3600 * 1000
  );
  const visible = rows.filter((r) => {
    const status = (r.status ?? "open") as EventStatus;
    if (status !== "resolved") return true;
    // Resolved within the recent window — keep it for confirmation.
    if (r.resolved_at && new Date(r.resolved_at) >= resolvedCutoff) return true;
    return false;
  });

  // Sort by severity, then status priority, then recency.
  const severityRank: Record<EventSeverity, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  // m044: extended with working + escalated. Ranks reflect "needs
  // attention now" priority — escalated jumps to the top (management
  // routing), open stays high (untriaged), working/waiting sit in
  // the middle (someone is on it), resolved is last.
  const statusRank: Record<EventStatus, number> = {
    escalated: 0,
    open: 1,
    acknowledged: 2,
    working: 3,
    waiting: 4,
    resolved: 5,
  };
  visible.sort((a, b) => {
    const sa = severityRank[a.severity] ?? 9;
    const sb = severityRank[b.severity] ?? 9;
    if (sa !== sb) return sa - sb;
    const ta = statusRank[(a.status ?? "open") as EventStatus] ?? 9;
    const tb = statusRank[(b.status ?? "open") as EventStatus] ?? 9;
    if (ta !== tb) return ta - tb;
    return a.created_at < b.created_at ? 1 : -1;
  });

  return visible.slice(0, limit);
}

/** Fetch a single event by id (used by the drawer). */
export async function getEventById(id: string): Promise<EventRow | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[getEventById] failed:", error.message);
    return null;
  }
  return (data ?? null) as EventRow | null;
}

/** Fetch the comment thread for an event, oldest-first for display. */
export async function listEventComments(
  eventId: string
): Promise<EventComment[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("event_comments")
    .select("*")
    .eq("event_id", eventId)
    .order("created_at", { ascending: true });
  if (error) {
    // Defensive: if m039 isn't applied, table doesn't exist — just
    // return [] and let the UI render the drawer without a thread.
    return [];
  }
  return (data ?? []) as EventComment[];
}

/**
 * Bulk-fetch the LATEST comment per event for a list of event ids.
 * Used by the feed to show a one-line "last comment" preview directly
 * on each row without N+1 queries.
 *
 * Returns a Map keyed by event_id.
 */
export async function listLatestCommentByEvent(
  eventIds: string[]
): Promise<Map<string, EventComment>> {
  const out = new Map<string, EventComment>();
  if (eventIds.length === 0) return out;
  const supabase = createClient();
  const { data, error } = await supabase
    .from("event_comments")
    .select("*")
    .in("event_id", eventIds)
    .order("created_at", { ascending: false });
  if (error) return out;
  for (const c of (data ?? []) as EventComment[]) {
    // First row per event_id wins (we ordered DESC).
    if (!out.has(c.event_id)) out.set(c.event_id, c);
  }
  return out;
}

// eventEntityHref + eventTypeLabel live in `./events-shared` and are
// re-exported from the top of this file. They're pure functions with
// no server dependencies, so they're safe to import from client code.

/* ===========================================================================
   Read-state helpers (m045)
   ===========================================================================
   Three maps the dashboard / operations page need to render the
   conversation-aware UX:

     commentCountByEvent  : { event_id → total comments }
     unreadCountByEvent   : { event_id → unread comments for THIS user }
     lastReadByEvent      : { event_id → last_read_at } (optional, only
                            used if a surface needs the raw timestamp)

   All three are derived from `event_comments` + `event_reads` with
   ONE batched query each. Safe-fails when m045 / m039 isn't applied
   (returns empty maps instead of throwing).                            */

/**
 * Compute total comment count per event for a given set of event ids.
 *
 * One query, one in-memory bucketing. Returns an empty Map when the
 * input is empty or when the table is missing.
 */
export async function getCommentCountsForEvents(
  eventIds: string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (eventIds.length === 0) return out;
  const supabase = createClient();
  const { data, error } = await supabase
    .from("event_comments")
    .select("event_id")
    .in("event_id", eventIds);
  if (error) {
    if (/event_comments/.test(error.message ?? "")) return out;
    console.warn("[getCommentCountsForEvents]", error.message);
    return out;
  }
  for (const c of (data ?? []) as Array<{ event_id: string }>) {
    out.set(c.event_id, (out.get(c.event_id) ?? 0) + 1);
  }
  return out;
}

/**
 * Return last_read_at per event for the current user.
 *
 * Used by the drawer to highlight comments newer than the user's
 * snapshot (i.e. "what's new since you last looked"). The snapshot
 * is captured BEFORE markEventRead fires on drawer-open, so the
 * highlight survives the auto-mark-read side effect.
 *
 * Soft-fails to an empty Map when m045 isn't applied yet.
 */
export async function getLastReadByEventForUser(
  userId: string | null,
  eventIds: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!userId || eventIds.length === 0) return out;
  const supabase = createClient();
  const { data, error } = await supabase
    .from("event_reads")
    .select("event_id, last_read_at")
    .eq("user_id", userId)
    .in("event_id", eventIds);
  if (error) {
    if (!/event_reads/.test(error.message ?? "")) {
      console.warn("[getLastReadByEventForUser]", error.message);
    }
    return out;
  }
  for (const r of (data ?? []) as Array<{
    event_id: string;
    last_read_at: string;
  }>) {
    out.set(r.event_id, r.last_read_at);
  }
  return out;
}

/**
 * Compute the number of UNREAD comments per event for the given user.
 *
 * Unread = comment.created_at > event_reads.last_read_at (or no
 * event_reads row exists for that pair). We skip self-authored
 * comments — you don't see your own comments as "unread".
 *
 * Returns an empty Map if userId is null, the input is empty, or any
 * of the tables haven't been deployed yet.
 */
export async function getUnreadCommentCountsForUser(
  userId: string | null,
  eventIds: string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!userId || eventIds.length === 0) return out;
  const supabase = createClient();

  // Pull last_read_at for the user across the relevant events.
  const { data: reads, error: readsErr } = await supabase
    .from("event_reads")
    .select("event_id, last_read_at")
    .eq("user_id", userId)
    .in("event_id", eventIds);
  if (readsErr) {
    if (/event_reads/.test(readsErr.message ?? "")) {
      // m045 not applied — treat as "user has never read anything",
      // meaning every other-authored comment is unread. We still
      // need to fetch the comments below to do so.
    } else {
      console.warn("[getUnreadCommentCountsForUser] reads", readsErr.message);
      return out;
    }
  }
  const readByEvent = new Map<string, string>(
    (reads ?? []).map((r: any) => [r.event_id, r.last_read_at])
  );

  // Pull comments — full set, then filter in memory.
  const { data: comments, error: cErr } = await supabase
    .from("event_comments")
    .select("event_id, created_at, user_id")
    .in("event_id", eventIds);
  if (cErr) {
    if (/event_comments/.test(cErr.message ?? "")) return out;
    console.warn("[getUnreadCommentCountsForUser] comments", cErr.message);
    return out;
  }

  for (const c of (comments ?? []) as any[]) {
    if (c.user_id === userId) continue; // don't count own comments
    const lastRead = readByEvent.get(c.event_id);
    const isUnread =
      !lastRead || new Date(c.created_at).getTime() > new Date(lastRead).getTime();
    if (isUnread) {
      out.set(c.event_id, (out.get(c.event_id) ?? 0) + 1);
    }
  }
  return out;
}

/**
 * Last-read timestamp per event for a user (event_reads, m045). A missing
 * entry means the event has never been opened by this user → creation-unread.
 * Returns an empty map on missing table / error / empty input — callers treat
 * that as "everything is unread", consistent with getUnreadCommentCountsForUser.
 */
export async function getEventLastReadMap(
  userId: string | null,
  eventIds: string[]
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (!userId || eventIds.length === 0) return out;
  const supabase = createClient();
  const { data, error } = await supabase
    .from("event_reads")
    .select("event_id, last_read_at")
    .eq("user_id", userId)
    .in("event_id", eventIds);
  if (error) return out; // m045 missing / error → treat as all-unread
  for (const r of (data ?? []) as any[]) {
    out.set(r.event_id, (r.last_read_at as string | null) ?? null);
  }
  return out;
}
