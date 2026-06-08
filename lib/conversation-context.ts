/**
 * Pathname → entity context resolution for the conversation drawer.
 *
 * The drawer is mounted globally in `app/(app)/layout.tsx`. It reads
 * the current pathname client-side and asks "what entity is this user
 * looking at?". The answer drives the contextual conversation thread.
 *
 * Pure module — safe to import from both client and server. No DB
 * access here; the title shown in the drawer header is resolved
 * server-side via a separate helper if needed.
 *
 * Supported routes
 * ----------------
 *   /documents/:id              → document
 *   /task-lists/:id             → task_list
 *   /production/orders/:id      → production_order
 *   /clients/:id                → client
 *
 * Anything else returns null, and the drawer shows an empty state
 * inviting the user to open one of those routes.
 */

import type { EntityMessageEntityType } from "./entity-messages-shared";

export type ConversationContext = {
  entityType: EntityMessageEntityType;
  entityId: string;
};

/**
 * Match the pathname against the known entity routes and return the
 * context (or null when nothing matches).
 *
 * We deliberately do NOT match list pages (`/documents`, `/clients`)
 * — only detail routes have an entity to converse about.
 *
 * IDs are matched as `[a-zA-Z0-9-]+` (UUIDs without curly braces),
 * which keeps the resolver robust to query strings / trailing
 * slashes / nested routes (e.g. `/documents/abc/edit` still resolves
 * to the document).
 */
export function resolveConversationContext(
  pathname: string | null | undefined
): ConversationContext | null {
  if (!pathname) return null;

  // Strip query string + trailing slash for stable matching.
  const clean = pathname.split("?")[0].replace(/\/+$/, "");

  const patterns: Array<{
    re: RegExp;
    entityType: EntityMessageEntityType;
  }> = [
    { re: /^\/documents\/([a-zA-Z0-9-]+)(?:\/|$)/, entityType: "document" },
    { re: /^\/task-lists\/([a-zA-Z0-9-]+)(?:\/|$)/, entityType: "task_list" },
    {
      re: /^\/production\/orders\/([a-zA-Z0-9-]+)(?:\/|$)/,
      entityType: "production_order",
    },
    { re: /^\/clients\/([a-zA-Z0-9-]+)(?:\/|$)/, entityType: "client" },
  ];

  for (const p of patterns) {
    const m = clean.match(p.re);
    if (m && m[1] && m[1] !== "new") {
      // Skip create routes ("/documents/new") — there's no entity yet
      // to attach a conversation to.
      return { entityType: p.entityType, entityId: m[1] };
    }
  }
  return null;
}

/**
 * Human-readable label for an entity type — shown in the drawer
 * header alongside the entity's own title ("Quotation SLX-VPL-26-030").
 */
export const ENTITY_TYPE_LABEL: Record<EntityMessageEntityType, string> = {
  document: "Quotation",
  task_list: "Task list",
  production_order: "Production order",
  client: "Client",
};
