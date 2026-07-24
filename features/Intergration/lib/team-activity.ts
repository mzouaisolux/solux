/**
 * Integrations area D — team-activity rollup (pure aggregation).
 *
 * Turns the append-only client_interactions log into a supervision view:
 * interactions by rep × week, plus a "went quiet" list of accounts with no
 * interaction in N days. Pure (no supabase / Next), so the server action and
 * unit tests share one rule; the action resolves ids → names around it.
 *
 * Weeks are ISO-ish week buckets keyed by their Monday (UTC), so the grid is
 * deterministic regardless of the server's timezone.
 */

/** Monday (UTC) of the week containing `d`, as a YYYY-MM-DD string. */
export function weekStartUTC(d: Date): string {
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = dt.getUTCDay(); // 0=Sun … 6=Sat
  const shift = dow === 0 ? -6 : 1 - dow; // back to Monday
  dt.setUTCDate(dt.getUTCDate() + shift);
  return dt.toISOString().slice(0, 10);
}

/** The last `weeks` Monday-anchored week starts, oldest → newest. */
export function recentWeekStarts(now: Date, weeks: number): string[] {
  const base = new Date(weekStartUTC(now) + "T00:00:00.000Z");
  const out: string[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - i * 7);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export type RollupInteraction = { repId: string | null; happenedAt: string };
export type RollupClient = { id: string; lastAt: string | null };

export type RepRow = { repId: string; perWeek: number[]; total: number };
export type StaleRow = { clientId: string; lastAt: string | null; daysSince: number | null };
export type TeamActivity = {
  weeks: string[];
  reps: RepRow[];
  totalsPerWeek: number[];
  stale: StaleRow[];
};

const DAY_MS = 86_400_000;

/**
 * Build the rollup. `interactions` drives the rep × week grid (anything outside
 * the window is ignored); `clients` (each with its latest interaction, or null
 * for never) drives the stale list. Reps sort by total desc; stale sorts by
 * gap desc with never-contacted first.
 */
export function buildTeamActivity(input: {
  interactions: RollupInteraction[];
  clients: RollupClient[];
  now: Date;
  weeks?: number;
  staleDays?: number;
}): TeamActivity {
  const weeks = input.weeks ?? 4;
  const staleDays = input.staleDays ?? 14;
  const weekList = recentWeekStarts(input.now, weeks);
  const weekIndex = new Map(weekList.map((w, i) => [w, i]));

  const perRep = new Map<string, number[]>();
  for (const it of input.interactions) {
    if (!it.repId) continue;
    const t = Date.parse(it.happenedAt);
    if (!Number.isFinite(t)) continue;
    const idx = weekIndex.get(weekStartUTC(new Date(t)));
    if (idx === undefined) continue; // outside the window
    let arr = perRep.get(it.repId);
    if (!arr) {
      arr = new Array(weeks).fill(0);
      perRep.set(it.repId, arr);
    }
    arr[idx]++;
  }

  const reps: RepRow[] = Array.from(perRep.entries())
    .map(([repId, perWeek]) => ({ repId, perWeek, total: perWeek.reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.total - a.total || a.repId.localeCompare(b.repId));

  const totalsPerWeek = weekList.map((_, i) => reps.reduce((s, r) => s + r.perWeek[i], 0));

  const nowMs = input.now.getTime();
  const stale: StaleRow[] = input.clients
    .map((c) => {
      const t = c.lastAt ? Date.parse(c.lastAt) : NaN;
      const daysSince = Number.isFinite(t) ? Math.floor((nowMs - t) / DAY_MS) : null;
      return { clientId: c.id, lastAt: c.lastAt, daysSince };
    })
    .filter((c) => c.daysSince === null || c.daysSince >= staleDays)
    .sort((a, b) => {
      if (a.daysSince === null && b.daysSince === null) return a.clientId.localeCompare(b.clientId);
      if (a.daysSince === null) return -1; // never-contacted first
      if (b.daysSince === null) return 1;
      return b.daysSince - a.daysSince;
    });

  return { weeks: weekList, reps, totalsPerWeek, stale };
}
