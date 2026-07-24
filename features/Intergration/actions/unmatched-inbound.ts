"use server";

/**
 * Integrations — unmatched-inbound review (server actions, m184).
 *
 * The review side of INTEGRATION_NEXT_FLOWS.md area B. Verbs gated by
 * `integration.manage`; the nouns (inbound_unmatched, and the client the row is
 * reconciled onto) are RLS-gated — inbound_unmatched is admin-only (m184), and
 * the appended client_interactions row goes through the caller's session so its
 * own RLS/insert policy (m164) still applies.
 *
 * Lifecycle: pending -> resolved (reconciled: appends a client_interactions row)
 * | ignored (spam / wrong number: no timeline write). Both stamp the same row —
 * this table is NOT append-only (client_interactions is).
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/permissions";
import { emitEvent } from "@/lib/events";
import { isInteractionChannel, type InteractionChannel } from "@/features/Intergration/lib/integrations";

export type UnmatchedInboundRow = {
  id: string;
  channel: InteractionChannel;
  from_identifier: string;
  display_name: string | null;
  summary: string | null;
  payload: Record<string, unknown>;
  received_at: string;
};

export type ClientMatchOption = {
  id: string;
  company_name: string | null;
  client_code: string | null;
  phone_number: string | null;
};

/** The open review queue (pending only), newest first. RLS: admin-like (m184). */
export async function listUnmatchedInbound(limit = 50): Promise<UnmatchedInboundRow[]> {
  await requireCapability("integration.manage");
  const supabase = createClient();
  const { data } = await supabase
    .from("inbound_unmatched")
    .select("id, channel, from_identifier, display_name, summary, payload, received_at")
    .eq("status", "pending")
    .order("received_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as UnmatchedInboundRow[];
}

/** Typeahead for the reconcile picker — matches company name or client code. */
export async function searchClientsForReconcile(query: string): Promise<ClientMatchOption[]> {
  await requireCapability("integration.manage");
  // Strip characters that either break the PostgREST .or() grammar (commas,
  // parentheses) or are LIKE wildcards (%, _), so the search is a plain
  // substring match and can't be used to smuggle filter syntax.
  const q = (query ?? "").replace(/[(),%_*]/g, " ").trim();
  if (q.length < 2) return [];
  const supabase = createClient();
  const like = `%${q}%`;
  const { data } = await supabase
    .from("clients")
    .select("id, company_name, client_code, phone_number")
    .or(`company_name.ilike.${like},client_code.ilike.${like}`)
    .order("company_name", { ascending: true })
    .limit(10);
  return (data ?? []) as ClientMatchOption[];
}

/**
 * Reconcile a pending row onto a client: append the equivalent client_interactions
 * row (auto / inbound) and stamp the unmatched row resolved. Refuses if the row
 * isn't pending (guards against a double-reconcile race).
 */
export async function reconcileUnmatchedInbound(input: {
  id: string;
  clientId: string;
  contactId?: string | null;
}): Promise<void> {
  await requireCapability("integration.manage");
  if (!input.id) throw new Error("id is required.");
  if (!input.clientId) throw new Error("clientId is required.");

  const supabase = createClient();
  const { data: auth } = await supabase.auth.getUser();
  const resolvedBy = auth?.user?.id ?? null;

  const { data: row, error: readErr } = await supabase
    .from("inbound_unmatched")
    .select("id, channel, from_identifier, display_name, summary, payload, status")
    .eq("id", input.id)
    .maybeSingle();
  if (readErr) throw new Error(`Could not read the message: ${readErr.message}`);
  if (!row) throw new Error("That message no longer exists.");
  if ((row as any).status !== "pending") throw new Error("That message was already handled.");

  const channel = (row as any).channel as string;
  if (!isInteractionChannel(channel)) throw new Error(`Unknown channel on the stored message: ${channel}`);

  // 1) Append the timeline row through the caller's session (m164 insert RLS
  //    still applies — admins pass; the client must be visible to them).
  const { data: interaction, error: insErr } = await supabase
    .from("client_interactions")
    .insert({
      client_id: input.clientId,
      contact_id: input.contactId ?? null,
      channel,
      direction: "inbound",
      source: "auto",
      summary: (row as any).summary ?? null,
      payload: {
        ...((row as any).payload ?? {}),
        reconciled_from_unmatched: input.id,
        from_identifier: (row as any).from_identifier,
      },
    })
    .select("id")
    .single();
  if (insErr) throw new Error(`Could not add to the client timeline: ${insErr.message}`);

  // 2) Stamp the queue row resolved. Guard on status again so two reviewers
  //    can't both resolve it (only the first UPDATE matches status='pending').
  const { data: updated, error: updErr } = await supabase
    .from("inbound_unmatched")
    .update({
      status: "resolved",
      resolved_client_id: input.clientId,
      resolved_contact_id: input.contactId ?? null,
      resolved_interaction_id: (interaction as { id: string }).id,
      resolved_by: resolvedBy,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", input.id)
    .eq("status", "pending")
    .select("id");
  if (updErr) throw new Error(`Timeline updated but the queue row didn't close: ${updErr.message}`);
  if (!updated || updated.length === 0) {
    throw new Error("That message was handled by someone else just now.");
  }

  await emitEvent({
    entity_type: "client",
    entity_id: input.clientId,
    event_type: "client.interaction_logged",
    message: `Inbound ${channel} reconciled from the unmatched queue`,
    payload: { channel, direction: "inbound", source: "auto", reconciled: true },
    bestEffort: true,
  });

  revalidatePath("/settings/integrations");
  revalidatePath(`/clients/${input.clientId}`);
}

/** Dismiss a pending row (spam / wrong number). No timeline write. */
export async function ignoreUnmatchedInbound(id: string): Promise<void> {
  await requireCapability("integration.manage");
  if (!id) throw new Error("id is required.");
  const supabase = createClient();
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("inbound_unmatched")
    .update({ status: "ignored", resolved_by: auth?.user?.id ?? null, resolved_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending");
  if (error) throw new Error(`Could not dismiss the message: ${error.message}`);
  revalidatePath("/settings/integrations");
}
