"use server";

/**
 * Integrations Phase 2 — outbound webhook endpoint management (admin).
 * The HMAC signing secret is returned ONCE from createWebhookEndpoint. Verbs
 * gated by integration.manage; RLS restricts the tables to admins. The
 * delivery outbox (webhook_deliveries) is filled + drained by Step 4b.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/permissions";
import { generateWebhookSecret } from "@/features/Intergration/lib/webhook-crypto";
import { WEBHOOK_EVENTS } from "@/features/Intergration/lib/integrations";

export type WebhookEndpointRow = {
  id: string;
  url: string;
  event_types: string[];
  is_active: boolean;
  created_at: string | null;
};

export type WebhookDeliveryRow = {
  id: string;
  endpoint_id: string;
  event_type: string;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  last_attempt_at: string | null;
  response_code: number | null;
  created_at: string | null;
};

export async function listWebhookEndpoints(): Promise<WebhookEndpointRow[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("webhook_endpoints")
    .select("id, url, event_types, is_active, created_at")
    .order("created_at", { ascending: false });
  return (data ?? []) as WebhookEndpointRow[];
}

export async function listRecentDeliveries(limit = 20): Promise<WebhookDeliveryRow[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("webhook_deliveries")
    .select("id, endpoint_id, event_type, status, attempts, last_attempt_at, response_code, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as WebhookDeliveryRow[];
}

/** Create an endpoint; the signing secret is returned once (show, then it's gone). */
export async function createWebhookEndpoint(input: {
  url: string;
  eventTypes: string[];
}): Promise<{ id: string; secret: string }> {
  await requireCapability("integration.manage_api_keys");
  const url = (input.url ?? "").trim();
  if (!/^https:\/\/.+/i.test(url)) throw new Error("Enter a valid https:// URL.");
  const events = (input.eventTypes ?? []).filter((e) => (WEBHOOK_EVENTS as readonly string[]).includes(e));
  if (events.length === 0) throw new Error("Pick at least one event.");

  const secret = generateWebhookSecret();
  const supabase = createClient();
  const { data, error } = await supabase
    .from("webhook_endpoints")
    .insert({ url, event_types: events, secret, is_active: true })
    .select("id")
    .single();
  if (error) throw new Error(`Could not create endpoint: ${error.message}`);

  revalidatePath("/settings/integrations");
  return { id: (data as { id: string }).id, secret };
}

export async function setWebhookActive(id: string, active: boolean): Promise<void> {
  await requireCapability("integration.manage_api_keys");
  const supabase = createClient();
  const { error } = await supabase.from("webhook_endpoints").update({ is_active: active }).eq("id", id);
  if (error) throw new Error(`Could not update endpoint: ${error.message}`);
  revalidatePath("/settings/integrations");
}

export async function deleteWebhookEndpoint(id: string): Promise<void> {
  await requireCapability("integration.manage_api_keys");
  const supabase = createClient();
  const { error } = await supabase.from("webhook_endpoints").delete().eq("id", id);
  if (error) throw new Error(`Could not delete endpoint: ${error.message}`);
  revalidatePath("/settings/integrations");
}
