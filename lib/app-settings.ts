// =====================================================================
// app_settings (m120) — tunable product thresholds.
//
// Locked dashboard spec: the preventive window is an ADMIN SETTING,
// default 7 days, never hardcoded at call sites. Callers always go
// through these helpers so a pre-m120 database silently falls back to
// the spec default (settings are a tunable, never a blocker).
// =====================================================================

import type { createClient } from "@/lib/supabase/server";

export const PREVENTIVE_DAYS_KEY = "dashboard.preventive_days";
export const PREVENTIVE_DAYS_DEFAULT = 7;

/* PERF (2026-07-11 perf pass): app_settings are tunable thresholds that change
   rarely (an admin edits them occasionally) but were read on EVERY dashboard
   load (~1 query per load). A tiny module-level cache with a short TTL removes
   that round-trip for all but the first request in the window. The write path
   (setNumberSetting) clears the entry so an admin sees their change instantly.
   Per-process cache — in prod each instance refreshes within TTL_MS. */
const SETTING_TTL_MS = 60_000;
const settingCache = new Map<string, { value: number; expiresAt: number }>();

/** Read a numeric setting — spec default when missing or pre-m120. */
export async function getNumberSetting(
  supabase: ReturnType<typeof createClient>,
  key: string,
  fallback: number
): Promise<number> {
  const hit = settingCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error || !data) return fallback; // don't cache the fallback — retry next time
  const v = (data.value as any)?.value ?? data.value;
  const n = Number(v);
  const resolved = Number.isFinite(n) && n > 0 ? n : fallback;
  settingCache.set(key, { value: resolved, expiresAt: Date.now() + SETTING_TTL_MS });
  return resolved;
}

/** Write a numeric setting (caller must already be admin-gated). */
export async function setNumberSetting(
  supabase: ReturnType<typeof createClient>,
  key: string,
  value: number,
  userId: string | null
): Promise<{ error: string | null }> {
  const { error } = await supabase.from("app_settings").upsert({
    key,
    value: { value },
    updated_at: new Date().toISOString(),
    updated_by: userId,
  });
  // Invalidate the read cache so the admin sees their own change immediately
  // (other instances refresh within the TTL window).
  if (!error) settingCache.delete(key);
  return { error: error ? error.message : null };
}
