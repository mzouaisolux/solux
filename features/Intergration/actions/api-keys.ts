"use server";

/**
 * Integrations Phase 2 — API key management (admin).
 * Plaintext is returned ONCE from createApiKey and never stored; only the
 * SHA-256 hash + display prefix persist. All verbs gated by
 * integration.manage_api_keys; RLS additionally restricts the table to admins.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/permissions";
import { getCurrentUserRole } from "@/lib/auth";
import { generateApiKey } from "@/features/Intergration/lib/webhook-crypto";

export type ApiKeyRow = {
  id: string;
  label: string;
  prefix: string;
  created_at: string | null;
  revoked_at: string | null;
};

export async function listApiKeys(): Promise<ApiKeyRow[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("api_keys")
    .select("id, label, prefix, created_at, revoked_at")
    .order("created_at", { ascending: false });
  return (data ?? []) as ApiKeyRow[];
}

/** Create a key; the plaintext is returned once (show, then it's gone). */
export async function createApiKey(label: string): Promise<{ id: string; plaintext: string; prefix: string }> {
  await requireCapability("integration.manage_api_keys");
  const clean = (label ?? "").trim();
  if (!clean) throw new Error("A label is required.");

  const { plaintext, hash, prefix } = generateApiKey();
  const { userId } = await getCurrentUserRole();
  const supabase = createClient();
  const { data, error } = await supabase
    .from("api_keys")
    .insert({ label: clean, key_hash: hash, prefix, created_by: userId })
    .select("id")
    .single();
  if (error) throw new Error(`Could not create API key: ${error.message}`);

  revalidatePath("/settings/integrations");
  return { id: (data as { id: string }).id, plaintext, prefix };
}

export async function revokeApiKey(id: string): Promise<void> {
  await requireCapability("integration.manage_api_keys");
  const supabase = createClient();
  const { error } = await supabase
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`Could not revoke key: ${error.message}`);
  revalidatePath("/settings/integrations");
}
