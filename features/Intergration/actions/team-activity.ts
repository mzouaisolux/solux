"use server";

/**
 * Integrations area D — team-activity rollup (server action).
 *
 * Read-only supervision view over client_interactions. Verb gated by
 * `integration.view_team_interactions`; the nouns are RLS-scoped — the
 * client_interactions / clients read policies already return only what the
 * caller can see (sales_director org-wide, managers team, sales their own), so
 * the rollup naturally scopes itself with no extra recipient logic.
 *
 * Aggregation is the pure buildTeamActivity; this layer only fetches and
 * resolves ids → display names.
 */

import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/permissions";
import { resolveUserLabelStrings } from "@/lib/user-display";
import { buildTeamActivity } from "@/features/Intergration/lib/team-activity";

export type TeamActivityView = {
  weeks: string[];
  reps: { name: string; perWeek: number[]; total: number }[];
  totalsPerWeek: number[];
  stale: { name: string; clientCode: string | null; lastAt: string | null; daysSince: number | null }[];
  meta: { weeks: number; staleDays: number; generatedAt: string };
};

const WEEKS = 4;
const STALE_DAYS = 14;
// One scan of the log, newest first. Generous cap: the grid only needs the last
// few weeks, and each client's latest interaction is the first row seen for it —
// so any client active within the most recent SCAN_LIMIT touches is dated
// correctly; anything older is (correctly) surfaced as long-quiet.
const SCAN_LIMIT = 10_000;

export async function getTeamActivity(): Promise<TeamActivityView> {
  await requireCapability("integration.view_team_interactions");
  const supabase = createClient();
  const now = new Date();

  // Visible clients (RLS) → names + the full set for stale detection.
  const { data: clientRows } = await supabase.from("clients").select("id, company_name, client_code");
  const clients = (clientRows ?? []) as { id: string; company_name: string | null; client_code: string | null }[];

  // RLS-scoped scan of the log, newest first.
  const { data: rows } = await supabase
    .from("client_interactions")
    .select("client_id, created_by, happened_at")
    .order("happened_at", { ascending: false })
    .limit(SCAN_LIMIT);
  const interactions = (rows ?? []) as { client_id: string; created_by: string | null; happened_at: string }[];

  const lastByClient = new Map<string, string>();
  for (const it of interactions) {
    if (!lastByClient.has(it.client_id)) lastByClient.set(it.client_id, it.happened_at);
  }

  const rollup = buildTeamActivity({
    now,
    weeks: WEEKS,
    staleDays: STALE_DAYS,
    interactions: interactions.map((i) => ({ repId: i.created_by, happenedAt: i.happened_at })),
    clients: clients.map((c) => ({ id: c.id, lastAt: lastByClient.get(c.id) ?? null })),
  });

  const repNames = await resolveUserLabelStrings(rollup.reps.map((r) => r.repId));
  const clientById = new Map(clients.map((c) => [c.id, c]));

  return {
    weeks: rollup.weeks,
    totalsPerWeek: rollup.totalsPerWeek,
    reps: rollup.reps.map((r) => ({
      name: repNames.get(r.repId) ?? `user·${r.repId.slice(0, 6)}`,
      perWeek: r.perWeek,
      total: r.total,
    })),
    stale: rollup.stale.map((s) => {
      const c = clientById.get(s.clientId);
      return {
        name: c?.company_name || "(no name)",
        clientCode: c?.client_code ?? null,
        lastAt: s.lastAt,
        daysSince: s.daysSince,
      };
    }),
    meta: { weeks: WEEKS, staleDays: STALE_DAYS, generatedAt: now.toISOString() },
  };
}
