"use client";

// =====================================================================
// SALES INTELLIGENCE — interactive workspace. All aggregation runs CLIENT-SIDE
// from the raw register, so changing any global filter recomputes every tab
// instantly. Structure unchanged (Overview / Clients 360 / Pays / Commerciaux /
// Tendances / Insights) — every element is now a drill-down entry point.
// =====================================================================

import { useMemo, useState } from "react";
import { Bars, GroupedBars, Lines, Spark, C, fmtShort } from "./charts";
import { askAssistant, clientNarrative, generateNarrative } from "./insights-action";
import {
  filterOrders, buildClientProfiles, clientLists, buildCountryStats, buildSalerStats, buildInsights,
  type IntelOrder, type Filters, type ClientProfile, type CountryStat, type SalerStat,
} from "@/lib/sales/intelligence";
import { ytdSum, latestMonth, salesByYearPeriod, cumulativeByMonth, growthPct } from "@/lib/sales/periods";
import { baseForecast, arAging, retentionCohorts, growthDecomposition, clientSignals, clientSignal, collectionRisk, parseTerms, type ClientSignal } from "@/lib/sales/decision";

const MONTHS = ["", "Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];
const fmt = (n: number) => Math.round(n).toLocaleString("fr-FR");
const g100 = (cur: number, prev: number) => growthPct(cur, prev);

export type WorkspaceData = {
  rawOrders: IntelOrder[]; years: number[]; countries: string[]; salers: string[];
  clientsIndex: { code: string; name: string }[]; paymentTerms: string[]; currencies: string[]; maxDate: string;
};
type Cohort = "all" | "new" | "recurring" | "growing" | "declining" | "dormant";

// ── client-side aggregate helpers ────────────────────────────────────────────
function computeKpi(scoped: IntelOrder[], refYear: number) {
  const ytdM = latestMonth(scoped, refYear) || 12;
  const curYTD = ytdSum(scoped, refYear, ytdM), prevYTD = ytdSum(scoped, refYear - 1, ytdM), prevFull = ytdSum(scoped, refYear - 1, 12);
  const projection = ytdM > 0 ? (curYTD / ytdM) * 12 : 0;
  const ofRef = scoped.filter((o) => o.year === refYear);
  const firstYear = new Map<string, number>();
  for (const o of scoped) { if (o.year == null) continue; const y = firstYear.get(o.clientCode); if (y == null || o.year < y) firstYear.set(o.clientCode, o.year); }
  const active = new Set(ofRef.map((o) => o.clientCode));
  let newClients = 0, retClients = 0, newCA = 0, retCA = 0, refCA = 0, refWA = 0, nullCur = 0, received = 0;
  for (const o of ofRef) { if (o.sales_amount != null) { refCA += o.sales_amount; refWA++; } else nullCur++; received += o.received ?? 0; }
  for (const c of active) (firstYear.get(c) === refYear ? newClients++ : retClients++);
  for (const o of ofRef) if (o.sales_amount != null) (firstYear.get(o.clientCode) === refYear ? (newCA += o.sales_amount) : (retCA += o.sales_amount));
  return { curYTD, prevYTD, prevFull, projection, nCmd: ofRef.length, activeClients: active.size, avgBasket: refWA ? refCA / refWA : 0, nullCur, newClients, retClients, newCA, retCA, totalAllTime: scoped.reduce((s, o) => s + (o.sales_amount ?? 0), 0), received, ytdM, ytdLabel: MONTHS[ytdM] };
}
function computeSeries(scoped: IntelOrder[], refYear: number, years: number[]) {
  const yAgg = new Map<number, { ca: number; orders: number; wa: number }>();
  const firstYear = new Map<string, number>();
  for (const o of scoped) { if (o.year == null) continue; const a = yAgg.get(o.year) ?? { ca: 0, orders: 0, wa: 0 }; a.orders++; if (o.sales_amount != null) { a.ca += o.sales_amount; a.wa++; } yAgg.set(o.year, a); const y = firstYear.get(o.clientCode); if (y == null || o.year < y) firstYear.set(o.clientCode, o.year); }
  const ytdM = latestMonth(scoped, refYear) || 12;
  const qByYP = salesByYearPeriod(scoped, "quarter");
  const cCur = cumulativeByMonth(scoped, refYear), cPrev = cumulativeByMonth(scoped, refYear - 1);
  return {
    caByYear: years.map((y) => ({ year: y, ca: yAgg.get(y)?.ca ?? 0 })),
    ordersByYear: years.map((y) => ({ year: y, orders: yAgg.get(y)?.orders ?? 0 })),
    basketByYear: years.map((y) => ({ year: y, v: (yAgg.get(y)?.wa ?? 0) ? yAgg.get(y)!.ca / yAgg.get(y)!.wa : 0 })),
    newRetByYear: years.map((Y) => { const act = new Set(scoped.filter((o) => o.year === Y).map((o) => o.clientCode)); let n = 0, r = 0; for (const c of act) (firstYear.get(c) === Y ? n++ : r++); return { year: Y, nouveau: n, recurrent: r }; }),
    monthLabels: MONTHS.slice(1),
    monthCur: Array.from({ length: 12 }, (_, i) => cCur[i + 1] - cCur[i]), monthPrev: Array.from({ length: 12 }, (_, i) => cPrev[i + 1] - cPrev[i]),
    cumCur: Array.from({ length: 12 }, (_, i) => (i + 1 <= ytdM ? cCur[i + 1] : null)), cumPrev: Array.from({ length: 12 }, (_, i) => cPrev[i + 1]),
    quarterCur: [1, 2, 3, 4].map((p) => qByYP.get(refYear)?.get(p) ?? 0), quarterPrev: [1, 2, 3, 4].map((p) => qByYP.get(refYear - 1)?.get(p) ?? 0),
  };
}

// ── small UI atoms ───────────────────────────────────────────────────────────
const card = "rounded-xl border border-neutral-200 bg-white";
function Delta({ cur, prev, className = "" }: { cur: number; prev: number; className?: string }) {
  const gg = g100(cur, prev);
  if (gg == null) return <span className={`${className} ${cur > 0 ? "text-emerald-600" : "text-neutral-300"}`}>{cur > 0 ? "nouv." : "—"}</span>;
  return <span className={`${className} ${gg >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{gg >= 0 ? "+" : ""}{gg.toFixed(1)}%</span>;
}
const TREND: Record<string, { c: string; l: string }> = { croissance: { c: "bg-emerald-50 text-emerald-700 ring-emerald-200", l: "Croissance" }, baisse: { c: "bg-rose-50 text-rose-700 ring-rose-200", l: "En baisse" }, stable: { c: "bg-neutral-100 text-neutral-600 ring-neutral-200", l: "Stable" }, nouveau: { c: "bg-blue-50 text-blue-700 ring-blue-200", l: "Nouveau" }, dormant: { c: "bg-amber-50 text-amber-700 ring-amber-200", l: "Dormant" } };
const TrendBadge = ({ t }: { t: string }) => <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${TREND[t]?.c ?? TREND.stable.c}`}>{TREND[t]?.l ?? t}</span>;
const CHURN: Record<string, { c: string; l: string }> = { ok: { c: "text-emerald-600", l: "OK" }, watch: { c: "text-amber-600", l: "À surveiller" }, risk: { c: "text-rose-600", l: "Risque" }, lost: { c: "text-rose-700", l: "Quasi perdu" } };
function Kpi({ v, l, delta, accent, onClick }: { v: string; l: string; delta?: React.ReactNode; accent?: string; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick} className={`${card} px-4 py-3 text-left ${accent ?? ""} ${onClick ? "transition-shadow hover:shadow-sm" : "cursor-default"}`}>
      <div className="text-lg font-bold tabular-nums text-neutral-900">{v} {delta && <span className="text-[12px] font-semibold">{delta}</span>}</div>
      <div className="text-[10px] uppercase tracking-wider text-neutral-400">{l}</div>
    </button>
  );
}

const TABS = [["pilotage", "Pilotage"], ["overview", "Overview"], ["clients", "Clients 360"], ["pays", "Pays"], ["commerciaux", "Commerciaux"], ["tendances", "Tendances"], ["insights", "Insights IA"]] as const;
type Tab = (typeof TABS)[number][0];

export default function AnalyticsShell({ data }: { data: WorkspaceData }) {
  const [tab, setTab] = useState<Tab>("pilotage");
  const [filters, setFilters] = useState<Filters>({});
  const [refYear, setRefYear] = useState<number>(data.years[data.years.length - 1] ?? 2026);
  const [cohort, setCohort] = useState<Cohort>("all");
  const [dormancyMonths, setDormancy] = useState(12);
  const [advanced, setAdvanced] = useState(false);

  const patch = (p: Partial<Filters>) => setFilters((f) => ({ ...f, ...p }));
  const prevYear = refYear - 1;

  const base = useMemo(() => filterOrders(data.rawOrders, filters), [data.rawOrders, filters]);
  const profilesAll = useMemo(() => buildClientProfiles(base, refYear, { dormancyMonths, referenceDate: data.maxDate }), [base, refYear, dormancyMonths, data.maxDate]);
  const cohortSet = useMemo(() => {
    if (cohort === "all") return null;
    const s = new Set<string>();
    for (const p of profilesAll) {
      if (cohort === "new" && p.trend === "nouveau") s.add(p.code);
      else if (cohort === "recurring" && p.firstYear < refYear) s.add(p.code);
      else if (cohort === "growing" && p.trend === "croissance") s.add(p.code);
      else if (cohort === "declining" && p.trend === "baisse") s.add(p.code);
      else if (cohort === "dormant" && p.trend === "dormant") s.add(p.code);
    }
    return s;
  }, [profilesAll, cohort, refYear]);
  const scoped = useMemo(() => (cohortSet ? base.filter((o) => cohortSet.has(o.clientCode)) : base), [base, cohortSet]);
  const profiles = useMemo(() => (cohortSet ? profilesAll.filter((p) => cohortSet.has(p.code)) : profilesAll), [profilesAll, cohortSet]);

  const lists = useMemo(() => clientLists(profiles), [profiles]);
  const countries = useMemo(() => buildCountryStats(scoped, refYear), [scoped, refYear]);
  const salers = useMemo(() => buildSalerStats(scoped, refYear), [scoped, refYear]);
  const kpi = useMemo(() => computeKpi(scoped, refYear), [scoped, refYear]);
  const series = useMemo(() => computeSeries(scoped, refYear, data.years), [scoped, refYear, data.years]);
  const topByCur = useMemo(() => profiles.reduce<ClientProfile | null>((m, p) => (p.curCA > (m?.curCA ?? -1) ? p : m), null), [profiles]);
  const insights = useMemo(() => buildInsights({ refYear, prevYear, curYTD: kpi.curYTD, prevYTD: kpi.prevYTD, projection: kpi.projection, prevFull: kpi.prevFull, nullCount: kpi.nullCur, profiles, countries, topClientShareOfYear: kpi.curYTD > 0 && topByCur ? topByCur.curCA / kpi.curYTD : 0, topClientName: topByCur?.name ?? "—" }), [refYear, prevYear, kpi, profiles, countries, topByCur]);
  // decision engine (built only from existing register data)
  const forecast = useMemo(() => baseForecast(scoped, refYear), [scoped, refYear]);
  const aging = useMemo(() => arAging(scoped, data.maxDate), [scoped, data.maxDate]);
  const retention = useMemo(() => retentionCohorts(scoped), [scoped]);
  const decomp = useMemo(() => growthDecomposition(scoped, refYear), [scoped, refYear]);
  const signals = useMemo(() => clientSignals(scoped, data.maxDate), [scoped, data.maxDate]);

  const nameOf = (code: string) => data.clientsIndex.find((c) => c.code === code)?.name ?? code;
  const activeChips: [string, () => void][] = [];
  if (filters.country) activeChips.push([`Pays : ${filters.country}`, () => patch({ country: null })]);
  if (filters.saler) activeChips.push([`Vendeur : ${filters.saler}`, () => patch({ saler: null })]);
  if (filters.clientCode) activeChips.push([`Client : ${nameOf(filters.clientCode)}`, () => patch({ clientCode: null })]);
  if (filters.status && filters.status !== "all") activeChips.push([`Paiement : ${filters.status}`, () => patch({ status: "all" })]);
  if (filters.amountState && filters.amountState !== "all") activeChips.push([filters.amountState === "missing" ? "Sans montant" : "Avec montant", () => patch({ amountState: "all" })]);
  if (filters.month) activeChips.push([`Mois : ${MONTHS[filters.month]}`, () => patch({ month: null })]);
  if (filters.paymentTerm) activeChips.push([`Terme : ${filters.paymentTerm}`, () => patch({ paymentTerm: null })]);
  if (filters.currency) activeChips.push([`Devise : ${filters.currency}`, () => patch({ currency: null })]);
  if (filters.minAmount != null) activeChips.push([`≥ ${fmt(filters.minAmount)}`, () => patch({ minAmount: null })]);
  if (filters.maxAmount != null) activeChips.push([`≤ ${fmt(filters.maxAmount)}`, () => patch({ maxAmount: null })]);
  if (cohort !== "all") activeChips.push([`Statut : ${cohort}`, () => setCohort("all")]);

  const sel = "rounded-md border border-neutral-200 bg-white px-2 py-1 text-[12px] text-neutral-700 outline-none focus:border-neutral-400";

  return (
    <div className="space-y-4">
      {/* ── GLOBAL FILTER BAR ── */}
      <div className={`${card} sticky top-0 z-20 space-y-2 p-3 shadow-sm`}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1"><span className="text-[10px] uppercase tracking-wider text-neutral-400">Année</span>
            {data.years.map((y) => (<button key={y} type="button" onClick={() => setRefYear(y)} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${y === refYear ? "bg-neutral-900 text-white ring-neutral-900" : "bg-white text-neutral-600 ring-neutral-200 hover:bg-neutral-50"}`}>{y}</button>))}
          </div>
          <select className={sel} value={filters.country ?? ""} onChange={(e) => patch({ country: e.target.value || null })}><option value="">Tous pays</option>{data.countries.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          <select className={sel} value={filters.saler ?? ""} onChange={(e) => patch({ saler: e.target.value || null })}><option value="">Tous vendeurs</option>{data.salers.map((s) => <option key={s} value={s}>{s}</option>)}</select>
          <select className={sel} value={filters.clientCode ?? ""} onChange={(e) => patch({ clientCode: e.target.value || null })}><option value="">Tous clients</option>{data.clientsIndex.map((c) => <option key={c.code} value={c.code}>{c.name || c.code}</option>)}</select>
          <select className={sel} value={cohort} onChange={(e) => setCohort(e.target.value as Cohort)}><option value="all">Tous statuts</option><option value="new">Nouveaux</option><option value="recurring">Récurrents</option><option value="growing">En croissance</option><option value="declining">En baisse</option><option value="dormant">Dormants</option></select>
          <select className={sel} value={filters.status ?? "all"} onChange={(e) => patch({ status: e.target.value as any })}><option value="all">Paiement : tous</option><option value="paid">Payé</option><option value="partial">Partiel</option><option value="unpaid">Impayé</option></select>
          <select className={sel} value={filters.amountState ?? "all"} onChange={(e) => patch({ amountState: e.target.value as any })}><option value="all">Montant : tous</option><option value="with">Avec montant</option><option value="missing">Sans montant</option></select>
          <select className={sel} value={dormancyMonths} onChange={(e) => setDormancy(Number(e.target.value))} title="Seuil de dormance"><option value={6}>Dormance 6 mois</option><option value={12}>Dormance 12 mois</option><option value={18}>Dormance 18 mois</option><option value={24}>Dormance 24 mois</option></select>
          <button type="button" onClick={() => setAdvanced((a) => !a)} className="rounded-md px-2 py-1 text-[12px] text-neutral-500 hover:text-neutral-800">{advanced ? "− Avancé" : "+ Avancé"}</button>
        </div>
        {advanced && (
          <div className="flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-2">
            <select className={sel} value={filters.paymentTerm ?? ""} onChange={(e) => patch({ paymentTerm: e.target.value || null })}><option value="">Tous termes</option>{data.paymentTerms.map((t) => <option key={t} value={t}>{t}</option>)}</select>
            <select className={sel} value={filters.currency ?? ""} onChange={(e) => patch({ currency: e.target.value || null })}><option value="">Toutes devises</option>{data.currencies.map((c) => <option key={c} value={c}>{c}</option>)}</select>
            <input className={`${sel} w-28`} type="number" placeholder="Montant min" value={filters.minAmount ?? ""} onChange={(e) => patch({ minAmount: e.target.value ? Number(e.target.value) : null })} />
            <input className={`${sel} w-28`} type="number" placeholder="Montant max" value={filters.maxAmount ?? ""} onChange={(e) => patch({ maxAmount: e.target.value ? Number(e.target.value) : null })} />
          </div>
        )}
        {activeChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-neutral-100 pt-2">
            {activeChips.map(([label, clear], i) => (<button key={i} type="button" onClick={clear} className="rounded-full bg-neutral-900 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-neutral-700">{label} ✕</button>))}
            <button type="button" onClick={() => { setFilters({}); setCohort("all"); }} className="text-[11px] font-semibold text-neutral-400 hover:text-neutral-700">Réinitialiser</button>
          </div>
        )}
      </div>

      {/* ── TABS ── */}
      <div className="flex flex-wrap gap-1 border-b border-neutral-200">
        {TABS.map(([id, label]) => (<button key={id} type="button" onClick={() => setTab(id)} className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold transition-colors ${tab === id ? "border-neutral-900 text-neutral-900" : "border-transparent text-neutral-400 hover:text-neutral-700"}`}>{label}</button>))}
      </div>

      {tab === "pilotage" && <Pilotage {...{ kpi, forecast, aging, retention, decomp, signals, profiles, refYear, prevYear, patch, setTab, setCohort }} />}
      {tab === "overview" && <Overview {...{ kpi, series, lists, refYear, prevYear, patch, setTab, setCohort, monthActive: filters.month ?? null }} />}
      {tab === "clients" && <Clients {...{ profiles, lists, base, refYear, dormancyMonths, maxDate: data.maxDate, clientsIndex: data.clientsIndex, filters, patch }} />}
      {tab === "pays" && <Pays {...{ countries, refYear, prevYear, filters, patch }} />}
      {tab === "commerciaux" && <Commerciaux {...{ salers, refYear, filters, patch }} />}
      {tab === "tendances" && <Tendances {...{ series, refYear, prevYear, patch }} />}
      {tab === "insights" && <Insights {...{ insights, kpi, refYear, prevYear, profiles, countries, salers, filters, cohort }} />}
    </div>
  );
}

