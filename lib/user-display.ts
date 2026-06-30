/**
 * User display labels — one resolver for "who is this person" across
 * the app (conversations, forecast-by-rep, business KPIs, audit
 * timelines).
 *
 * Precedence for a label:
 *   1. user_profiles.display_name   ("John Smith", "Benin Logistics")
 *   2. "<role> · <uuid8>"           (legacy fallback when no name set)
 *   3. "<uuid8>…"                   (no role either)
 *
 * Server-only (reads via the request-scoped Supabase client). Soft-
 * fails to the legacy fallback when m052 (user_profiles) isn't applied
 * yet — so nothing breaks during a migration rollout.
 */

import { createClient } from "@/lib/supabase/server";

export type UserLabel = {
  /** Best human label, never empty. */
  label: string;
  /** The explicit display name, or null if none set. */
  displayName: string | null;
  role: string | null;
};

/**
 * Resolve labels for a set of user ids in two batched queries.
 * Returns a Map keyed by user id. Ids with no data still get a
 * uuid-prefix fallback so callers can index safely.
 */
export async function resolveUserLabels(
  userIds: (string | null | undefined)[]
): Promise<Map<string, UserLabel>> {
  const out = new Map<string, UserLabel>();
  const ids = Array.from(
    new Set(userIds.filter((x): x is string => !!x))
  );
  if (ids.length === 0) return out;

  const supabase = createClient();

  // Display names (soft-fail if m052 not applied).
  const nameById = new Map<string, string>();
  {
    const { data, error } = await supabase
      .from("user_profiles")
      .select("user_id, display_name")
      .in("user_id", ids);
    if (!error) {
      for (const r of (data ?? []) as Array<{
        user_id: string;
        display_name: string | null;
      }>) {
        if (r.display_name && r.display_name.trim()) {
          nameById.set(r.user_id, r.display_name.trim());
        }
      }
    }
  }

  // Roles (for the legacy fallback label).
  const roleById = new Map<string, string>();
  {
    const { data, error } = await supabase
      .from("user_roles")
      .select("user_id, role")
      .in("user_id", ids);
    if (!error) {
      for (const r of (data ?? []) as Array<{
        user_id: string;
        role: string | null;
      }>) {
        if (r.role) roleById.set(r.user_id, r.role);
      }
    }
  }

  for (const id of ids) {
    const displayName = nameById.get(id) ?? null;
    const role = roleById.get(id) ?? null;
    // F7: when no display_name is set, show a human label ("Sales Director · a5e9")
    // instead of a raw UID prefix ("sales · a5e93040"). Keep a short id suffix so
    // two unnamed users of the same role stay distinguishable in audit trails.
    const humanRole = role
      ? role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
      : "User";
    const label = displayName ?? `${humanRole} · ${id.slice(0, 4)}`;
    out.set(id, { label, displayName, role });
  }
  return out;
}

/**
 * Convenience: resolve to a plain `Map<id, string>` of labels only.
 * Drop-in replacement for the ad-hoc "role · uuid" maps that were
 * scattered across pages.
 */
export async function resolveUserLabelStrings(
  userIds: (string | null | undefined)[]
): Promise<Map<string, string>> {
  const rich = await resolveUserLabels(userIds);
  const out = new Map<string, string>();
  for (const [id, v] of rich) out.set(id, v.label);
  return out;
}
