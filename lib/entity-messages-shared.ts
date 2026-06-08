/**
 * Pure type exports for entity messages — safe to import from both
 * client and server.
 *
 * Why a separate file
 * -------------------
 * `lib/entity-messages.ts` holds server-only helpers (`createClient`
 * from `@/lib/supabase/server`, which pulls `next/headers`). As soon
 * as a CLIENT component imports anything — even a `type` — from that
 * file, Next.js tries to bundle the whole module and fails:
 *
 *   ./lib/supabase/server.ts
 *   You're importing a component that needs next/headers.
 *
 * Splitting the pure stuff out here gives client components a safe
 * import surface. The server-side `lib/entity-messages.ts` re-exports
 * everything here, so server code can keep doing one import.
 *
 * Phase A1 scope
 * --------------
 * The schema (m049) reserves columns for request_type / structured
 * replies / parent_message_id, but A1 only uses the `comment` kind.
 * Free topics, mentions and structured workflows ship in later
 * phases — keep the types narrow so the UI surface stays minimal.
 */

export type EntityMessageEntityType =
  | "document"
  | "task_list"
  | "production_order"
  | "client";

export type EntityMessage = {
  id: string;
  entity_type: EntityMessageEntityType;
  entity_id: string;
  user_id: string | null;
  message: string | null;
  /** A1 only emits 'comment'. The other kinds live in the schema for
   *  forward-compat (m049 reserves request / reply / structured_reply
   *  for later phases). */
  message_kind:
    | "comment"
    | "request"
    | "reply"
    | "structured_reply";
  request_type: string | null;
  parent_message_id: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
};

export type EntityMessageWithAuthor = EntityMessage & {
  /** Resolved from `user_profiles` view if available. */
  author_email: string | null;
  author_name: string | null;
};

/** Lightweight initials for avatar fallback (no Avatar lib needed). */
export function authorInitials(
  m: Pick<EntityMessageWithAuthor, "author_name" | "author_email">
): string {
  const src = m.author_name || m.author_email || "?";
  const parts = src
    .replace(/@.*$/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return (parts[0]?.slice(0, 2) ?? "?").toUpperCase();
}

/** Human label for a message author, with sensible fallback. */
export function authorLabel(
  m: Pick<EntityMessageWithAuthor, "author_name" | "author_email">
): string {
  return m.author_name || m.author_email || "Unknown user";
}