// ── PILOTAGE (le Brief du matin) ─────────────────────────────────────────────
function Pilotage({ kpi, forecast, aging, retention, decomp, signals, profiles, refYear, prevYear, patch, setTab, setCohort }: any) {
  const topClient = profiles.reduce((m: ClientProfile | null, p: ClientProfile) => (p.curCA > (m?.curCA ?? -1) ? p : m), null);
  const topShare = kpi.curYTD > 0 && topClient ? topClient.curCA / kpi.curYTD : 0;

  // ranked alert feed
  type Alert = { sev: "danger" | "warning" | "info"; title: string; detail: string; act?: () => void; actLabel?: string; weight: number };
  const alerts: Alert[] = [];
  for (const p of profiles as ClientProfile[]) {
    const s: ClientSignal | undefined = signals.get(p.code);
    if (s && (s.churnLevel === "risk" || s.churnLevel === "lost") && p.totalCA > 0) {
      alerts.push({ sev: "danger", title: `${p.name} — ${s.churnLevel === "lost" ? "quasi perdu" : "risque de perte"}`, detail: `${s.daysSinceLast}j sans commande (cadence ~${s.expectedGap ?? "?"}j) · ${fmt(p.totalCA)} de CA en jeu.`, act: () => { patch({ clientCode: p.code }); setTab("clients"); }, actLabel: "Ouvrir la fiche", weight: s.churnProb * p.totalCA });
    }
  }
  for (const d of aging.debtors.filter((x: any) => x.oldestDays > 60).slice(0, 5)) alerts.push({ sev: "warning", title: `${d.name} — ${fmt(d.outstanding)} en attente`, detail: `Le plus ancien remonte à ${d.oldestDays}j (depuis expédition) · ${d.country}.`, act: () => { patch({ clientCode: d.code }); setTab("clients"); }, actLabel: "Voir", weight: d.outstanding });
  if (topShare >= 0.25 && topClient) alerts.push({ sev: "warning", title: `Concentration : ${topClient.name} = ${Math.round(topShare * 100)}% du CA ${refYear}`, detail: "Dépendance forte à un seul client — diversifier.", weight: topShare * 1e6 });
  if (kpi.nullCur > 0) alerts.push({ sev: "info", title: `${kpi.nullCur} commandes ${refYear} sans montant`, detail: "Le CA réel est sous-estimé tant qu'elles ne sont pas saisies.", act: () => patch({ amountState: "missing" }), actLabel: "Filtrer", weight: 1 });
  alerts.sort((a, b) => (a.sev === b.sev ? b.weight - a.weight : ({ danger: 0, warning: 1, info: 2 }[a.sev] - { danger: 0, warning: 1, info: 2 }[b.sev])));

  const SEV: Record<string, string> = { danger: "border-rose-200 bg-rose-50/50", warning: "border-amber-200 bg-amber-50/50", info: "border-neutral-200 bg-white" };
  const DOT: Record<string, string> = { danger: "bg-rose-500", warning: "bg-amber-500", info: "bg-neutral-400" };
  const maxD = Math.max(1, Math.abs(decomp.newC), Math.abs(decomp.expansion), Math.abs(decomp.contraction), Math.abs(decomp.churn));
  const DRow = ({ l, v }: { l: string; v: number }) => (<div className="flex items-center gap-2 text-[12px]"><div className="w-24 text-neutral-500">{l}</div><div className="h-3 flex-1 rounded bg-neutral-100"><div className={`h-full rounded ${v >= 0 ? "bg-emerald-500" : "bg-rose-500"}`} style={{ width: `${(Math.abs(v) / maxD) * 100}%` }} /></div><div className={`w-24 text-right tabular-nums ${v >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{v >= 0 ? "+" : ""}{fmt(v)}</div></div>);
  const fgrowth = g100(forecast.forecastFullYear, forecast.prevFull);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi v={fmt(forecast.forecastFullYear)} l={`Prévision fin ${refYear} (base installée)`} delta={<Delta cur={forecast.forecastFullYear} prev={forecast.prevFull} />} accent="ring-1 ring-neutral-900/5" />
        <Kpi v={fmt(kpi.curYTD)} l={`CA ${refYear} à date`} delta={<Delta cur={kpi.curYTD} prev={kpi.prevYTD} />} />
        <Kpi v={fmt(aging.totalOutstanding)} l="Cash à récupérer" accent={aging.totalOutstanding > 0 ? "ring-1 ring-amber-300" : ""} />
        <Kpi v={fmt(kpi.nullCur)} l="Cmd. sans montant" accent={kpi.nullCur > 0 ? "ring-1 ring-amber-300" : ""} onClick={() => patch({ amountState: "missing" })} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
        {/* alert feed */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-neutral-800">🔔 Ce qui a besoin de toi aujourd'hui</h3>
          {alerts.length === 0 ? <p className="text-[12px] text-neutral-400">Rien d'urgent sur ce périmètre. 🎉</p> : (
            <div className="space-y-2">
              {alerts.slice(0, 12).map((a, i) => (
                <div key={i} className={`flex items-start justify-between gap-3 rounded-xl border p-3 ${SEV[a.sev]}`}>
                  <div className="flex items-start gap-2"><span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[a.sev]}`} /><div><div className="text-[13px] font-semibold text-neutral-900">{a.title}</div><div className="text-[12px] text-neutral-600">{a.detail}</div></div></div>
                  {a.act && <button type="button" onClick={a.act} className="shrink-0 rounded-md border border-neutral-200 bg-white px-2 py-1 text-[11px] font-semibold text-neutral-700 hover:bg-neutral-50">{a.actLabel}</button>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* forecast + decomposition */}
        <div className="space-y-4">
          <div className={`${card} p-4`}>
            <h3 className="mb-1 text-sm font-semibold text-neutral-800">Prévision base installée · {refYear}</h3>
            <div className="text-2xl font-bold tabular-nums text-neutral-900">{fmt(forecast.forecastFullYear)} {fgrowth != null && <span className={`text-[13px] font-semibold ${fgrowth >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{fgrowth >= 0 ? "+" : ""}{fgrowth.toFixed(1)}%</span>}</div>
            <div className="text-[11px] text-neutral-400">Reste à faire d'ici fin d'année : <strong className="text-neutral-600">{fmt(forecast.remaining)}</strong> · {forecast.activeClients} clients actifs projetés. <span className="text-neutral-400">(vs {fmt(forecast.prevFull)} en {prevYear})</span></div>
            <div className="mt-2"><Bars data={[{ label: `${prevYear}`, value: forecast.prevFull }, { label: `Prév. ${refYear}`, value: forecast.forecastFullYear }, { label: "À date", value: forecast.curYTD }]} height={100} /></div>
          </div>
          <div className={`${card} p-4`}>
            <h3 className="mb-2 text-sm font-semibold text-neutral-800">D'où vient la variation {refYear} vs {prevYear}</h3>
            <div className="space-y-1.5">
              <DRow l="Nouveaux" v={decomp.newC} /><DRow l="Expansion" v={decomp.expansion} /><DRow l="Contraction" v={decomp.contraction} /><DRow l="Clients perdus" v={decomp.churn} />
            </div>
            <div className="mt-2 border-t border-neutral-100 pt-1.5 text-[12px] font-semibold text-neutral-800">Variation nette : <span className={decomp.total >= 0 ? "text-emerald-600" : "text-rose-600"}>{decomp.total >= 0 ? "+" : ""}{fmt(decomp.total)}</span></div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* aging */}
        <div className={`${card} p-4`}>
          <h3 className="mb-2 text-sm font-semibold text-neutral-800">Recouvrement · {fmt(aging.totalOutstanding)} en attente</h3>
          <Bars data={aging.buckets.map((b: any) => ({ label: b.label, value: b.amount }))} color={C.amber} height={110} />
          <ul className="mt-2 space-y-1 text-[12px]">
            {aging.debtors.slice(0, 6).map((d: any) => (<li key={d.code} className="flex items-center justify-between"><button type="button" onClick={() => { patch({ clientCode: d.code }); setTab("clients"); }} className="truncate text-neutral-700 hover:underline">{d.name} <span className="text-neutral-400">· {d.oldestDays}j</span></button><span className="font-semibold tabular-nums text-neutral-900">{fmt(d.outstanding)}</span></li>))}
          </ul>
        </div>
        {/* retention */}
        <div className={`${card} p-4`}>
          <h3 className="mb-2 text-sm font-semibold text-neutral-800">Rétention par cohorte <span className="font-normal text-neutral-400">· % de clients encore actifs N années après</span></h3>
          <Bars data={retention.avg.map((v: number | null, lag: number) => ({ label: `+${lag}`, value: v == null ? 0 : Math.round(v * 100) }))} color={C.blue} height={110} />
          <p className="mt-2 text-[11px] text-neutral-400">Rétention moyenne à +1 an : <strong className="text-neutral-600">{retention.avg[1] != null ? Math.round(retention.avg[1] * 100) + "%" : "—"}</strong>{retention.avg[2] != null && <> · à +2 ans : <strong className="text-neutral-600">{Math.round(retention.avg[2] * 100)}%</strong></>}. Dit si vous construisez une base ou remplissez un seau percé.</p>
        </div>
      </div>
    </div>
  );
}

// ── OVERVIEW ─────────────────────────────────────────────────────────────────
function Overview({ kpi, series, lists, refYear, prevYear, patch, setTab, setCohort, monthActive }: any) {
  const k = kpi;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Kpi v={fmt(k.curYTD)} l={`CA ${refYear} à date (${k.ytdLabel})`} delta={<Delta cur={k.curYTD} prev={k.prevYTD} />} accent="ring-1 ring-neutral-900/5" />
        <Kpi v={fmt(k.projection)} l={`Projection ${refYear}`} delta={<Delta cur={k.projection} prev={k.prevFull} />} />
        <Kpi v={fmt(k.nCmd)} l={`Commandes ${refYear}`} />
        <Kpi v={fmt(k.activeClients)} l={`Clients actifs ${refYear}`} onClick={() => setTab("clients")} />
        <Kpi v={fmt(k.avgBasket)} l="Panier moyen" />
        <Kpi v={fmt(k.nullCur)} l="Cmd. sans montant" accent={k.nullCur > 0 ? "ring-1 ring-amber-300" : ""} onClick={() => patch({ amountState: "missing" })} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi v={fmt(k.totalAllTime)} l="CA total (filtré)" />
        <Kpi v={fmt(k.newClients)} l="Nouveaux clients" delta={<span className="text-neutral-400">{fmt(k.newCA)}</span>} onClick={() => { setCohort("new"); setTab("clients"); }} />
        <Kpi v={fmt(k.retClients)} l="Clients récurrents" delta={<span className="text-neutral-400">{fmt(k.retCA)}</span>} onClick={() => { setCohort("recurring"); setTab("clients"); }} />
        <Kpi v={fmt(k.received)} l={`Encaissé ${refYear}`} onClick={() => patch({ status: "paid" })} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className={`${card} p-4`}><h3 className="mb-2 text-sm font-semibold text-neutral-800">CA cumulé · {refYear} vs {prevYear}</h3><Lines labels={series.monthLabels} series={[{ name: `${prevYear}`, points: series.cumPrev, color: C.mid }, { name: `${refYear}`, points: series.cumCur, color: C.ink }]} /></div>
        <div className={`${card} p-4`}>
          <h3 className="mb-2 text-sm font-semibold text-neutral-800">CA mensuel · clique un mois pour filtrer</h3>
          <GroupedBars labels={series.monthLabels} a={series.monthPrev} b={series.monthCur} aName={`${prevYear}`} bName={`${refYear}`} onBar={(i: number) => patch({ month: monthActive === i + 1 ? null : i + 1 })} active={monthActive ? monthActive - 1 : null} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <MoverCard title="En croissance" tone="up" rows={lists.growing} onHeader={() => { setCohort("growing"); setTab("clients"); }} onRow={() => { setCohort("growing"); setTab("clients"); }} />
        <MoverCard title="En baisse" tone="down" rows={lists.declining} onHeader={() => { setCohort("declining"); setTab("clients"); }} onRow={() => { setCohort("declining"); setTab("clients"); }} />
        <MoverCard title="À relancer (dormants)" tone="amber" rows={lists.dormant} onHeader={() => { setCohort("dormant"); setTab("clients"); }} onRow={(code: string) => patch({ clientCode: code })} />
      </div>
    </div>
  );
}
function MoverCard({ title, tone, rows, onHeader, onRow }: any) {
  const col = tone === "up" ? "text-emerald-600" : tone === "down" ? "text-rose-600" : "text-amber-600";
  return (
    <div className={`${card} p-4`}>
      <button type="button" onClick={onHeader} className="mb-2 flex w-full items-center justify-between text-sm font-semibold text-neutral-800 hover:text-neutral-950">{title} <span className="text-[11px] font-normal text-neutral-400">voir tout →</span></button>
      {rows.length === 0 ? <p className="text-[12px] text-neutral-400">—</p> : (
        <ul className="space-y-1.5">
          {rows.slice(0, 6).map((p: ClientProfile) => (
            <li key={p.code}><button type="button" onClick={() => onRow(p.code)} className="flex w-full items-center justify-between text-[13px] hover:underline">
              <span className="truncate text-neutral-800">{p.name}</span>
              <span className={`ml-2 shrink-0 font-semibold ${col}`}>{tone === "amber" ? fmt(p.totalCA) : <Delta cur={p.curCA} prev={p.prevCA} />}</span>
            </button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── CLIENTS 360 ──────────────────────────────────────────────────────────────
function Clients({ profiles, base, refYear, dormancyMonths, maxDate, clientsIndex, filters, patch }: any) {
  const [q, setQ] = useState("");
  const [localCode, setLocalCode] = useState<string>("");
  const code = filters.clientCode || localCode || profiles[0]?.code || "";
  const filtered = useMemo(() => { const t = q.trim().toLowerCase(); return (t ? clientsIndex.filter((c: any) => (c.name || "").toLowerCase().includes(t) || c.code.toLowerCase().includes(t)) : clientsIndex).slice(0, 80); }, [q, clientsIndex]);
  // 360 profile = full history of the focused client under the current per-order filters.
  const clientOrders = useMemo(() => (code ? base.filter((o: IntelOrder) => o.clientCode === code) : []), [base, code]);
  const p: ClientProfile | undefined = useMemo(() => (code ? buildClientProfiles(clientOrders, refYear, { dormancyMonths, referenceDate: maxDate })[0] : undefined), [clientOrders, code, refYear, dormancyMonths, maxDate]);
  const sig = useMemo(() => (code ? clientSignal(code, clientOrders, maxDate) : null), [code, clientOrders, maxDate]);
  const crisk = useMemo(() => collectionRisk(clientOrders), [clientOrders]);

  return (
    <div className="grid gap-4 lg:grid-cols-[290px_1fr]">
      <div className={`${card} flex max-h-[74vh] flex-col p-2`}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un client…" className="mb-2 w-full rounded-md border border-neutral-200 px-2 py-1.5 text-sm outline-none focus:border-neutral-400" />
        <div className="overflow-auto">
          {filtered.map((c: any) => (<button key={c.code} type="button" onClick={() => setLocalCode(c.code)} className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[13px] ${code === c.code ? "bg-neutral-900 text-white" : "hover:bg-neutral-50"}`}><span className="truncate">{c.name || "(sans nom)"}</span><span className={`shrink-0 text-[11px] ${code === c.code ? "text-neutral-300" : "text-neutral-400"}`}>{c.code}</span></button>))}
        </div>
      </div>
      {p ? <Client360 p={p} sig={sig} crisk={crisk} onFilterAll={() => patch({ clientCode: p.code })} /> : <div className={`${card} p-6 text-center text-sm text-neutral-400`}>Sélectionne un client.</div>}
    </div>
  );
}
function Client360({ p, sig, crisk, onFilterAll }: { p: ClientProfile; sig: ClientSignal | null; crisk: number; onFilterAll: () => void }) {
  const [ai, setAi] = useState<string | null>(null); const [loading, setLoading] = useState(false); const [err, setErr] = useState<string | null>(null);
  async function run() {
    setLoading(true); setErr(null);
    const ctx = `Client ${p.name} (${p.code}), pays ${p.country}, commercial ${p.mainSaler}. Profil: ${p.label}, tendance ${p.trend}, score ${p.score}/100. CA total ${fmt(p.totalCA)} depuis ${p.firstYear} (${p.relationshipAgeYears} ans). ${p.orderCount} commandes, panier moyen ${fmt(p.avgBasket)}, plus grosse ${fmt(p.biggest)}, plus petite ${fmt(p.smallest)}, part du top achat ${(p.biggestShare * 100).toFixed(0)}%. Cycle d'achat ~${p.avgDaysBetween ?? "?"} j, dernière commande ${p.lastDate ?? p.lastYear}, prochaine estimée ${p.estimatedNext ?? "n/a"}. CA par année: ${p.byYear.map((y) => `${y.year}:${fmt(y.ca)}`).join(", ")}. Terme préféré ${p.paymentTerm ?? "?"}.`;
    const r = await clientNarrative(ctx); setLoading(false);
    if (r.ok) setAi(r.text); else setErr(r.error);
  }
  const reco = p.trend === "dormant" ? `Dormant depuis ${p.lastYear} — relance prioritaire (${fmt(p.totalCA)} historique).` : p.trend === "baisse" ? `En recul — reprendre contact rapidement.` : p.trend === "croissance" ? `En croissance — capitaliser (upsell).` : p.trend === "nouveau" ? `Nouveau — fidéliser (2ᵉ commande).` : `Stable — maintenir + détecter l'upsell.`;
  return (
    <div className="space-y-4">
      <div className={`${card} p-4`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2"><h2 className="text-lg font-bold text-neutral-900">{p.name || "(sans nom)"}</h2><TrendBadge t={p.trend} /><span className="rounded-full bg-neutral-900 px-2 py-0.5 text-[10px] font-semibold text-white">{p.label}</span></div>
            <div className="text-[12px] text-neutral-400">{p.code} · {p.country} · commercial : <strong className="text-neutral-600">{p.mainSaler}</strong> · relation {p.relationshipAgeYears} an{p.relationshipAgeYears > 1 ? "s" : ""} · score {p.score}/100</div>
          </div>
          <div className="text-right"><div className="text-xl font-bold tabular-nums text-neutral-900">{fmt(p.totalCA)}</div><div className="text-[10px] uppercase tracking-wider text-neutral-400">CA total depuis {p.firstYear}</div></div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="rounded-lg bg-neutral-50 px-3 py-2 text-[13px] text-neutral-700">💡 {reco}</span>
          <button type="button" onClick={run} disabled={loading} className="rounded-lg bg-neutral-900 px-2.5 py-1.5 text-[12px] font-semibold text-white hover:bg-neutral-700 disabled:opacity-50">{loading ? "…" : "✨ Lecture IA"}</button>
          <button type="button" onClick={onFilterAll} className="rounded-lg border border-neutral-200 px-2.5 py-1.5 text-[12px] font-semibold text-neutral-600 hover:bg-neutral-50">Filtrer tout sur ce client</button>
        </div>
        {err && <div className="mt-2 text-[12px] text-amber-700">{err}</div>}
        {ai && <div className="mt-2 whitespace-pre-wrap rounded-lg border border-neutral-200 bg-white p-3 text-[13px] leading-relaxed text-neutral-700">{ai}</div>}
      </div>

      {sig && (
        <div className={`${card} flex flex-wrap items-center gap-x-6 gap-y-1 p-3 text-[12px]`}>
          <span className="text-[10px] uppercase tracking-wider text-neutral-400">Signaux décision</span>
          <span>Churn : <strong className={CHURN[sig.churnLevel].c}>{CHURN[sig.churnLevel].l} ({Math.round(sig.churnProb * 100)}%)</strong>{sig.daysSinceLast != null && <span className="text-neutral-400"> · {sig.daysSinceLast}j / attendu ~{sig.expectedGap ?? "?"}j</span>}</span>
          <span>Prochaine commande : <strong className="text-neutral-800">{sig.nextDate ?? "—"}</strong>{sig.nextAmount != null && <span className="text-neutral-400"> (~{fmt(sig.nextAmount)})</span>}</span>
          <span>Risque encaissement : <strong className={crisk >= 60 ? "text-rose-600" : crisk >= 30 ? "text-amber-600" : "text-emerald-600"}>{crisk}/100</strong></span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Kpi v={fmt(p.orderCount)} l="Commandes" />
        <Kpi v={fmt(p.avgBasket)} l="Panier moyen" />
        <Kpi v={fmt(p.biggest)} l="Plus grosse cmd." />
        <Kpi v={fmt(p.smallest)} l="Plus petite cmd." />
        <Kpi v={p.avgDaysBetween != null ? `${p.avgDaysBetween} j` : "—"} l="Cycle d'achat" />
        <Kpi v={p.estimatedNext ?? "—"} l="Prochaine commande (est.)" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className={`${card} p-4`}><h3 className="mb-2 text-sm font-semibold text-neutral-800">CA par année</h3><Bars data={p.byYear.map((y) => ({ label: String(y.year), value: y.ca }))} /></div>
        <div className={`${card} p-4`}>
          <h3 className="mb-2 text-sm font-semibold text-neutral-800">Répartition des montants de commande</h3>
          <Bars data={p.valueBuckets.map((b) => ({ label: b.label, value: b.count }))} color={C.blue} height={120} />
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] text-neutral-500">
            <div>Terme préféré : <strong className="text-neutral-700">{p.paymentTerm ?? "—"}</strong></div>
            <div>Part top achat : <strong className="text-neutral-700">{(p.biggestShare * 100).toFixed(0)}%</strong></div>
            <div>Nb impayés : <strong className="text-neutral-700">{fmt(p.balance)}</strong> solde</div>
            <div>Encaissé : <strong className="text-neutral-700">{fmt(p.received)}</strong></div>
          </div>
        </div>
        <div className={`${card} p-4`}><h3 className="mb-2 text-sm font-semibold text-neutral-800">CA par pays</h3>{p.byCountry.length ? <ul className="space-y-1 text-[13px]">{p.byCountry.map((c) => <li key={c.country} className="flex justify-between"><span className="text-neutral-700">{c.country}</span><span className="font-semibold tabular-nums text-neutral-900">{fmt(c.ca)}</span></li>)}</ul> : <p className="text-[12px] text-neutral-400">—</p>}</div>
      </div>
    </div>
  );
}

// ── PAYS ─────────────────────────────────────────────────────────────────────
function Pays({ countries, refYear, prevYear, filters, patch }: any) {
  const sel = filters.country || countries[0]?.country || "";
  const c: CountryStat | undefined = countries.find((x: CountryStat) => x.country === sel);
  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <div className={`${card} max-h-[74vh] overflow-auto p-2`}>
        {countries.map((x: CountryStat) => (<button key={x.country} type="button" onClick={() => patch({ country: filters.country === x.country ? null : x.country })} className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[13px] ${sel === x.country ? "bg-neutral-900 text-white" : "hover:bg-neutral-50"}`}><span className="truncate">{x.country}</span><span className="flex shrink-0 items-center gap-2"><span className={`text-[11px] ${sel === x.country ? "text-neutral-300" : "text-neutral-400"}`}>{fmtShort(x.totalCA)}</span><Delta cur={x.curCA} prev={x.prevCA} className="text-[11px]" /></span></button>))}
      </div>
      {c ? (
        <div className="space-y-4">
          <div className={`${card} flex flex-wrap items-center justify-between gap-2 p-4`}><div className="flex items-center gap-2"><h2 className="text-lg font-bold text-neutral-900">{c.country}</h2>{filters.country === c.country && <span className="rounded-full bg-neutral-900 px-2 py-0.5 text-[10px] font-semibold text-white">filtre actif</span>}</div><div className="text-right"><div className="text-xl font-bold tabular-nums text-neutral-900">{fmt(c.totalCA)} <Delta cur={c.curCA} prev={c.prevCA} className="text-[13px]" /></div><div className="text-[10px] uppercase tracking-wider text-neutral-400">CA total · {refYear} vs {prevYear}</div></div></div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <Kpi v={fmt(c.orders)} l="Commandes" /><Kpi v={fmt(c.clients)} l="Clients" /><Kpi v={fmt(c.avgBasket)} l="Panier moyen" />
            <Kpi v={`${Math.round(c.concentration * 100)}%`} l="Concentration" accent={c.concentration >= 0.5 ? "ring-1 ring-amber-300" : ""} />
            <Kpi v={c.topSaler} l="Top commercial" onClick={() => patch({ saler: c.topSaler })} />
            <Kpi v={fmtShort(c.topClientCA)} l={`Top client · ${c.topClient}`} />
          </div>
          <div className={`${card} p-4`}><h3 className="mb-2 text-sm font-semibold text-neutral-800">CA par année · {c.country}</h3><Bars data={c.byYear.map((y) => ({ label: String(y.year), value: y.ca }))} color={C.blue} /></div>
        </div>
      ) : <div className={`${card} p-6 text-center text-sm text-neutral-400`}>Sélectionne un pays.</div>}
    </div>
  );
}

// ── COMMERCIAUX ──────────────────────────────────────────────────────────────
function Commerciaux({ salers, refYear, filters, patch }: any) {
  const sel = filters.saler ? String(filters.saler).toUpperCase() : (salers[0]?.saler ?? "");
  const s: SalerStat | undefined = salers.find((x: SalerStat) => x.saler === sel);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {salers.map((x: SalerStat) => (<button key={x.saler} type="button" onClick={() => patch({ saler: filters.saler === x.saler ? null : x.saler })} className={`${card} p-3 text-left transition-shadow hover:shadow-sm ${sel === x.saler ? "ring-2 ring-neutral-900" : ""}`}><div className="flex items-center justify-between"><span className="font-semibold text-neutral-900">{x.saler}</span><Delta cur={x.curCA} prev={x.prevCA} className="text-[12px] font-semibold" /></div><div className="mt-1 text-lg font-bold tabular-nums text-neutral-900">{fmt(x.curCA)}</div><div className="text-[10px] uppercase tracking-wider text-neutral-400">CA {refYear} · {x.clients} clients</div><div className="mt-2"><Spark values={x.byYear.map((y) => y.ca)} /></div></button>))}
      </div>
      {s && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <Kpi v={fmt(s.curCA)} l={`CA ${refYear} à date`} delta={<Delta cur={s.curCA} prev={s.prevCA} />} />
            <Kpi v={fmt(s.orders)} l="Commandes" /><Kpi v={fmt(s.clients)} l="Clients" /><Kpi v={fmt(s.newClients)} l="Nouveaux clients" /><Kpi v={fmt(s.avgBasket)} l="Panier moyen" />
            <Kpi v={`${Math.round(s.topClientShare * 100)}%`} l="Dépendance top client" accent={s.topClientShare >= 0.4 ? "ring-1 ring-amber-300" : ""} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className={`${card} p-4`}><h3 className="mb-2 text-sm font-semibold text-neutral-800">CA par année · {s.saler}</h3><Bars data={s.byYear.map((y) => ({ label: String(y.year), value: y.ca }))} /></div>
            <div className={`${card} p-4`}><h3 className="mb-2 text-sm font-semibold text-neutral-800">Pays principaux</h3><ul className="space-y-1.5 text-[13px]">{s.mainCountries.map((mc) => (<li key={mc.country} className="flex justify-between"><button type="button" onClick={() => patch({ country: mc.country })} className="text-neutral-700 hover:underline">{mc.country}</button><span className="font-semibold tabular-nums text-neutral-900">{fmt(mc.ca)}</span></li>))}</ul><div className="mt-3 text-[12px] text-neutral-500">Portefeuille {refYear} : <strong>{s.newClients}</strong> nouveaux · <strong>{s.returningClients}</strong> récurrents · client principal <strong>{s.topClient}</strong> · plus gros deal <strong>{fmt(s.biggest)}</strong>.</div></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── TENDANCES ────────────────────────────────────────────────────────────────
function Tendances({ series, refYear, prevYear, patch }: any) {
  const s = series;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className={`${card} p-4`}><h3 className="mb-2 text-sm font-semibold text-neutral-800">CA par année</h3><Bars data={s.caByYear.map((y: any) => ({ label: String(y.year), value: y.ca }))} /></div>
      <div className={`${card} p-4`}><h3 className="mb-2 text-sm font-semibold text-neutral-800">Commandes par année</h3><Bars data={s.ordersByYear.map((y: any) => ({ label: String(y.year), value: y.orders }))} color={C.blue} /></div>
      <div className={`${card} p-4`}><h3 className="mb-2 text-sm font-semibold text-neutral-800">Panier moyen par année</h3><Bars data={s.basketByYear.map((y: any) => ({ label: String(y.year), value: y.v }))} color={C.amber} /></div>
      <div className={`${card} p-4`}><h3 className="mb-2 text-sm font-semibold text-neutral-800">Nouveaux vs récurrents (clients/an)</h3><GroupedBars labels={s.newRetByYear.map((y: any) => String(y.year))} a={s.newRetByYear.map((y: any) => y.recurrent)} b={s.newRetByYear.map((y: any) => y.nouveau)} aName="Récurrents" bName="Nouveaux" /></div>
      <div className={`${card} p-4`}><h3 className="mb-2 text-sm font-semibold text-neutral-800">CA cumulé · {refYear} vs {prevYear}</h3><Lines labels={s.monthLabels} series={[{ name: `${prevYear}`, points: s.cumPrev, color: C.mid }, { name: `${refYear}`, points: s.cumCur, color: C.ink }]} /></div>
      <div className={`${card} p-4`}><h3 className="mb-2 text-sm font-semibold text-neutral-800">CA par trimestre · clique pour filtrer le mois</h3><GroupedBars labels={["T1", "T2", "T3", "T4"]} a={s.quarterPrev} b={s.quarterCur} aName={`${prevYear}`} bName={`${refYear}`} /></div>
    </div>
  );
}

// ── INSIGHTS + ASSISTANT ─────────────────────────────────────────────────────
const INS: Record<string, string> = { success: "border-emerald-200 bg-emerald-50/50", warning: "border-amber-200 bg-amber-50/50", danger: "border-rose-200 bg-rose-50/50", info: "border-neutral-200 bg-white" };
const INS_DOT: Record<string, string> = { success: "bg-emerald-500", warning: "bg-amber-500", danger: "bg-rose-500", info: "bg-neutral-400" };
function Insights({ insights, kpi, refYear, prevYear, profiles, countries, salers, filters, cohort }: any) {
  const ctx = useMemo(() => {
    const top = profiles.slice(0, 8).map((p: ClientProfile) => `${p.name}: ${fmt(p.totalCA)} (${p.trend})`).join("; ");
    const ctry = countries.slice(0, 6).map((c: CountryStat) => `${c.country}: ${fmt(c.curCA)} (${(g100(c.curCA, c.prevCA) ?? 0).toFixed(0)}%)`).join("; ");
    const sal = salers.slice(0, 6).map((s: SalerStat) => `${s.saler}: ${fmt(s.curCA)} (${(g100(s.curCA, s.prevCA) ?? 0).toFixed(0)}%)`).join("; ");
    const f = Object.entries({ ...filters, cohort: cohort === "all" ? undefined : cohort }).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(", ") || "aucun";
    return `Filtres: ${f}. CA ${refYear} à date ${fmt(kpi.curYTD)} (vs ${fmt(kpi.prevYTD)} ${prevYear}). Projection ${fmt(kpi.projection)}. ${kpi.activeClients} clients actifs, ${kpi.nullCur} cmd sans montant.\nTop clients: ${top}.\nPays: ${ctry}.\nCommerciaux: ${sal}.`;
  }, [insights, kpi, profiles, countries, salers, filters, cohort, refYear, prevYear]);
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="space-y-3">
        <p className="text-sm text-neutral-500">Analyse recalculée en direct sur le jeu <strong>filtré</strong> — décisions, risques, opportunités.</p>
        <div className="grid gap-3 md:grid-cols-2">
          {insights.map((i: any, idx: number) => (<div key={idx} className={`rounded-xl border p-4 ${INS[i.kind]}`}><div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${INS_DOT[i.kind]}`} /><h3 className="text-sm font-semibold text-neutral-900">{i.title}</h3></div><p className="mt-1 text-[13px] text-neutral-600">{i.detail}</p></div>))}
        </div>
      </div>
      <Assistant context={ctx} />
    </div>
  );
}
function Assistant({ context }: { context: string }) {
  const [q, setQ] = useState(""); const [log, setLog] = useState<{ q: string; a: string }[]>([]); const [loading, setLoading] = useState(false); const [err, setErr] = useState<string | null>(null);
  const SUGGEST = ["Pourquoi juin a baissé ?", "Résume le Maroc", "Quels clients n'ont pas commandé depuis 12 mois ?", "Quel commercial dépend le plus d'un client ?"];
  async function ask(question: string) { if (!question.trim()) return; setLoading(true); setErr(null); const r = await askAssistant(question, context); setLoading(false); setQ(""); if (r.ok) setLog((l) => [{ q: question, a: r.text }, ...l]); else setErr(r.error); }
  return (
    <div className={`${card} flex max-h-[74vh] flex-col p-3`}>
      <h3 className="mb-1 text-sm font-semibold text-neutral-800">Assistant ✨</h3>
      <p className="mb-2 text-[11px] text-neutral-400">Pose une question sur le jeu filtré.</p>
      <div className="mb-2 flex flex-wrap gap-1">{SUGGEST.map((s) => <button key={s} type="button" onClick={() => ask(s)} className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-600 hover:bg-neutral-200">{s}</button>)}</div>
      <div className="flex gap-1"><input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") ask(q); }} placeholder="Ta question…" className="flex-1 rounded-md border border-neutral-200 px-2 py-1.5 text-[13px] outline-none focus:border-neutral-400" /><button type="button" onClick={() => ask(q)} disabled={loading} className="rounded-md bg-neutral-900 px-3 text-[12px] font-semibold text-white disabled:opacity-50">{loading ? "…" : "→"}</button></div>
      {err && <div className="mt-2 text-[12px] text-amber-700">{err}</div>}
      <div className="mt-2 space-y-2 overflow-auto">
        {log.map((e, i) => (<div key={i} className="rounded-lg border border-neutral-100 bg-neutral-50/50 p-2 text-[13px]"><div className="font-semibold text-neutral-800">{e.q}</div><div className="mt-0.5 whitespace-pre-wrap text-neutral-600">{e.a}</div></div>))}
      </div>
    </div>
  );
}
