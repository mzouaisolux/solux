"use server";

/**
 * Integrations Phase 3 — business channel connection management (admin).
 *
 * The access token is encrypted (AES-256-GCM) before it's stored and is NEVER
 * returned to the client — listConnections only reports whether a secret is on
 * file (has_secret). Verbs gated by integration.manage; RLS restricts the table
 * to admins. One row per channel (unique index in m169).
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireCapability } from "@/lib/permissions";
import { encryptSecret, hasEncryptionKey } from "@/features/Intergration/lib/connection-crypto";
import { isBusinessChannel, type BusinessChannel } from "@/features/Intergration/lib/providers";

export type ConnectionRow = {
  id: string;
  channel: BusinessChannel;
  label: string;
  config: Record<string, any>;
  is_active: boolean;
  has_secret: boolean;
  created_at: string | null;
  updated_at: string | null;
};

/** List connections WITHOUT any secret material. */
export async function listConnections(): Promise<ConnectionRow[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("integration_connections")
    .select("id, channel, label, config, is_active, secret_ciphertext, created_at, updated_at")
    .order("channel", { ascending: true });
  return (data ?? []).map((r: any) => ({
    id: r.id,
    channel: r.channel,
    label: r.label ?? "",
    config: r.config ?? {},
    is_active: !!r.is_active,
    has_secret: !!r.secret_ciphertext,
    created_at: r.created_at ?? null,
    updated_at: r.updated_at ?? null,
  }));
}

/**
 * Create or update a channel connection. A non-empty `secret` is encrypted and
 * replaces the stored token; an empty/omitted `secret` leaves the existing one
 * untouched (so you can edit the label/config without re-entering the token).
 */
export async function upsertConnection(input: {
  channel: string;
  label?: string;
  config?: Record<string, any>;
  secret?: string | null;
}): Promise<void> {
  await requireCapability("integration.manage");
  if (!isBusinessChannel(input.channel)) throw new Error("Unknown channel.");

  const secret = (input.secret ?? "").trim();
  const supabase = createClient();

  const row: Record<string, any> = {
    channel: input.channel,
    label: (input.label ?? "").trim(),
    config: input.config ?? {},
    updated_at: new Date().toISOString(),
  };

  if (secret) {
    if (!hasEncryptionKey()) {
      throw new Error("Cannot store a token: INTEGRATION_ENC_KEY is not configured on the server.");
    }
    const enc = encryptSecret(secret);
    row.secret_ciphertext = enc.ciphertext;
    row.secret_iv = enc.iv;
    row.secret_tag = enc.tag;
  }

  const { error } = await supabase
    .from("integration_connections")
    .upsert(row, { onConflict: "channel" });
  if (error) throw new Error(`Could not save connection: ${error.message}`);

  revalidatePath("/settings/integrations");
}

export async function setConnectionActive(channel: string, active: boolean): Promise<void> {
  await requireCapability("integration.manage");
  if (!isBusinessChannel(channel)) throw new Error("Unknown channel.");
  const supabase = createClient();
  const { error } = await supabase
    .from("integration_connections")
    .update({ is_active: active, updated_at: new Date().toISOString() })
    .eq("channel", channel);
  if (error) throw new Error(`Could not update connection: ${error.message}`);
  revalidatePath("/settings/integrations");
}

/**
 * Channels that are active AND have a stored token — i.e. ready to send.
 * For the send composer (client page). Gated by integration.send_business;
 * uses the service client to read past the admin-only RLS but returns ONLY the
 * channel names — no secrets, no config.
 */
export async function listActiveSendChannels(): Promise<BusinessChannel[]> {
  await requireCapability("integration.send_business");
  const svc = createServiceClient();
  if (!svc) return [];
  const { data } = await svc
    .from("integration_connections")
    .select("channel")
    .eq("is_active", true)
    .not("secret_ciphertext", "is", null);
  return (data ?? []).map((r: any) => r.channel).filter(isBusinessChannel);
}

/** Disconnect: remove the row (token included). */
export async function disconnectConnection(channel: string): Promise<void> {
  await requireCapability("integration.manage");
  if (!isBusinessChannel(channel)) throw new Error("Unknown channel.");
  const supabase = createClient();
  const { error } = await supabase.from("integration_connections").delete().eq("channel", channel);
  if (error) throw new Error(`Could not disconnect: ${error.message}`);
  revalidatePath("/settings/integrations");
}
