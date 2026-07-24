"use server";

/**
 * Integrations Phase 1 — "My channels" (per-rep click-to-chat handles).
 *
 * Self-scoped for EVERY role: a user only ever reads/writes their own rows.
 * No capability gates the verb — the RLS on `user_channels` (m165,
 * `user_id = auth.uid()` for write) is the guard. Support fixes to another
 * user's handles happen in the DB, audited — never through this action.
 */

import { createClient } from "@/lib/supabase/server";
import { getCurrentUserRole } from "@/lib/auth";
import { isUserChannel, type UserChannel } from "@/features/Intergration/lib/integrations";

export type { UserChannel };

export type UserChannelRow = {
  user_id: string;
  channel: UserChannel;
  handle: string;
  is_active: boolean;
  updated_at: string | null;
};

/** Save (or clear, when handle is blank) one of the caller's own channels. */
export async function saveMyChannel(channel: UserChannel, handle: string | null): Promise<void> {
  if (!isUserChannel(channel)) throw new Error(`Unknown channel: ${channel}`);
  const { userId } = await getCurrentUserRole();
  if (!userId) throw new Error("Not authenticated.");

  const supabase = createClient();
  const trimmed = (handle ?? "").trim();

  if (!trimmed) {
    const { error } = await supabase
      .from("user_channels")
      .delete()
      .eq("user_id", userId)
      .eq("channel", channel);
    if (error) throw new Error(`Could not clear channel: ${error.message}`);
    return;
  }

  const { error } = await supabase.from("user_channels").upsert(
    { user_id: userId, channel, handle: trimmed, is_active: true, updated_at: new Date().toISOString() },
    { onConflict: "user_id,channel" }
  );
  if (error) throw new Error(`Could not save channel: ${error.message}`);
}

/** List the caller's own channels. */
export async function listMyChannels(): Promise<UserChannelRow[]> {
  const { userId } = await getCurrentUserRole();
  if (!userId) return [];
  const supabase = createClient();
  const { data } = await supabase
    .from("user_channels")
    .select("*")
    .eq("user_id", userId)
    .order("channel", { ascending: true });
  return (data ?? []) as UserChannelRow[];
}
