import { createClient } from "@/lib/supabase/server";
import {
  getEventById,
  listEventComments,
  getLastReadByEventForUser,
} from "@/lib/events";
import type { EventComment } from "@/lib/events-shared";
import { EventDiscussionDrawerClient } from "./EventDiscussionDrawerClient";

/**
 * "Conversation inside context" drawer — mounts on any entity detail
 * page (production order, document, task list, client) when the URL
 * carries `?event=<uuid>`. Used by the notification bell to land
 * the user on the operational context WHILE the conversation thread
 * is open in a drawer overlay.
 *
 * Server-side responsibilities:
 *   1. Validate the `?event=` UUID format.
 *   2. Fetch the event (RLS-scoped — invisible events resolve to null).
 *   3. (Optional safety) Confirm the event actually belongs to the
 *      entity in the URL — otherwise drop. Prevents `?event=<arbitrary>`
 *      on a doc page from showing a PO event.
 *   4. Fetch the event's full comment thread.
 *   5. Resolve actor labels for the thread + owner.
 *   6. Capture the user's last_read_at snapshot (so the highlight
 *      survives the auto-mark-read on drawer-open).
 *
 * Renders nothing when the param is missing / invalid / event invisible
 * — the page below shows just the entity context as usual.
 */
export async function EventDiscussionPanel({
  eventId,
  /** Optional safety check — when set, the event's entity_id is
   *  validated against this id to ensure the URL is internally
   *  consistent. */
  expectedEntityId,
  currentUserId,
}: {
  eventId: string | null;
  expectedEntityId?: string | null;
  currentUserId: string | null;
}) {
  if (!eventId) return null;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      eventId
    )
  ) {
    return null;
  }

  // 1. Fetch event (RLS applies — sales gets null if not theirs).
  const event = await getEventById(eventId);
  if (!event) return null;

  // 2. Safety: refuse to mount when the event doesn't belong to the
  // page's entity. Stops drive-by URL crafting that would surface
  // unrelated context.
  if (expectedEntityId && event.entity_id !== expectedEntityId) {
    return null;
  }

  const supabase = createClient();

  // 3. Comments + actor labels + last_read snapshot. Three small
  // queries — fast enough to run inline in the server render.
  const [comments, lastReadMap] = await Promise.all([
    listEventComments(eventId),
    getLastReadByEventForUser(currentUserId, [eventId]),
  ]);

  // 4. Collect actor ids from event + comments + owner for label lookup.
  const actorIds = Array.from(
    new Set(
      [
        event.actor_id,
        (event as any).owner_id,
        ...comments.map((c) => c.user_id),
      ].filter(Boolean) as string[]
    )
  );
  const actorLabelObj: Record<string, string> = {};
  if (actorIds.length > 0) {
    const { data: rolesRows } = await supabase
      .from("user_roles")
      .select("user_id, role")
      .in("user_id", actorIds);
    for (const r of (rolesRows ?? []) as Array<{ user_id: string; role: string }>) {
      const short = r.role
        .replace("task_list_manager", "tlm")
        .replace("operations", "ops");
      actorLabelObj[r.user_id] = `${short}·${String(r.user_id).slice(0, 6)}`;
    }
  }

  return (
    <EventDiscussionDrawerClient
      event={event}
      initialComments={comments as EventComment[]}
      actorLabel={actorLabelObj}
      currentUserId={currentUserId}
      initialLastReadAt={lastReadMap.get(eventId) ?? null}
    />
  );
}

/**
 * Helper — parse and validate the `?event=` searchParam shape.
 * Returns null for missing / non-string / non-UUID values. Mirrors
 * the parsing logic on /operations so each entity page does it the
 * same way.
 */
export function parseEventSearchParam(
  raw: string | string[] | undefined
): string | null {
  if (!raw) return null;
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v) return null;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  ) {
    return null;
  }
  return v;
}
