/**
 * Integrations — inbound receive core (area A). Shared match + log logic behind
 * the platform receiver routes (e.g. /api/integrations/inbound/whatsapp).
 *
 * Given an inbound message, resolve the sender phone to a client/contact and
 * either append a client_interactions row (matched) or park it in
 * inbound_unmatched for review (no match). SERVER-ONLY: takes a service-role
 * client because receivers have no user session and must act above RLS.
 *
 * Mirrors the phone-matching precedent in app/api/integrations/interactions
 * (suffix compare via phonesMatch over a candidate set). On a MATCH it also
 * emits client.message_received via `emitEventWith` (the session-free emit path,
 * with the service client + a null/system actor) so the client owner's bell
 * rings — the events feed is RLS-scoped, so the alert reaches the owner (+
 * managers) without explicit recipient wiring. The emit is best-effort: a
 * failure logs but never blocks the durable timeline row.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { phonesMatch, inboundSummary, type InteractionChannel } from "@/features/Intergration/lib/integrations";
import { recordUnmatchedInbound } from "@/features/Intergration/lib/inbound-unmatched";
import { emitEventWith } from "@/lib/events";

const CANDIDATE_LIMIT = 5000;

export type SenderMatch = { clientId: string; contactId: string | null };

/**
 * Resolve a sender phone to a client (contacts first, then the client's own
 * number). Suffix compare in JS for reliability across stored formats. Returns
 * null when no client owns the number — the unmatched case.
 */
export async function matchSenderToClient(
  svc: SupabaseClient,
  phone: string
): Promise<SenderMatch | null> {
  const { data: contacts } = await svc
    .from("contacts")
    .select("id, client_id, phone")
    .not("phone", "is", null)
    .order("created_at", { ascending: false })
    .limit(CANDIDATE_LIMIT);
  const contactHit = (contacts ?? []).find((c: any) => phonesMatch(c.phone, phone));
  if (contactHit) return { clientId: contactHit.client_id, contactId: contactHit.id };

  const { data: clients } = await svc
    .from("clients")
    .select("id, phone_number")
    .not("phone_number", "is", null)
    .order("created_at", { ascending: false })
    .limit(CANDIDATE_LIMIT);
  const clientHit = (clients ?? []).find((c: any) => phonesMatch(c.phone_number, phone));
  if (clientHit) return { clientId: clientHit.id, contactId: null };

  return null;
}

export type InboundMessageInput = {
  channel: InteractionChannel;
  /** Sender phone / platform id (WhatsApp wa_id = digits, no '+'). */
  from: string;
  name?: string | null;
  text?: string | null;
  messageId?: string | null;
  /** Unix seconds from the platform, if any. */
  timestamp?: number | null;
  /** Extra platform fields worth keeping (raw type, etc.). */
  payload?: Record<string, unknown>;
};

export type InboundResult =
  | { matched: true; clientId: string; interactionId: string }
  | { matched: false; unmatchedId: string | null }
  | { skipped: "no_author" };

/**
 * Log one inbound message: append to the matched client's timeline, or park it
 * for review. `fallbackAuthor` (e.g. the API-key creator) is used only when the
 * matched client has no owner, since client_interactions.created_by is NOT NULL.
 */
export async function logInboundMessage(
  svc: SupabaseClient,
  input: InboundMessageInput,
  fallbackAuthor: string | null = null
): Promise<InboundResult> {
  const from = (input.from ?? "").trim();
  const summary = inboundSummary(input.text);
  const happenedAt =
    input.timestamp && Number.isFinite(input.timestamp)
      ? new Date(input.timestamp * 1000).toISOString()
      : new Date().toISOString();
  const basePayload = {
    ...(input.payload ?? {}),
    from_identifier: from,
    ...(input.messageId ? { platform_message_id: input.messageId } : {}),
  };

  const match = await matchSenderToClient(svc, from);

  if (!match) {
    const unmatchedId = await recordUnmatchedInbound({
      channel: input.channel,
      fromIdentifier: from,
      displayName: input.name ?? null,
      text: input.text ?? null,
      payload: basePayload,
    });
    return { matched: false, unmatchedId };
  }

  // Attribute the row to the client's owner (created_by is NOT NULL).
  const { data: client } = await svc
    .from("clients")
    .select("sales_owner_id, created_by")
    .eq("id", match.clientId)
    .maybeSingle();
  const author = (client as any)?.sales_owner_id ?? (client as any)?.created_by ?? fallbackAuthor ?? null;
  if (!author) return { skipped: "no_author" };

  const { data: inserted, error } = await svc
    .from("client_interactions")
    .insert({
      client_id: match.clientId,
      contact_id: match.contactId,
      channel: input.channel,
      direction: "inbound",
      source: "auto",
      summary,
      payload: basePayload,
      happened_at: happenedAt,
      created_by: author,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Could not log inbound message: ${error.message}`);

  // Ring the owner's bell. Session-free emit with the service client + null
  // actor (system); best-effort so a failure never breaks the receiver.
  await emitEventWith(svc, null, {
    entity_type: "client",
    entity_id: match.clientId,
    event_type: "client.message_received",
    message: summary ? `Customer replied: ${summary}` : "Customer sent a message",
    payload: { channel: input.channel, from_identifier: from },
    bestEffort: true,
  });

  return { matched: true, clientId: match.clientId, interactionId: (inserted as { id: string }).id };
}
