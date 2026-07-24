"use server";

/**
 * Integrations Phase 1 — client interaction log (server actions).
 *
 * `logInteraction` appends one row to `client_interactions` (append-only table,
 * m164). Security: `integration.log_interaction` capability (real role) gates
 * the verb; RLS gates the noun (which clients — insert only where the caller
 * owns the client or is management). `listInteractions` is read-only; RLS
 * enforces visibility (parent client, finance excluded).
 *
 * Wired into app/ via the client page + components under this feature folder.
 * Corrections are a follow-up `note` row — there is no update/delete.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/permissions";
import { emitEvent } from "@/lib/events";
import {
  isInteractionChannel,
  isInteractionDirection,
  type InteractionChannel,
  type InteractionDirection,
  type InteractionSource,
} from "@/features/Intergration/lib/integrations";

export type { InteractionChannel, InteractionDirection, InteractionSource };

export type ClientInteraction = {
  id: string;
  client_id: string;
  contact_id: string | null;
  channel: InteractionChannel;
  direction: InteractionDirection;
  source: InteractionSource;
  summary: string | null;
  payload: Record<string, unknown>;
  happened_at: string;
  created_by: string | null;
  created_at: string | null;
};

/** Append one interaction to a client's timeline. */
export async function logInteraction(input: {
  clientId: string;
  contactId?: string | null;
  channel: InteractionChannel;
  direction?: InteractionDirection;
  summary?: string | null;
  source?: InteractionSource;
}): Promise<void> {
  await requireCapability("integration.log_interaction");

  if (!input.clientId) throw new Error("clientId is required.");
  if (!isInteractionChannel(input.channel)) {
    throw new Error(`Unknown channel: ${input.channel}`);
  }
  const direction = input.direction ?? "outbound";
  if (!isInteractionDirection(direction)) {
    throw new Error(`Unknown direction: ${direction}`);
  }

  const supabase = createClient();
  const { error } = await supabase.from("client_interactions").insert({
    client_id: input.clientId,
    contact_id: input.contactId ?? null,
    channel: input.channel,
    direction,
    source: input.source ?? "manual",
    summary: input.summary?.trim() || null,
  });
  if (error) throw new Error(`Could not log interaction: ${error.message}`);

  await emitEvent({
    entity_type: "client",
    entity_id: input.clientId,
    event_type: "client.interaction_logged",
    message: `Interaction logged (${input.channel})`,
    payload: { channel: input.channel, direction, source: input.source ?? "manual" },
    bestEffort: true,
  });

  revalidatePath(`/clients/${input.clientId}`);
}

/** Read a client's interaction timeline (RLS enforces visibility). */
export async function listInteractions(clientId: string, limit = 50): Promise<ClientInteraction[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("client_interactions")
    .select("*")
    .eq("client_id", clientId)
    .order("happened_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as ClientInteraction[];
}
