// =====================================================================
// SALES & ANALYTICS — /sales (module m138, standalone "online Excel").
//
// The editable register is the centerpiece: year "tabs" (like the old Excel),
// an inline-editable grid (SalesGrid) with full audit, plus headline KPIs and
// revenue/saler summaries. KPI revenue & saler figures come from
// monthly_sales_history (the frozen §3 truth), NOT a sum of order lines.
// Full dashboards (top clients, countries, seasonality) live in /sales/analytics.
// =====================================================================

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { canAccessOrAdmin } from "@/lib/permissions";
import { getCurrentUserRole } from "@/lib/auth";
import { isAdminLike } from "@/lib/types";
import AccessDenied from "@/components/AccessDenied";
import { revenueByYearFromMonthly, indexMonthlyBySalerYear, type MonthlyLike } from "@/lib/sales/kpi";
import SalesGrid from "./SalesGrid";
import type { NewOrderRow } from "./actions";

export const dynamic = "force-dynamic";

function fmt(n: number): string {
  return n.toLocaleString("fr-FR", { maximumFractionDigits: 0 });
}

export default async function SalesPage({ searchParams }: { searchParams?: { year?: string; saler?: string } }) {
  const canSee = await canAccessOrAdmin(["sales_analytics.view"], { finance: true });
  if (!canSee) return <AccessDenied capability="sales_analytics.view" />;
  const { role } = await getCurrentUserRole();
  const canDelete = isAdminLike(role);

  const supabase = createClient();
  const [ordersCountRes, clientsCountRes, salersRes, monthlyRes, mergesCountRes] = await Promise.all([
    supabase.from("sales_orders").select("*", { count: "exact", head: true }),
    supabase.from("sales_clients").select("*", { count: "exact", head: true }),
    supabase.from("salers").select("id, name, is_active").order("name"),
    supabase.from("monthly_sales_history").select("year, month, sales, saler:saler_id(name)"),
    supabase.from("sales_merge_suggestions").select("*", { count: "exact", head: true }).eq("status", "pending"),
  ]);
  const pendingMerges = mergesCountRes.count ?? 0;

  const ordersCount = ordersCountRes.count ?? 0;
  const clientsCount = clientsCountRes.count ?? 0;
  const salers = ((salersRes.data ?? []) as any[]).map((s) => ({ id: s.id as string, name: s.name as string }));

  const monthly: MonthlyLike[] = (monthlyRes.data ?? []).map((r: any) => ({ year: Number(r.year), month: Number(r.month), saler: r.saler?.name ?? "—", sales: Number(r.sales) || 0 }));
  const revByYear = revenueByYearFromMonthly(monthly);
  const years = [...revByYear.keys()].sort((a, b) => a - b);
  const caTotal = years.reduce((s, y) => s + (revByYear.get(y) ?? 0), 0);
  const salerYear = indexMonthlyBySalerYear(monthly);
  const salerNames = [...new Set(monthly.map((m) => m.saler))].filter((n) => n && n !== "—");
  const salerTotals = salerNames
    .map((name) => ({ name, total: years.reduce((s, y) => s + (salerYear.get(`${name}|${y}`) ?? 0), 0) }))
    .sort((a, b) => b.total - a.total);

  const empty = ordersCount === 0 && clientsCount === 0;

  // Register slice: one year "tab" at a time (+ optional saler filter).
  const activeYear = searchParams?.year && /^\d{4}$/.test(searchParams.year)
    ? Number(searchParams.year)
    : years.length ? years[years.length - 1] : null;
  const salerFilter = searchParams?.saler || "";

  let gridRows: NewOrderRow[] = [];
  if (activeYear != null) {
    let q = supabase
      .from("sales_orders")
      .select("id, sales_client_id, saler_id, year, month, order_date, country, pi_no, payment_terms, pi_amount, sales_amount, transportation, received_amount, bank_charge, balance, amount_status, currency, shipment_date, eta_note, pickup, client:sales_client_id(code, name), saler:saler_id(name)")
      .eq("year", activeYear)
      .order("month", { ascending: true, nullsFirst: false })
      .limit(1000);
    if (salerFilter) q = q.eq("saler_id", salerFilter);
    const { data } = await q;
    gridRows = ((data ?? []) as any[]).map((r) => ({
      ...r,
      client: r.client ? { code: r.client.code, name: r.client.name } : null,
      saler: r.saler ? { name: r.saler.name } : null,
    })) as NewOrderRow[];
  }

  const yearHref = (y: number) => `/sales?year=${y}${salerFilter ? `&saler=${salerFilter}` : ""}`;
  const salerHref = (sid: string) => `/sales?year=${activeYear ?? ""}${sid ? `&saler=${sid}` : ""}`;
  const chip = (active: boolean) =>
    `rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 transition-colors ${active ? "bg-neutral-900 text-white ring-neutral-900" : "bg-white text-neutral-600 ring-neutral-200 hover:bg-neutral-50"}`;
  const card = "rounded-xl border border-neutral-200 bg-white px-4 py-3";

  return (
    <div className="mx-auto max-w-[1920px] px-6 py-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="eyebrow">Ventes &amp; Analytics · registre autonome</div>
          <h1 className="doc-title">Ventes</h1>
          <p className="mt-1 max-w-2xl text-sm text-neutral-500">
            Le registre des ventes depuis 2019 (l&apos;« Excel en ligne ») : saisie directe, traçabilité, et
            statistiques. Les KPI de CA/vendeur proviennent de l&apos;historique figé (jamais d&apos;une somme des lignes).
          </p>
        </div>
        <div className="mt-1 flex shrink-0 items-center gap-2">
          <Link href="/sales/merges" className="relative rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-neutral-700 hover:bg-neutral-50">
            Doublons à valider
            {pendingMerges > 0 && <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{pendingMerges}</span>}
          </Link>
          <Link href="/sales/analytics" className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-neutral-700 hover:bg-neutral-50">
            Analyses détaillées →
          </Link>
        </div>
      </div>

      {empty ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 px-5 py-6">
          <div className="text-sm font-semibold text-amber-900">Aucune donnée importée pour l&apos;instant</div>
          <p className="mt-1 text-[13px] text-amber-800">Lance l&apos;import dans un Terminal : <code>npm run import:sales:rest</code>, puis recharge.</p>
        </div>
      ) : null}

      {/* ---- KPI cards ---- */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className={card}>
          <div className="text-lg font-bold tabular-nums text-neutral-900">{fmt(caTotal)} USD</div>
          <div className="text-[10px] uppercase tracking-wider text-neutral-400">CA cumulé{years.length ? ` (${years[0]}–${years[years.length - 1]})` : ""}</div>
        </div>
        <div className={card}><div className="text-lg font-bold tabular-nums text-neutral-900">{fmt(ordersCount)}</div><div className="text-[10px] uppercase tracking-wider text-neutral-400">Commandes</div></div>
        <div className={card}><div className="text-lg font-bold tabular-nums text-neutral-900">{fmt(clientsCount)}</div><div className="text-[10px] uppercase tracking-wider text-neutral-400">Clients</div></div>
        <div className={card}><div className="text-lg font-bold tabular-nums text-neutral-900">{fmt(salers.filter((s) => true).length)}</div><div className="text-[10px] uppercase tracking-wider text-neutral-400">Vendeurs</div></div>
      </div>

      {/* ---- Register (the editable grid) ---- */}
      {!empty && activeYear != null && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-sm font-semibold text-neutral-800">Registre des commandes</h2>
            <div className="flex flex-wrap items-center gap-1.5">
              {years.map((y) => (<Link key={y} href={yearHref(y)} className={chip(y === activeYear)}>{y}</Link>))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-neutral-400">Vendeur :</span>
            <Link href={salerHref("")} className={chip(!salerFilter)}>Tous</Link>
            {salers.map((s) => (<Link key={s.id} href={salerHref(s.id)} className={chip(salerFilter === s.id)}>{s.name}</Link>))}
          </div>
          <SalesGrid initialRows={gridRows} salers={salers} activeYear={activeYear} canDelete={canDelete} />
        </section>
      )}

      {/* ---- CA par année (YoY) ---- */}
      {years.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-neutral-800">Chiffre d&apos;affaires par année</h2>
          <div className="max-w-xl overflow-x-auto rounded-lg border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 text-left text-[10px] uppercase tracking-wider text-neutral-400">
                  <th className="px-3 py-2 font-semibold">Année</th>
                  <th className="px-3 py-2 font-semibold text-right">CA (USD)</th>
                  <th className="px-3 py-2 font-semibold text-right">Variation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {years.map((y, i) => {
                  const ca = revByYear.get(y) ?? 0;
                  const prev = i > 0 ? revByYear.get(years[i - 1]) ?? 0 : null;
                  const yoy = prev && prev > 0 ? ((ca - prev) / prev) * 100 : null;
                  return (
                    <tr key={y} className="hover:bg-neutral-50/60">
                      <td className="px-3 py-2 font-medium text-neutral-900">{y}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-neutral-700">{fmt(ca)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {yoy == null ? <span className="text-neutral-300">—</span> : <span className={yoy >= 0 ? "text-emerald-600" : "text-rose-600"}>{yoy >= 0 ? "+" : ""}{yoy.toFixed(1)}%</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ---- Performance par vendeur (§3 : monthly_sales_history) ---- */}
      {salerTotals.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-neutral-800">Performance par vendeur <span className="font-normal text-neutral-400">· historique figé</span></h2>
          <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 text-left text-[10px] uppercase tracking-wider text-neutral-400">
                  <th className="px-3 py-2 font-semibold">Vendeur</th>
                  {years.map((y) => (<th key={y} className="px-3 py-2 font-semibold text-right">{y}</th>))}
                  <th className="px-3 py-2 font-semibold text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {salerTotals.map((s) => (
                  <tr key={s.name} className="hover:bg-neutral-50/60">
                    <td className="px-3 py-2 font-medium text-neutral-900">{s.name}</td>
                    {years.map((y) => { const v = salerYear.get(`${s.name}|${y}`); return (<td key={y} className="px-3 py-2 text-right tabular-nums text-neutral-600">{v ? fmt(v) : <span className="text-neutral-300">—</span>}</td>); })}
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-neutral-900">{fmt(s.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
