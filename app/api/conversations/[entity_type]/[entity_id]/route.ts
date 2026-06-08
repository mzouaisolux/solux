/**
 * GET /api/conversations/[entity_type]/[entity_id]
 *
 * Single endpoint the drawer hits to render a conversation thread.
 * Returns:
 *   - messages       : the full thread, oldest → newest, with author
 *                      labels resolved
 *   - unread         : count of messages this user hasn't seen
 *   - entity_title   : human-readable label for the drawer header
 *                      ("SLX-VPL-26-030", "Client · Acme Lighting")
 *   - current_user_id: so the client can render "own" bubbles
 *                      differently
 *
 * RLS does the heavy security lifting — if the user can't read the
 * entity, the messages query returns [] naturally. We still validate
 * the (entity_type, entity_id) shape so a malformed URL doesn't blow
 * up.
 *
 * Soft-fails on missing m049 — empty messages + 0 unread so the
 * drawer mounts cleanly during migration rollouts.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  listEntityMessagesWithAuthors,
  getUnreadCountForEntity,
} from "@/lib/entity-messages";
import { getCurrentUserRole } from "@/lib/auth";
import type { EntityMessageEntityType } from "@/lib/entity-messages-shared";

const VALID_ENTITY_TYPES: EntityMessageEntityType[] = [
  "document",
  "task_list",
  "production_order",
  "client",
];

export async function GET(
  _req: Request,
  { params }: { params: { entity_type: string; entity_id: string } }
) {
  const entityType = params.entity_type as EntityMessageEntityType;
  const entityId = params.entity_id;

  if (!VALID_ENTITY_TYPES.includes(entityType)) {
    return NextResponse.json({ error: "Invalid entity_type" }, { status: 400 });
  }
  if (!entityId) {
    return NextResponse.json({ error: "Missing entity_id" }, { status: 400 });
  }

  const [{ userId }, messages] = await Promise.all([
    getCurrentUserRole(),
    listEntityMessagesWithAuthors(entityType, entityId),
  ]);

  const unread = await getUnreadCountForEntity(userId, entityType, entityId);
  const { title: entityTitle, subtitle: entitySubtitle } =
    await resolveEntityTitle(entityType, entityId);

  return NextResponse.json({
    messages,
    unread,
    entity_title: entityTitle,
    // Secondary line for the drawer header — the technical reference
    // (quotation number) when the title is the affair/project name.
    entity_subtitle: entitySubtitle,
    current_user_id: userId,
  });
}

type EntityLabel = { title: string | null; subtitle: string | null };

/**
 * Resolve a human label for the entity, used in the drawer header.
 *
 * For quotations / task lists / production orders we LEAD with the
 * affair (project) name — that's how the team recognises a deal — and
 * keep the document number as a secondary subtitle. Clients use the
 * company name. Best-effort: returns nulls if the entity isn't readable
 * (RLS) or a column doesn't exist (older schemas) — the drawer then
 * falls back to a generic label.
 */
async function resolveEntityTitle(
  entityType: EntityMessageEntityType,
  entityId: string
): Promise<EntityLabel> {
  const supabase = createClient();
  // Compose a {affair name, number} pair into a header title/subtitle.
  const compose = (
    affair: string | null | undefined,
    num: string | null | undefined
  ): EntityLabel => {
    const a = (affair ?? "").trim();
    const n = (num ?? "").trim();
    if (a) return { title: a, subtitle: n || null };
    return { title: n || null, subtitle: null };
  };
  try {
    if (entityType === "document") {
      const { data } = await supabase
        .from("documents")
        .select("number, affair_name")
        .eq("id", entityId)
        .maybeSingle();
      return compose((data as any)?.affair_name, (data as any)?.number);
    }
    if (entityType === "task_list") {
      const { data } = await supabase
        .from("production_task_lists")
        .select(
          "quotation_id, documents:quotation_id(number, affair_name)"
        )
        .eq("id", entityId)
        .maybeSingle();
      const doc = (data as any)?.documents;
      return compose(doc?.affair_name, doc?.number);
    }
    if (entityType === "production_order") {
      const { data } = await supabase
        .from("production_orders")
        .select(
          "quotation_id, documents:quotation_id(number, affair_name)"
        )
        .eq("id", entityId)
        .maybeSingle();
      const doc = (data as any)?.documents;
      return compose(doc?.affair_name, doc?.number);
    }
    if (entityType === "client") {
      const { data } = await supabase
        .from("clients")
        .select("company_name")
        .eq("id", entityId)
        .maybeSingle();
      const name = (data?.company_name as string | undefined) ?? null;
      return { title: name, subtitle: null };
    }
    return { title: null, subtitle: null };
  } catch {
    return { title: null, subtitle: null };
  }
}
