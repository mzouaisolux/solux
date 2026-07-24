// Integrations area D — team-activity rollup (presentational, server-rendered).
// Interactions by rep × week + a "went quiet" list. Read-only, no client state.

import type { TeamActivityView } from "@/features/Intergration/actions/team-activity";

/** "2026-07-20" → "Jul 20". */
function weekLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function staleLabel(daysSince: number | null): string {
  if (daysSince === null) return "never";
  return `${daysSince}d`;
}

export function TeamActivityRollup({ data }: { data: TeamActivityView }) {
  const { weeks, reps, totalsPerWeek, stale, meta } = data;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Rep × week grid */}
      <section className="panel space-y-2 p-5">
        <div className="flex items-center justify-between">
          <div className="eyebrow">Interactions by rep</div>
          <span className="text-xs text-neutral-400">last {meta.weeks} weeks</span>
        </div>
        {reps.length === 0 ? (
          <div className="rounded-md border border-dashed border-neutral-200 px-4 py-6 text-center text-sm text-neutral-500">
            No logged interactions in this window.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-neutral-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                  <th className="px-3 py-2">Rep</th>
                  {weeks.map((w) => (
                    <th key={w} className="px-3 py-2 text-right font-medium">
                      {weekLabel(w)}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {reps.map((r) => (
                  <tr key={r.name} className="border-t border-neutral-100">
                    <td className="px-3 py-2 font-medium">{r.name}</td>
                    {r.perWeek.map((n, i) => (
                      <td key={i} className={`px-3 py-2 text-right ${n === 0 ? "text-neutral-300" : ""}`}>
                        {n}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right font-semibold">{r.total}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-neutral-200 bg-neutral-50 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  <td className="px-3 py-2">Team</td>
                  {totalsPerWeek.map((n, i) => (
                    <td key={i} className="px-3 py-2 text-right">
                      {n}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right">{totalsPerWeek.reduce((a, b) => a + b, 0)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {/* Went quiet */}
      <section className="panel space-y-2 p-5">
        <div className="flex items-center justify-between">
          <div className="eyebrow">Went quiet</div>
          <span className="text-xs text-neutral-400">no interaction in {meta.staleDays}+ days</span>
        </div>
        {stale.length === 0 ? (
          <div className="rounded-md border border-dashed border-neutral-200 px-4 py-6 text-center text-sm text-neutral-500">
            Every visible account has recent activity.
          </div>
        ) : (
          <ul className="divide-y divide-neutral-100 rounded-md border border-neutral-200">
            {stale.map((s) => (
              <li key={`${s.name}-${s.clientCode ?? ""}`} className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="truncate">
                  {s.name}
                  {s.clientCode ? <span className="ml-1 text-xs text-neutral-400">· {s.clientCode}</span> : null}
                </span>
                <span
                  className={`ml-3 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    s.daysSince === null ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {staleLabel(s.daysSince)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default TeamActivityRollup;
