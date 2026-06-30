// =====================================================================
// Commercial analytics — EVICTED from the dashboard (Phase 2, locked
// spec: "Le Dashboard garde ZÉRO analytics" — everything that answers
// "how are we doing?" lives here in Business).
//
// Hosts what used to be dashboard + morning analytics blocks:
//   • MTD KPIs (sent / conversion / revenue / avg deal vs last month)
//   • 12-month pipeline chart + win-rate donut
//   • Team table (who's on top, who's dragging — ex /morning)
//   • Live pipeline by geography (ex /morning)
//   • Recent critical events (audit feed, read-only)
//
// Self-contained server component: own queries, same scoping rule as
// the Business page (sales = own docs, technical roles = global).
// =====================================================================

import { Fragment } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole } from "@/lib/auth";
import { isTechnicalRole } from "@/lib/types";
import { resolveUserLabelStrings } from "@/lib/user-display";
import { geoOfCountry } from "@/lib/geo";
import PipelineChart, { type MonthBucket } from "@/components/dashboard/PipelineChart";
import WinRateDonut from "@/components/dashboard/WinRateDonut";
import { listRecentCriticalEvents, SEVERITY_PILL, eventTypeLabel } from "@/lib/events";
import { LIVE_AFFAIR_STATUSES } from "@/lib/dashboard-items";

