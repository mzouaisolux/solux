// =====================================================================
// SALES ANALYTICS — /sales/analytics (§6 dashboards).
//
// KPI revenue & saler figures come from monthly_sales_history (the frozen §3
// truth). Client / country / seasonality / cash breakdowns come from the
// sales_orders ledger (a NULL sales_amount is excluded, never counted as 0).
// Money is bucketed per currency; we never sum across currencies. Filterable by
// year. Read-only — no logic/calculation/schema change.
// =====================================================================
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { canAccessOrAdmin } from "@/lib/permissions";
import AccessDenied from "@/components/AccessDenied";
import { revenueByYearFromMonthly, indexMonthlyBySalerYear, financialTotalsByCurrency, type MonthlyLike, type OrderLike } from "@/lib/sales/kpi";

export const dynamic = "force-dynamic";

const MONTHS = ["", "Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];
const fmt = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 0 });

export default async function SalesAnalyticsPage({ searchParams }: { searchParams?: { year?: string } }) {
  const canSee = await canAccessOrAdmin(["sales_analytics.view"], { finance: true });
  if (!canSee) return <AccessDenied capability="sales_analytics.view" />;

  const supabase = createClient();
  const { data: monthlyData } = await supabase.from("monthly_sales_history").select("year, month, sales, saler:saler_id(name)");
  const monthly: MonthlyLike[] = (monthlyData ?? []).map((r: any) => ({ year: Number(r.year), month: Number(r.month), saler: r.saler?.name ?? "—", sales: Number(r.sales) || 0 }));

  // Fetch ALL orders for aggregation. PostgREST caps a single request at ~1000
  // rows regardless of .limit(), so paginate with .range() until exhausted
  // (else top-clients / country / cash totals silently undercount — the known
  // row-cap trap). ~1314 rows today → 2 pages.
  const ORD_COLS = "id, year, country, sales_amount, received_amount, pi_amount, balance, currency, client:sales_client_id(code, name)";
  const allOrders: any[] = [];
  for (let from = 0; from < 100000; from += 1000) {
    const { data, error } = await supabase.from("sales_orders").select(ORD_COLS).order("id").range(from, from + 999);
    if (error || !data || data.length === 0) break;
    allOrders.push(...data);
    if (data.length < 1000) break;
  }

  const revByYear = revenueByYearFromMonthly(monthly);
  const years = [...revByYear.keys()].sort((a, b) => a - b);
  const activeYear = searchParams?.year && /^\d{4}$/.test(searchParams.year) ? Number(searchParams.year) : null;

  // Orders scoped to the filter (year or all).
  const orders = activeYear == null ? allOrders : allOrders.filter((o) => Number(o.year) === activeYear);

  // Top clients + by country (from the ledger).
  const clientAgg = new Map<string, { name: string; code: string; orders: number; total: number }>();
  const countryAgg = new Map<string, { orders: number; total: number }>();
  let ordersWithAmount = 0, salesSum = 0;
  for (const o of orders) {
    const amt = o.sales_amount == null ? null : Number(o.sales_amount) || 0;
    const cKey = o.client?.code ?? "—";
    const c = clientAgg.get(cKey) ?? { name: o.client?.name ?? "(inconnu)", code: cKey, orders: 0, total: 0 };
    c.orders += 1; if (amt != null) c.total += amt; clientAgg.set(cKey, c);
    const ct = (o.country ?? "—").trim() || "—";
    const cc = countryAgg.get(ct) ?? { orders: 0, total: 0 };
    cc.orders += 1; if (amt != null) cc.total += amt; countryAgg.set(ct, cc);
    if (amt != null) { ordersWithAmount += 1; salesSum += amt; }
  }
  const topClients = [...clientAgg.values()].sort((a, b) => b.total - a.total).slice(0, 15);
  const byCountry = [...countryAgg.values()].map((v, i) => ({ country: [...countryAgg.keys()][i], ...v })).sort((a, b) => b.total - a.total).slice(0, 15);

  // Financials per currency (encaissé / facturé / solde).
  const fin = financialTotalsByCurrency(orders as OrderLike[]);
  const finList = [...fin.values()].sort((a, b) => b.salesAmount - a.salesAmount);
  const primary = finList[0];

  // Seasonality — monthly CA (the §3 truth), for the selected year or summed across all.
  const byMonth = new Array(13).fill(0);
  for (const m of monthly) {
    if (m.month < 1 || m.month > 12) continue;
    if (activeYear != null && m.year !== activeYear) continue;
    byMonth[m.month] += m.sales;
  }
  const maxMonth = Math.max(1, ...byMonth.slice(1));

  const periodCA = activeYear != null ? (revByYear.get(activeYear) ?? 0) : years.reduce((s, y) => s + (revByYear.get(y) ?? 0), 0);
  const salerIdx = indexMonthlyBySalerYear(monthly);
  const salerNames = [...new Set(monthly.map((m) => m.saler))].filter((n) => n && n !== "—");
  const salerTotals = salerNames.map((name) => ({ name, total: years.reduce((s, y) => s + (salerIdx.get(`${name}|${y}`) ?? 0), 0) })).sort((a, b) => b.total - a.total);

  const yearHref = (y: number | null) => `/sales/analytics${y ? `?year=${y}` : ""}`;
  const chip = (active: boolean) => `rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 transition-colors ${active ? "bg-neutral-900 text-white ring-neutral-900" : "bg-white text-neutral-600 ring-neutral-200 hover:bg-neutral-50"}`;
  const card = "rounded-xl border border-neutral-200 bg-white px-4 py-3";
  const box = "overflow-hidden rounded-xl border border-neutral-200 bg-white";
  const th = "border-b border-neutral-100 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-400";

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="eyebrow">Ventes &amp; Analytics · tableaux de bord</div>
          <h1 className="doc-title">Analyses détaillées</h1>
          <p className="mt-1 max-w-2xl text-sm text-neutral-500">Top clients, pays, saisonnalité, encaissé vs facturé. CA &amp; vendeurs depuis l&apos;historique figé ; clients &amp; pays depuis le journal des commandes.</p>
        </div>
        <Link href="/sales" className="mt-1 shrink-0 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-neutral-700 hover:bg-neutral-50">← Registre</Link>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wider text-neutral-400">Période :</span>
        <Link href={yearHref(null)} className={chip(activeYear == null)}>Toutes</Link>
        {years.map((y) => (<Link key={y} href={yearHref(y)} className={chip(activeYear === y)}>{y}</Link>))}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <div className={card}><div className="text-lg font-bold tabular-nums text-neutral-900">{fmt(periodCA)}</div><div className="text-[10px] uppercase tracking-wider text-neutral-400">CA {activeYear ?? "cumulé"} (USD)</div></div>
        <div className={card}><div className="text-lg font-bold tabular-nums text-neutral-900">{fmt(orders.length)}</div><div className="text-[10px] uppercase tracking-wider text-neutral-400">Commandes</div></div>
        <div className={card}><div className="text-lg font-bold tabular-nums text-neutral-900">{fmt(ordersWithAmount ? salesSum / ordersWithAmount : 0)}</div><div className="text-[10px] uppercase tracking-wider text-neutral-400">Panier moyen</div></div>
        <div className={card}><div className="text-lg font-bold tabular-nums text-neutral-900">{fmt(primary?.received ?? 0)}</div><div className="text-[10px] uppercase tracking-wider text-neutral-400">Encaissé{primary ? ` (${primary.currency})` : ""}</div></div>
        <div className={card}><div className="text-lg font-bold tabular-nums text-neutral-900">{fmt(primary?.salesAmount ?? 0)}</div><div className="text-[10px] uppercase tracking-wider text-neutral-400">Facturé (ventes)</div></div>
        <div className={card}><div className="text-lg font-bold tabular-nums text-neutral-900">{fmt(primary?.balance ?? 0)}</div><div className="text-[10px] uppercase tracking-wider text-neutral-400">Solde restant</div></div>
      </div>
      {finList.length > 1 && <p className="text-[11px] text-amber-700">Plusieurs devises présentes ({finList.map((f) => f.currency).join(", ")}) — les totaux ci-dessus concernent {primary.currency} ; jamais de somme entre devises.</p>}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Top clients */}
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-neutral-800">Top clients {activeYear ? `· ${activeYear}` : ""}</h2>
          <div className={box}>
            <table className="w-full text-sm">
              <thead><tr className="text-left"><th className={th}>Client</th><th className={`${th} text-right`}>Commandes</th><th className={`${th} text-right`}>CA (USD)</th></tr></thead>
              <tbody className="divide-y divide-neutral-100">
                {topClients.map((c) => (
                  <tr key={c.code} className="hover:bg-neutral-50/60">
                    <td className="px-3 py-2 font-medium text-neutral-900">{c.name} <span className="text-[11px] text-neutral-400">{c.code}</span></td>
                    <td className="px-3 py-2 text-right tabular-nums text-neutral-600">{fmt(c.orders)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-neutral-900">{fmt(c.total)}</td>
                  </tr>
                ))}
                {topClients.length === 0 && <tr><td colSpan={3} className="px-3 py-6 text-center text-[12px] text-neutral-400">Aucune donnée.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        {/* By country */}
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-neutral-800">CA par pays {activeYear ? `· ${activeYear}` : ""}</h2>
          <div className={box}>
            <table className="w-full text-sm">
              <thead><tr className="text-left"><th className={th}>Pays</th><th className={`${th} text-right`}>Commandes</th><th className={`${th} text-right`}>CA (USD)</th></tr></thead>
              <tbody className="divide-y divide-neutral-100">
                {byCountry.map((c) => (
                  <tr key={c.country} className="hover:bg-neutral-50/60">
                    <td className="px-3 py-2 font-medium text-neutral-900">{c.country}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-neutral-600">{fmt(c.orders)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-neutral-900">{fmt(c.total)}</td>
                  </tr>
                ))}
                {byCountry.length === 0 && <tr><td colSpan={3} className="px-3 py-6 text-center text-[12px] text-neutral-400">Aucune donnée.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Seasonality */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-neutral-800">Saisonnalité · CA par mois {activeYear ? `· ${activeYear}` : "· toutes années"}</h2>
        <div className={`${box} p-4`}>
          <div className="space-y-1.5">
            {byMonth.slice(1).map((v, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-8 text-[11px] font-medium text-neutral-500">{MONTHS[i + 1]}</div>
                <div className="h-4 flex-1 overflow-hidden rounded bg-neutral-100">
                  <div className="h-full rounded bg-neutral-800" style={{ width: `${(v / maxMonth) * 100}%` }} />
                </div>
                <div className="w-24 text-right text-[12px] tabular-nums text-neutral-600">{fmt(v)}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CA par année + vendeur (contexte, historique figé) */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-neutral-800">CA par année</h2>
          <div className={box}>
            <table className="w-full text-sm">
              <thead><tr className="text-left"><th className={th}>Année</th><th className={`${th} text-right`}>CA (USD)</th><th className={`${th} text-right`}>Variation</th></tr></thead>
              <tbody className="divide-y divide-neutral-100">
                {years.map((y, i) => {
                  const ca = revByYear.get(y) ?? 0; const prev = i > 0 ? revByYear.get(years[i - 1]) ?? 0 : null;
                  const yoy = prev && prev > 0 ? ((ca - prev) / prev) * 100 : null;
                  return (<tr key={y} className="hover:bg-neutral-50/60"><td className="px-3 py-2 font-medium text-neutral-900">{y}</td><td className="px-3 py-2 text-right tabular-nums text-neutral-700">{fmt(ca)}</td><td className="px-3 py-2 text-right tabular-nums">{yoy == null ? <span className="text-neutral-300">—</span> : <span className={yoy >= 0 ? "text-emerald-600" : "text-rose-600"}>{yoy >= 0 ? "+" : ""}{yoy.toFixed(1)}%</span>}</td></tr>);
                })}
              </tbody>
            </table>
          </div>
        </section>
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-neutral-800">Total par vendeur <span className="font-normal text-neutral-400">· historique figé</span></h2>
          <div className={box}>
            <table className="w-full text-sm">
              <thead><tr className="text-left"><th className={th}>Vendeur</th><th className={`${th} text-right`}>CA total (USD)</th></tr></thead>
              <tbody className="divide-y divide-neutral-100">
                {salerTotals.map((s) => (<tr key={s.name} className="hover:bg-neutral-50/60"><td className="px-3 py-2 font-medium text-neutral-900">{s.name}</td><td className="px-3 py-2 text-right tabular-nums font-semibold text-neutral-900">{fmt(s.total)}</td></tr>))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
