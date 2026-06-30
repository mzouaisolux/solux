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

/** Read a numeric setting — spec default when missing or pre-m120. */
export async function getNumberSetting(
  supabase: ReturnType<typeof createClient>,
  key: string,
  fallback: number
): Promise<number> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error || !data) return fallback;
  const v = (data.value as any)?.value ?? data.value;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
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
  return { error: error ? error.message : null };
}
