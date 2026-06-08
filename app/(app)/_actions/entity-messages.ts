"use server";

/**
 * Entity messages — server actions for the contextual conversation
 * layer (the persistent drawer chat).
 *
 * Design principles (Phase A1)
 * ----------------------------
 * 1. Conversations are independent from the audit log. Posting a
 *    message does NOT emit an event — the Timeline stays clean and
 *    reflects only workflow lifecycle (status changes, deadline
 *    shifts, etc.). Conversations live on their own surface.
 *
 * 2. The drawer is a client component that calls these actions then
 *    re-fetches its data from `/api/conversations/[type]/[id]`. We
 *    don't revalidatePath the host route — the chat should never
 *    cause the underlying page to flash/re-render.
 *
 * 3. Only the most basic primitives ship in A1: post a comment, mark
 *    a thread as read. Free topics, mentions, structured replies and
 *    request workflows are deferred to A2+.
 *
 * Auth model
 * ----------
 * - Any authenticated user can post a message on an entity they can
 *   READ (RLS handles the read scope — SELECT visibility implies
 *   write permission).
 * - markEntityRead is per-user, always allowed for the caller's own
 *   row.
 */

import { createClient } from "@/lib/supabase/server";
import { getCurrentUserRole } from "@/lib/auth";
import type { EntityMessageEntityType } from "@/lib/entity-messages-shared";

const VALID_ENTITY_TYPES: EntityMessageEntityType[] = [
  "document",
  "task_list",
  "production_order",
  "client",
];

/** Cheap pre-flight: confirm the (entity_type, entity_id) pair is
 *  visible to the current user. RLS would block the message insert
 *  anyway, but a clean "entity not visible" error beats Postgres's
 *  generic "new row violates row-level security policy". */
async function assertEntityReadable(
  entityType: EntityMessageEntityType,
  entityId: string
): Promise<void> {
  const supabase = createClient();
  const table =
    entityType === "document"
      ? "documents"
      : entityType === "task_list"
      ? "production_task_lists"
      : entityType === "production_order"
      ? "production_orders"
      : "clients";
  const { data, error } = await supabase
    .from(table)
    .select("id")
    .eq("id", entityId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    throw new Error(
      `Entity not found or not visible: ${entityType}/${entityId}`
    );
  }
}

/* ============================================================
   1. Post a comment
   ============================================================ */
/**
 * Post a free-form message into the conversation for the given entity.
 *
 * Returns the inserted message id so the client can scroll to it /
 * mark it locally as "just sent" without waiting for the re-fetch.
 */
export async function postEntityComment(formData: FormData): Promise<{
  ok: true;
  id: string;
}> {
  const entityType = String(
    formData.get("entity_type")
  ) as EntityMessageEntityType;
  const entityId = String(formData.get("entity_id"));
  const message = String(formData.get("message") ?? "").trim();

  if (!VALID_ENTITY_TYPES.includes(entityType)) {
    throw new Error(`Invalid entity_type: ${entityType}`);
  }
  if (!entityId) throw new Error("entity_id is required");
  if (!message) throw new Error("Message cannot be empty");
  if (message.length > 4000) {
    throw new Error("Message is too long (4000 chars max)");
  }

  await assertEntityReadable(entityType, entityId);

  const supabase = createClient();
  const { userId } = await getCurrentUserRole();

  const { data, error } = await supabase
    .from("entity_messages")
    .insert({
      entity_type: entityType,
      entity_id: entityId,
      user_id: userId,
      message,
      message_kind: "comment",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  return { ok: true, id: data.id as string };
}

/* ============================================================
   2. Mark thread as read (upserts entity_message_reads)
   ============================================================ */
/**
 * Update the current user's `last_read_at` for this entity. Called
 * each time the drawer opens (and any time the user pulls the thread
 * back into view after new activity).
 *
 * Soft-fails when m049 isn't applied — read-state should never break
 * the chat surface.
 */
export async function markEntityRead(formData: FormData): Promise<void> {
  const entityType = String(
    formData.get("entity_type")
  ) as EntityMessageEntityType;
  const entityId = String(formData.get("entity_id"));
  if (!VALID_ENTITY_TYPES.includes(entityType)) return;
  if (!entityId) return;

  const supabase = createClient();
  const { userId } = await getCurrentUserRole();
  if (!userId) return;

  const { error } = await supabase.from("entity_message_reads").upsert(
    {
      user_id: userId,
      entity_type: entityType,
      entity_id: entityId,
      last_read_at: new Date().toISOString(),
    },
    { onConflict: "user_id,entity_type,entity_id" }
  );
  if (error && !/entity_message_reads/.test(error.message ?? "")) {
    console.warn("[markEntityRead]", error.message);
  }
}
