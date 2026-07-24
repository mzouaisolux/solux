/**
 * Integrations — inbound_unmatched writer seam (m184).
 *
 * The future inbound receiver route (area A: /api/integrations/inbound/*) has no
 * user session and must write above RLS, so it uses the service-role client. When
 * `resolveInboundMatch` finds no client/contact for the sender, the route calls
 * `recordUnmatchedInbound` to park the message in the review queue instead of
 * dropping it. Kept out of the "use server" action file (that file may only export
 * async server actions) and out of the pure lib (this imports the service client).
 *
 * SERVER-ONLY. Never import from a client component or a session-bound action.
 */

import { createServiceClient } from "@/lib/supabase/service";
import {
  isInteractionChannel,
  inboundSummary,
  type InteractionChannel,
} from "@/features/Intergration/lib/integrations";

export type UnmatchedInboundInput = {
  channel: InteractionChannel;
  /** E.164 phone / Zalo user_id / chat_id / email. */
  fromIdentifier: string;
  displayName?: string | null;
  /** Full message text; trimmed to ~80 chars for the summary. */
  text?: string | null;
  /** Anything else worth keeping from the platform webhook (message id, ts…). */
  payload?: Record<string, unknown>;
};

/**
 * Park an unmatched inbound message in the review queue. Returns the new row id,
 * or null when the service role isn't configured (local dev / build) so the
 * caller degrades gracefully rather than throwing.
 */
export async function recordUnmatchedInbound(input: UnmatchedInboundInput): Promise<string | null> {
  if (!isInteractionChannel(input.channel)) throw new Error(`Unknown channel: ${input.channel}`);
  const from = (input.fromIdentifier ?? "").trim();
  if (!from) throw new Error("fromIdentifier is required.");

  const svc = createServiceClient();
  if (!svc) return null;

  const { data, error } = await svc
    .from("inbound_unmatched")
    .insert({
      channel: input.channel,
      from_identifier: from,
      display_name: input.displayName?.trim() || null,
      summary: inboundSummary(input.text),
      payload: input.payload ?? {},
    })
    .select("id")
    .single();
  if (error) throw new Error(`Could not record unmatched inbound: ${error.message}`);
  return (data as { id: string }).id;
}
