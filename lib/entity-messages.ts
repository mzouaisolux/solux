/**
 * Entity messages — server-side helpers for the conversation layer.
 *
 * Split layout
 * ------------
 * - Pure types + author helpers live in `lib/entity-messages-shared.ts`
 *   so client components can import them without dragging `next/headers`
 *   (via `lib/supabase/server.ts`) into the client bundle.
 * - This file holds the SERVER-ONLY helpers (DB reads). It re-exports
 *   everything from the shared module, so server code keeps working
 *   with a single `import from "@/lib/entity-messages"`.
 *
 * Mutations live in `app/(app)/_actions/entity-messages.ts`.
 *
 * Soft-fails when m049 isn't applied: every read returns empty data
 * instead of throwing, so the conversation drawer can mount on routes
 * even when the migration hasn't shipped yet.
 */

import { createClient } from "@/lib/supabase/server";
import { resolveUserLabels } from "@/lib/user-display";

export * from "./entity-messages-shared";

import type {
  EntityMessage,
  EntityMessageEntityType,
  EntityMessageWithAuthor,
} from "./entity-messages-shared";

/**
 * List the full message thread for an entity, oldest → newest.
 * Empty array on missing-table (m049 not applied).
 */
export async function listEntityMessages(
  entityType: EntityMessageEntityType,
  entityId: string
): Promise<EntityMessage[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("entity_messages")
    .select("*")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: true });
  if (error) {
    if (/entity_messages/.test(error.message ?? "")) return [];
    console.warn("[listEntityMessages]", error.message);
    return [];
  }
  return (data ?? []) as EntityMessage[];
}

/**
 * Same as `listEntityMessages`, but resolves author display names
 * from the `user_profiles` view in one extra round-trip. Soft-fails
 * to nulls when the view doesn't exist.
 */
export async function listEntityMessagesWithAuthors(
  entityType: EntityMessageEntityType,
  entityId: string
): Promise<EntityMessageWithAuthor[]> {
  const rows = await listEntityMessages(entityType, entityId);
  if (rows.length === 0) return [];

  const userIds = rows.map((r) => r.user_id);
  // Resolve through the shared label helper so chat authors read the
  // same admin-set display names as forecast + audit. The label never
  // comes back empty (it falls back to "role · uuid8"), so we set it
  // as author_name and the chat UI shows a real name instead of
  // "Unknown user".
  const labels = await resolveUserLabels(userIds);

  return rows.map((r) => {
    const meta = r.user_id ? labels.get(r.user_id) : undefined;
    return {
      ...r,
      author_email: null,
      author_name: meta?.label ?? null,
    };
  });
}

/**
 * Last-read timestamp for a user on a given entity. Null = never read
 * (or m049 not applied — soft-fail).
 */
export async function getLastReadForEntity(
  userId: string | null,
  entityType: EntityMessageEntityType,
  entityId: string
): Promise<string | null> {
  if (!userId) return null;
  const supabase = createClient();
  const { data, error } = await supabase
    .from("entity_message_reads")
    .select("last_read_at")
    .eq("user_id", userId)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .maybeSingle();
  if (error) return null;
  return (data?.last_read_at as string | undefined) ?? null;
}

/**
 * Unread count for ONE user on ONE entity.
 *
 * Unread = message.created_at > last_read_at AND user_id != currentUser.
 * (We never count the user's own messages as unread to themselves.)
 */
export async function getUnreadCountForEntity(
  userId: string | null,
  entityType: EntityMessageEntityType,
  entityId: string
): Promise<number> {
  if (!userId) return 0;
  const lastRead = await getLastReadForEntity(userId, entityType, entityId);
  const messages = await listEntityMessages(entityType, entityId);
  const cutoff = lastRead ? new Date(lastRead).getTime() : 0;
  let n = 0;
  for (const m of messages) {
    if (m.user_id === userId) continue;
    if (new Date(m.created_at).getTime() > cutoff) n++;
  }
  return n;
}

/** One per-entity unread summary for the notification bell. */
export type UnreadEntityThread = {
  entity_type: EntityMessageEntityType;
  entity_id: string;
  count: number;
  latestPreview: string;
  latestAt: string;
};

/**
 * Cross-entity unread summary for the notification bell (H8).
 *
 * ONE RLS-scoped read over `entity_messages` — the m049 SELECT policy already
 * limits rows to entities the caller can see (a sales user only sees messages
 * on their own deals), so surfacing these counts can't leak across isolation.
 * Joined in memory with the user's own read-state; self-authored messages are
 * never unread to the author. Grouped by (entity_type, entity_id), newest
 * first. Soft-fails to [] when m049 isn't applied.
 */
export async function getUnreadEntityMessagesForUser(
  userId: string | null,
  opts: { daysBack?: number; limit?: number } = {}
): Promise<UnreadEntityThread[]> {
  if (!userId) return [];
  const { daysBack = 30, limit = 300 } = opts;
  const supabase = createClient();
  const sinceIso = new Date(Date.now() - daysBack * 86_400_000).toISOString();

  const { data, error } = await supabase
    .from("entity_messages")
    .select("entity_type, entity_id, user_id, message, created_at")
    .eq("message_kind", "comment")
    .neq("user_id", userId) // never my own messages
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    if (/entity_messages/.test(error.message ?? "")) return [];
    console.warn("[getUnreadEntityMessagesForUser]", error.message);
    return [];
  }
  const rows = (data ?? []) as Array<{
    entity_type: EntityMessageEntityType;
    entity_id: string;
    user_id: string | null;
    message: string | null;
    created_at: string;
  }>;
  if (rows.length === 0) return [];

  // The user's last-read markers for the entities in play.
  const entityIds = Array.from(new Set(rows.map((r) => r.entity_id)));
  const { data: reads } = await supabase
    .from("entity_message_reads")
    .select("entity_type, entity_id, last_read_at")
    .eq("user_id", userId)
    .in("entity_id", entityIds);
  const readMap = new Map<string, string>();
  for (const r of (reads ?? []) as any[]) {
    readMap.set(`${r.entity_type}:${r.entity_id}`, r.last_read_at);
  }

  const byEntity = new Map<string, UnreadEntityThread>();
  for (const m of rows) {
    const key = `${m.entity_type}:${m.entity_id}`;
    const lastRead = readMap.get(key);
    const isUnread =
      !lastRead ||
      new Date(m.created_at).getTime() > new Date(lastRead).getTime();
    if (!isUnread) continue;
    const existing = byEntity.get(key);
    if (existing) {
      existing.count++; // rows are desc → latest already captured
      continue;
    }
    const body = m.message ?? "";
    byEntity.set(key, {
      entity_type: m.entity_type,
      entity_id: m.entity_id,
      count: 1,
      latestPreview: body.length > 80 ? body.slice(0, 78) + "…" : body,
      latestAt: m.created_at,
    });
  }
  return Array.from(byEntity.values());
}