const money = (n: number) =>
  `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

function Delta({ value, suffix = "%" }: { value: number | null; suffix?: string }) {
  if (value == null) return <span className="text-[11px] text-neutral-400">—</span>;
  const up = value >= 0;
  return (
    <span className={`text-[11px] font-semibold ${up ? "text-emerald-700" : "text-rose-700"}`}>
      {up ? "▲" : "▼"} {Math.abs(value).toFixed(value >= 100 ? 0 : 1)}
      {suffix}
    </span>
  );
}

export async function CommercialAnalytics() {
  const supabase = createClient();
  const { userId, effectiveRole } = await getEffectiveRole();
  const global = isTechnicalRole(effectiveRole) || effectiveRole === "sales_director";

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
  const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

  let docsQuery = supabase
    .from("documents")
    .select("id, total_price, status, currency, date, created_by, archived_at")
    // Commercial analytics count QUOTATIONS only (the deals). Proformas are
    // production commands, not pipeline/won deals — excluding them keeps the
    // win-rate (won / total) and revenue exact.
    .eq("type", "quotation")
    .order("date", { ascending: false });
  if (!global) docsQuery = docsQuery.eq("created_by", userId ?? "");

  const [docsRes, eventsRes, actionsRes, affairsRes, teamsRes] = await Promise.all([
    docsQuery,
    listRecentCriticalEvents({ daysBack: 14, limit: 10 }).catch(() => []),
    supabase
      .from("planned_actions")
      .select("id, affair_id, due_date, affairs:affair_id(id, owner_id, created_by, archived_at)")
      .is("done_at", null),
    supabase
      .from("affairs")
      .select("id, name, status, owner_id, created_by, archived_at, clients:client_id(country)")
      .in("status", LIVE_AFFAIR_STATUSES as unknown as string[])
      .is("archived_at", null),
    supabase
      .from("team_members")
      .select("team_id")
      .eq("user_id", userId ?? "")
      .eq("member_role", "manager"),
  ]);

  const liveDocs = ((docsRes.data ?? []) as any[]).filter((d) => !d.archived_at);
  const docs = liveDocs.filter((d) => new Date(d.date) >= twelveMonthsAgo);

  // ---- monthly buckets + MTD KPIs (ex-dashboard Business slot) ----
  type Bucket = { count: number; won: number; revenue: number };
  const byMonth = new Map<string, Bucket>();
  for (const d of docs) {
    const date = new Date(d.date);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const b = byMonth.get(key) ?? { count: 0, won: 0, revenue: 0 };
    b.count++;
    if (d.status === "won") {
      b.won++;
      b.revenue += Number(d.total_price || 0);
    }
    byMonth.set(key, b);
  }
  const monthlyData: MonthBucket[] = [];
  for (let i = 11; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const b = byMonth.get(key) ?? { count: 0, won: 0, revenue: 0 };
    monthlyData.push({
      label: date.toLocaleDateString("en", { month: "short" }),
      key,
      total: b.count,
      won: b.won,
    });
  }

  const mtdDocs = docs.filter((d) => new Date(d.date) >= monthStart);
  const lastMonthDocs = docs.filter((d) => {
    const dt = new Date(d.date);
    return dt >= lastMonthStart && dt <= lastMonthEnd;
  });
  const mtdSent = mtdDocs.length;
  const lastSent = lastMonthDocs.length;
  const sentChange = lastSent > 0 ? ((mtdSent - lastSent) / lastSent) * 100 : null;
  const mtdWon = mtdDocs.filter((d) => d.status === "won").length;
  const mtdConv = mtdSent > 0 ? (mtdWon / mtdSent) * 100 : 0;
  const lastConv =
    lastSent > 0
      ? (lastMonthDocs.filter((d) => d.status === "won").length / lastSent) * 100
      : 0;
  const convChange = lastSent > 0 ? mtdConv - lastConv : null;
  const mtdRevenue = mtdDocs
    .filter((d) => d.status === "won")
    .reduce((s, d) => s + Number(d.total_price || 0), 0);
  const lastRevenue = lastMonthDocs
    .filter((d) => d.status === "won")
    .reduce((s, d) => s + Number(d.total_price || 0), 0);
  const revenueChange = lastRevenue > 0 ? ((mtdRevenue - lastRevenue) / lastRevenue) * 100 : null;
  const mtdAvgDeal = mtdWon > 0 ? mtdRevenue / mtdWon : 0;

  const total12 = docs.length;
  const won12 = docs.filter((d) => d.status === "won").length;
  const winRate12 = total12 > 0 ? (won12 / total12) * 100 : 0;

  // ---- team table (ex /morning, manager scope) ----
  const actions = ((actionsRes.data ?? []) as any[]).filter(
    (a) => a.affairs && !a.affairs.archived_at
  );
  const affairs = (affairsRes.data ?? []) as any[];
  const ownerOf = (x: any): string | null => x?.owner_id ?? x?.created_by ?? null;
  const today = new Date().toISOString().slice(0, 10);
  const openByAffair = new Set(actions.map((a) => a.affair_id));

  const teamIds = ((teamsRes.data ?? []) as any[]).map((t) => t.team_id);
  let teamUserIds: string[] = [];
  if (teamIds.length) {
    const { data } = await supabase
      .from("team_members")
      .select("user_id")
      .in("team_id", teamIds);
    teamUserIds = [...new Set(((data ?? []) as any[]).map((r) => r.user_id as string))];
  }
  let repIds = teamUserIds.filter((id) => id && id !== userId);
  if (!repIds.length && global) {
    const owners = new Set<string>();
    for (const a of actions) {
      const o = ownerOf(a.affairs);
      if (o) owners.add(o);
    }
    for (const a of affairs) {
      const o = ownerOf(a);
      if (o) owners.add(o);
    }
    owners.delete(userId ?? "");
    repIds = [...owners];
  }
  const labels = repIds.length ? await resolveUserLabelStrings(repIds) : new Map<string, string>();
  const teamRows = repIds
    .map((id) => {
      const repActions = actions.filter((a) => ownerOf(a.affairs) === id);
      const repAffairs = affairs.filter((a) => ownerOf(a) === id);
      return {
        id,
        name: labels.get(id) ?? `user·${id.slice(0, 6)}`,
        deals: repAffairs.length,
        open: repActions.length,
        overdue: repActions.filter((a) => a.due_date < today).length,
        sleeping: repAffairs.filter((a) => !openByAffair.has(a.id)).length,
      };
    })
    .sort((a, b) => b.overdue - a.overdue || b.sleeping - a.sleeping || b.deals - a.deals);

  // ---- live pipeline by geography (ex /morning) ----
  const liveIds = affairs.map((a) => a.id);
  const valueByAffair = new Map<string, number>();
  if (liveIds.length) {
    const { data: affairDocs } = await supabase
      .from("documents")
      .select("id, affair_id, total_price, version, root_document_id, status, archived_at")
      .in("affair_id", liveIds);
    const byFamily = new Map<string, any>();
    for (const d of (affairDocs ?? []) as any[]) {
      if (d.archived_at || d.status === "cancelled") continue;
      const root = d.root_document_id ?? d.id;
      const cur = byFamily.get(root);
      if (!cur || (d.version ?? 1) >= (cur.version ?? 1)) byFamily.set(root, d);
    }
    for (const d of byFamily.values()) {
      if (!d.affair_id) continue;
      valueByAffair.set(
        d.affair_id,
        (valueByAffair.get(d.affair_id) ?? 0) + Number(d.total_price || 0)
      );
    }
  }
  type GeoBucket = { count: number; value: number; regions: Map<string, { count: number; value: number }> };
  const byContinent = new Map<string, GeoBucket>();
  for (const a of affairs) {
    const geo = geoOfCountry(a.clients?.country);
    const cont = geo?.continent ?? "Other";
    const region = geo?.region ?? (a.clients?.country ? String(a.clients.country) : "No country");
    const bucket = byContinent.get(cont) ?? { count: 0, value: 0, regions: new Map() };
    const v = valueByAffair.get(a.id) ?? 0;
    bucket.count += 1;
    bucket.value += v;
    const r = bucket.regions.get(region) ?? { count: 0, value: 0 };
    r.count += 1;
    r.value += v;
    bucket.regions.set(region, r);
    byContinent.set(cont, bucket);
  }
  const geoRows = [...byContinent.entries()].sort((a, b) => b[1].value - a[1].value);

  const recentEvents = (eventsRes ?? []) as any[];

  return (
    <div className="space-y-6">
      {/* MTD KPIs */}
      <section className="panel p-5">
        <div className="eyebrow">Commercial — month to date</div>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-neutral-400">Quotes sent</div>
            <div className="text-2xl font-bold text-neutral-900">{mtdSent}</div>
            <Delta value={sentChange} />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-neutral-400">Conversion</div>
            <div className="text-2xl font-bold text-neutral-900">{mtdConv.toFixed(0)}%</div>
            <Delta value={convChange} suffix=" pt" />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-neutral-400">Won revenue</div>
            <div className="text-2xl font-bold text-neutral-900">{money(mtdRevenue)}</div>
            <Delta value={revenueChange} />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-neutral-400">Avg deal</div>
            <div className="text-2xl font-bold text-neutral-900">{money(mtdAvgDeal)}</div>
          </div>
        </div>
      </section>

      {/* 12-month pipeline + win rate */}
      <div className="grid gap-6 lg:grid-cols-3">
        <section className="panel p-5 lg:col-span-2">
          <div className="eyebrow">Pipeline — last 12 months</div>
          <PipelineChart data={monthlyData} />
        </section>
        <section className="panel p-5">
          <div className="eyebrow">Win rate — 12 months</div>
          <WinRateDonut percentage={winRate12} />
          <p className="mt-2 text-[12px] text-neutral-500">
            {won12} won of {total12} quotes issued.
          </p>
        </section>
      </div>

      {/* team — ex /morning manager view */}
      {teamRows.length > 0 && (
        <section className="panel p-5 space-y-2">
          <div className="eyebrow">Team — who&apos;s on top, who&apos;s dragging</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-neutral-400">
                <th className="py-1.5 font-semibold">Salesperson</th>
                <th className="py-1.5 font-semibold">Live deals</th>
                <th className="py-1.5 font-semibold">Open actions</th>
                <th className="py-1.5 font-semibold">Overdue</th>
                <th className="py-1.5 font-semibold">Sleeping deals</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {teamRows.map((r) => (
                <tr key={r.id}>
                  <td className="py-1.5 font-medium text-neutral-900">{r.name}</td>
                  <td className="py-1.5 text-neutral-600">{r.deals}</td>
                  <td className="py-1.5 text-neutral-600">{r.open}</td>
                  <td className={`py-1.5 font-semibold ${r.overdue ? "text-rose-700" : "text-neutral-400"}`}>
                    {r.overdue}
                  </td>
                  <td className={`py-1.5 font-semibold ${r.sleeping ? "text-rose-700" : "text-neutral-400"}`}>
                    {r.sleeping}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* geography — ex /morning */}
      {geoRows.length > 0 && (
        <section className="panel p-5 space-y-2">
          <div className="eyebrow">Live pipeline by geography</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-neutral-400">
                <th className="py-1.5 font-semibold">Continent / region</th>
                <th className="py-1.5 font-semibold">Deals</th>
                <th className="py-1.5 text-right font-semibold">Pipeline</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {geoRows.map(([cont, b]) => (
                <Fragment key={cont}>
                  <tr className="bg-neutral-50/60">
                    <td className="py-1.5 font-semibold text-neutral-900">{cont}</td>
                    <td className="py-1.5 font-semibold text-neutral-900">{b.count}</td>
                    <td className="py-1.5 text-right font-semibold text-neutral-900">{money(b.value)}</td>
                  </tr>
                  {[...b.regions.entries()]
                    .sort((x, y) => y[1].value - x[1].value)
                    .map(([region, r]) => (
                      <tr key={`${cont}:${region}`}>
                        <td className="py-1 pl-4 text-neutral-600">{region}</td>
                        <td className="py-1 text-neutral-600">{r.count}</td>
                        <td className="py-1 text-right text-neutral-600">{money(r.value)}</td>
                      </tr>
                    ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* recent critical events — read-only audit feed */}
      {recentEvents.length > 0 && (
        <section className="panel p-5 space-y-2">
          <div className="eyebrow">Recent critical events — 14 days</div>
          <ul className="divide-y divide-neutral-100">
            {recentEvents.map((e: any) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 py-1.5 text-[13px]">
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${SEVERITY_PILL[e.severity as keyof typeof SEVERITY_PILL] ?? "bg-neutral-100 text-neutral-600"}`}>
                  {e.severity}
                </span>
                <span className="font-medium text-neutral-900">{eventTypeLabel(e.event_type)}</span>
                {e.message && <span className="text-neutral-500">· {e.message}</span>}
                <span className="ml-auto text-neutral-400">{String(e.created_at).slice(0, 10)}</span>
              </li>
            ))}
          </ul>
          <p className="text-[12px] text-neutral-400">
            Full operational log on <Link href="/operations" className="underline decoration-dotted">Operations</Link>.
          </p>
        </section>
      )}
    </div>
  );
}
