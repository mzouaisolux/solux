/**
 * Sales & Analytics — client / country / saler INTELLIGENCE (dashboards §6, v3).
 *
 * SOURCE OF TRUTH = the sales_orders register. NULL sales_amount is EXCLUDED,
 * never 0 (§3), and surfaced as "à compléter". Pure + unit-tested; runs BOTH
 * server- and client-side (the interactive workspace recomputes on every filter
 * change). No I/O.
 *
 * Dormancy is by LAST-ORDER DATE against a configurable window (default 12
 * months) and is SEASONAL-AWARE: a client whose natural cadence is slower than
 * the window is only dormant once it exceeds ~2× its own cadence.
 */
import { growthPct, ytdSum, latestMonth, type PeriodOrder } from "./periods.ts";

export type IntelOrder = PeriodOrder & {
  date: string | null;
  country: string;
  clientCode: string;
  clientName: string;
  received: number | null;
  balance: number | null;
  paymentTerms?: string | null;
  currency?: string | null;
  shipmentDate?: string | null;
  transportation?: number | null;
  bankCharge?: number | null;
  piAmount?: number | null;
};

const up = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();
const amt = (o: IntelOrder) => (o.sales_amount == null ? null : Number(o.sales_amount) || 0);
const fmt = (n: number) => Math.round(n).toLocaleString("fr-FR");
const DAY = 86_400_000, MONTH = 30.44 * DAY;
function topKey(counts: Map<string, number>): string { let best = "", bv = -Infinity; for (const [k, v] of counts) if (v > bv) { bv = v; best = k; } return best; }
function push<T>(m: Map<string, T[]>, k: string, v: T) { let a = m.get(k); if (!a) { a = []; m.set(k, a); } a.push(v); }
function addISO(iso: string, days: number): string { const t = new Date(iso).getTime(); if (Number.isNaN(t)) return iso; return new Date(t + days * DAY).toISOString().slice(0, 10); }

// ── FILTERS (per-order; cohort/trend filtering is applied at the client level) ─
export type OrderStatus = "all" | "paid" | "unpaid" | "partial";
export type AmountState = "all" | "with" | "missing";
export type Filters = {
  country?: string | null; saler?: string | null; clientCode?: string | null;
  status?: OrderStatus; amountState?: AmountState;
  paymentTerm?: string | null; currency?: string | null;
  minAmount?: number | null; maxAmount?: number | null; month?: number | null;
};
function paidState(o: IntelOrder): OrderStatus {
  const a = amt(o); if (a == null || a <= 0) return "unpaid";
  const r = o.received ?? 0;
  if (r >= a - 0.01) return "paid";
  return r > 0 ? "partial" : "unpaid";
}
export function filterOrders(orders: readonly IntelOrder[], f: Filters): IntelOrder[] {
  return orders.filter((o) => {
    if (f.country && o.country !== f.country) return false;
    if (f.saler && up(o.saler) !== up(f.saler)) return false;
    if (f.clientCode && o.clientCode !== f.clientCode) return false;
    if (f.month && o.month !== f.month) return false;
    if (f.paymentTerm && (o.paymentTerms ?? "") !== f.paymentTerm) return false;
    if (f.currency && (o.currency ?? "USD") !== f.currency) return false;
    if (f.amountState === "with" && o.sales_amount == null) return false;
    if (f.amountState === "missing" && o.sales_amount != null) return false;
    if (f.status && f.status !== "all" && paidState(o) !== f.status) return false;
    const a = amt(o);
    if (f.minAmount != null && (a ?? 0) < f.minAmount) return false;
    if (f.maxAmount != null && (a ?? 1e18) > f.maxAmount) return false;
    return true;
  });
}

export type YearStat = { year: number; ca: number; orders: number };
export type ClientTrend = "nouveau" | "croissance" | "stable" | "baisse" | "dormant";
export type ClientProfileOpts = { dormancyMonths?: number; referenceDate?: string };

export type ClientProfile = {
  code: string; name: string; country: string; mainSaler: string;
  totalCA: number; orderCount: number; ordersWithAmount: number; nullCount: number;
  avgBasket: number; biggest: number; smallest: number; biggestShare: number;
  firstYear: number; lastYear: number; firstDate: string | null; lastDate: string | null;
  avgDaysBetween: number | null; monthsSinceLast: number | null; estimatedNext: string | null;
  relationshipAgeYears: number; byYear: YearStat[]; byCountry: { country: string; ca: number }[];
  paymentTerm: string | null; valueBuckets: { label: string; count: number }[];
  trend: ClientTrend; activeThisYear: boolean; curCA: number; prevCA: number; received: number; balance: number;
  score: number; label: string;
};

const BUCKETS: [string, number, number][] = [["<10k", 0, 10_000], ["10–50k", 10_000, 50_000], ["50–100k", 50_000, 100_000], ["100–250k", 100_000, 250_000], ["250k+", 250_000, Infinity]];

function avgDays(dates: string[]): number | null {
  const ts = dates.map((d) => new Date(d).getTime()).filter((t) => !Number.isNaN(t)).sort((a, b) => a - b);
  if (ts.length < 2) return null;
  let s = 0; for (let i = 1; i < ts.length; i++) s += ts[i] - ts[i - 1];
  return Math.round(s / (ts.length - 1) / DAY);
}

export function buildClientProfiles(orders: readonly IntelOrder[], refYear: number, opts?: ClientProfileOpts): ClientProfile[] {
  const ytdM = latestMonth(orders, refYear) || 12;
  const dormancyMonths = opts?.dormancyMonths ?? 12;
  const refTs = opts?.referenceDate ? new Date(opts.referenceDate).getTime() : Math.max(0, ...orders.map((o) => (o.date ? new Date(o.date).getTime() : 0)));
  const groups = new Map<string, IntelOrder[]>();
  for (const o of orders) if (o.clientCode) push(groups, o.clientCode, o);

  const out: ClientProfile[] = [];
  for (const [code, os] of groups) {
    const salerCounts = new Map<string, number>(), countryCounts = new Map<string, number>(), termCounts = new Map<string, number>(), countryCA = new Map<string, number>();
    const byYearMap = new Map<number, { ca: number; orders: number }>(); const dates: string[] = [];
    const buckets = BUCKETS.map(() => 0);
    let totalCA = 0, biggest = 0, smallest = Infinity, orderCount = 0, withAmt = 0, received = 0, balance = 0;
    for (const o of os) {
      orderCount++; const a = amt(o);
      if (o.saler) salerCounts.set(up(o.saler), (salerCounts.get(up(o.saler)) ?? 0) + 1);
      countryCounts.set(o.country, (countryCounts.get(o.country) ?? 0) + 1);
      if (o.paymentTerms) termCounts.set(o.paymentTerms, (termCounts.get(o.paymentTerms) ?? 0) + 1);
      if (o.date) dates.push(o.date);
      if (o.received != null) received += o.received;
      if (o.balance != null) balance += o.balance;
      if (o.year != null) { const y = byYearMap.get(o.year) ?? { ca: 0, orders: 0 }; y.orders++; if (a != null) y.ca += a; byYearMap.set(o.year, y); }
      if (a != null) { totalCA += a; withAmt++; biggest = Math.max(biggest, a); smallest = Math.min(smallest, a); countryCA.set(o.country, (countryCA.get(o.country) ?? 0) + a); const bi = BUCKETS.findIndex(([, lo, hi]) => a >= lo && a < hi); if (bi >= 0) buckets[bi]++; }
    }
    const byYear = [...byYearMap.entries()].map(([year, v]) => ({ year, ...v })).sort((a, b) => a.year - b.year);
    const firstYear = byYear.length ? byYear[0].year : refYear;
    const lastYear = byYear.length ? byYear[byYear.length - 1].year : refYear;
    const sortedDates = dates.slice().sort();
    const lastDate = sortedDates[sortedDates.length - 1] ?? null;
    const lastTs = lastDate ? new Date(lastDate).getTime() : NaN;
    const monthsSinceLast = Number.isNaN(lastTs) ? null : (refTs - lastTs) / MONTH;
    const cadence = avgDays(dates);
    const cadenceMonths = cadence != null ? cadence / 30.44 : null;
    const effWindow = cadenceMonths != null && cadenceMonths > dormancyMonths * 0.75 ? Math.max(dormancyMonths, cadenceMonths * 2) : dormancyMonths;
    const curCA = ytdSum(os, refYear, ytdM), prevCA = ytdSum(os, refYear - 1, ytdM);
    const activeThisYear = (byYearMap.get(refYear)?.orders ?? 0) > 0;

    let trend: ClientTrend;
    if (firstYear === refYear) trend = "nouveau";
    else if (monthsSinceLast != null && monthsSinceLast > effWindow) trend = "dormant";
    else { const g = growthPct(curCA, prevCA); trend = g == null ? "stable" : g >= 15 ? "croissance" : g <= -15 ? "baisse" : "stable"; }

    out.push({
      code, name: os[0].clientName, country: topKey(countryCounts) || "—", mainSaler: topKey(salerCounts) || "—",
      totalCA, orderCount, ordersWithAmount: withAmt, nullCount: orderCount - withAmt,
      avgBasket: withAmt ? totalCA / withAmt : 0, biggest, smallest: smallest === Infinity ? 0 : smallest,
      biggestShare: totalCA > 0 ? biggest / totalCA : 0,
      firstYear, lastYear, firstDate: sortedDates[0] ?? null, lastDate,
      avgDaysBetween: cadence, monthsSinceLast: monthsSinceLast == null ? null : Math.round(monthsSinceLast),
      estimatedNext: !["dormant"].includes(trend) && lastDate && cadence ? addISO(lastDate, cadence) : null,
      relationshipAgeYears: Math.max(1, refYear - firstYear + 1),
      byYear, byCountry: [...countryCA.entries()].map(([country, ca]) => ({ country, ca })).sort((a, b) => b.ca - a.ca).slice(0, 4),
      paymentTerm: topKey(termCounts) || null, valueBuckets: BUCKETS.map(([label], i) => ({ label, count: buckets[i] })),
      trend, activeThisYear, curCA, prevCA, received, balance, score: 0, label: "",
    });
  }
  // ── population post-pass: relationship score (recency·frequency·monetary) + profile label ──
  const maxCA = Math.max(1, ...out.map((p) => p.totalCA));
  const maxOrders = Math.max(1, ...out.map((p) => p.orderCount));
  const caRank = [...out].sort((a, b) => b.totalCA - a.totalCA);
  const topDecile = new Set(caRank.slice(0, Math.max(1, Math.ceil(caRank.length * 0.1))).map((p) => p.code));
  for (const p of out) {
    const rec = p.monthsSinceLast == null ? 0 : Math.max(0, 100 - p.monthsSinceLast * 7);
    const freq = Math.min(100, (p.orderCount / maxOrders) * 130);
    const mon = Math.min(100, (p.totalCA / maxCA) * 130);
    p.score = Math.round(0.4 * rec + 0.25 * freq + 0.35 * mon);
    p.label = labelOf(p, topDecile.has(p.code));
  }
  return out.sort((a, b) => b.totalCA - a.totalCA);
}

function labelOf(p: ClientProfile, isTop: boolean): string {
  if (p.trend === "nouveau") return "Nouveau compte";
  if (p.trend === "dormant") return p.totalCA >= 200_000 ? "Sleeping Giant" : "Client dormant";
  if (isTop && p.relationshipAgeYears >= 3) return "Compte stratégique";
  if (p.trend === "croissance") return "Partenaire en croissance";
  if (p.biggestShare >= 0.7 && p.orderCount <= 3) return "Client one-shot / tender";
  if (p.orderCount >= 10 && p.trend === "stable") return "Client fidèle";
  if (p.avgBasket > 0 && p.avgBasket < 5_000 && p.orderCount >= 6) return "Sensible au prix";
  if (p.trend === "baisse") return "À sécuriser (en recul)";
  return "Client régulier";
}

export function clientLists(profiles: ClientProfile[]) {
  const withCA = profiles.filter((p) => p.totalCA > 0);
  const byGrowthDesc = (a: ClientProfile, b: ClientProfile) => (growthPct(b.curCA, b.prevCA) ?? -1e9) - (growthPct(a.curCA, a.prevCA) ?? -1e9);
  return {
    top: [...withCA].slice(0, 10),
    growing: profiles.filter((p) => p.trend === "croissance").sort(byGrowthDesc).slice(0, 10),
    declining: profiles.filter((p) => p.trend === "baisse").sort((a, b) => (growthPct(a.curCA, a.prevCA) ?? 0) - (growthPct(b.curCA, b.prevCA) ?? 0)).slice(0, 10),
    dormant: profiles.filter((p) => p.trend === "dormant").sort((a, b) => b.totalCA - a.totalCA).slice(0, 10),
    newC: profiles.filter((p) => p.trend === "nouveau").sort((a, b) => b.curCA - a.curCA).slice(0, 10),
    highBasket: [...withCA].sort((a, b) => b.avgBasket - a.avgBasket).slice(0, 10),
    concentrated: withCA.filter((p) => p.orderCount >= 2 && p.biggestShare >= 0.6).sort((a, b) => b.biggestShare - a.biggestShare).slice(0, 10),
  };
}

export type CountryStat = {
  country: string; totalCA: number; orders: number; clients: number; avgBasket: number;
  topClient: string; topClientCA: number; topSaler: string; concentration: number;
  byYear: YearStat[]; curCA: number; prevCA: number;
};
export function buildCountryStats(orders: readonly IntelOrder[], refYear: number): CountryStat[] {
  const ytdM = latestMonth(orders, refYear) || 12;
  const g = new Map<string, IntelOrder[]>(); for (const o of orders) push(g, o.country, o);
  const out: CountryStat[] = [];
  for (const [country, os] of g) {
    const clientCA = new Map<string, number>(), salerCA = new Map<string, number>(), byY = new Map<number, { ca: number; orders: number }>(); const clients = new Set<string>();
    let totalCA = 0, orders_ = 0, wa = 0;
    for (const o of os) {
      orders_++; clients.add(o.clientCode); const a = amt(o);
      if (a != null) { totalCA += a; wa++; clientCA.set(o.clientName, (clientCA.get(o.clientName) ?? 0) + a); if (o.saler) salerCA.set(up(o.saler), (salerCA.get(up(o.saler)) ?? 0) + a); }
      if (o.year != null) { const y = byY.get(o.year) ?? { ca: 0, orders: 0 }; y.orders++; if (a != null) y.ca += a; byY.set(o.year, y); }
    }
    const topClient = topKey(clientCA);
    out.push({ country, totalCA, orders: orders_, clients: clients.size, avgBasket: wa ? totalCA / wa : 0, topClient: topClient || "—", topClientCA: clientCA.get(topClient) ?? 0, topSaler: topKey(salerCA) || "—", concentration: totalCA > 0 ? (clientCA.get(topClient) ?? 0) / totalCA : 0, byYear: [...byY.entries()].map(([year, v]) => ({ year, ...v })).sort((a, b) => a.year - b.year), curCA: ytdSum(os, refYear, ytdM), prevCA: ytdSum(os, refYear - 1, ytdM) });
  }
  return out.sort((a, b) => b.totalCA - a.totalCA);
}

export type SalerStat = {
  saler: string; totalCA: number; orders: number; clients: number; newClients: number; returningClients: number;
  avgBasket: number; mainCountries: { country: string; ca: number }[]; topClient: string; topClientShare: number; biggest: number;
  byYear: YearStat[]; curCA: number; prevCA: number;
};
export function buildSalerStats(orders: readonly IntelOrder[], refYear: number): SalerStat[] {
  const ytdM = latestMonth(orders, refYear) || 12;
  const firstYear = new Map<string, number>();
  for (const o of orders) { if (o.year == null) continue; const y = firstYear.get(o.clientCode); if (y == null || o.year < y) firstYear.set(o.clientCode, o.year); }
  const g = new Map<string, IntelOrder[]>(); for (const o of orders) { const s = up(o.saler); if (s) push(g, s, o); }
  const out: SalerStat[] = [];
  for (const [saler, os] of g) {
    const countryCA = new Map<string, number>(), clientCA = new Map<string, number>(), byY = new Map<number, { ca: number; orders: number }>(); const clients = new Set<string>(), curClients = new Set<string>();
    let totalCA = 0, orders_ = 0, wa = 0, biggest = 0;
    for (const o of os) {
      orders_++; clients.add(o.clientCode); const a = amt(o);
      if (o.year === refYear) curClients.add(o.clientCode);
      if (a != null) { totalCA += a; wa++; biggest = Math.max(biggest, a); countryCA.set(o.country, (countryCA.get(o.country) ?? 0) + a); clientCA.set(o.clientName, (clientCA.get(o.clientName) ?? 0) + a); }
      if (o.year != null) { const y = byY.get(o.year) ?? { ca: 0, orders: 0 }; y.orders++; if (a != null) y.ca += a; byY.set(o.year, y); }
    }
    let newC = 0, retC = 0; for (const c of curClients) (firstYear.get(c) === refYear ? newC++ : retC++);
    const topClient = topKey(clientCA);
    out.push({ saler, totalCA, orders: orders_, clients: clients.size, newClients: newC, returningClients: retC, avgBasket: wa ? totalCA / wa : 0, mainCountries: [...countryCA.entries()].map(([country, ca]) => ({ country, ca })).sort((a, b) => b.ca - a.ca).slice(0, 3), topClient: topClient || "—", topClientShare: totalCA > 0 ? (clientCA.get(topClient) ?? 0) / totalCA : 0, biggest, byYear: [...byY.entries()].map(([year, v]) => ({ year, ...v })).sort((a, b) => a.year - b.year), curCA: ytdSum(os, refYear, ytdM), prevCA: ytdSum(os, refYear - 1, ytdM) });
  }
  return out.sort((a, b) => b.curCA - a.curCA);
}

export type Insight = { kind: "success" | "warning" | "danger" | "info"; title: string; detail: string };
export function buildInsights(ctx: { refYear: number; prevYear: number; curYTD: number; prevYTD: number; projection: number; prevFull: number; nullCount: number; profiles: ClientProfile[]; countries: CountryStat[]; topClientShareOfYear: number; topClientName: string }): Insight[] {
  const ins: Insight[] = [];
  const g = growthPct(ctx.curYTD, ctx.prevYTD);
  if (g != null) ins.push({ kind: g >= 0 ? "success" : "danger", title: `CA ${ctx.refYear} à date ${g >= 0 ? "+" : ""}${g.toFixed(1)}% vs ${ctx.prevYear}`, detail: `${fmt(ctx.curYTD)} vs ${fmt(ctx.prevYTD)} sur la même période. ${g >= 0 ? "Dynamique positive." : "En retrait — à redresser."}` });
  const gp = growthPct(ctx.projection, ctx.prevFull);
  ins.push({ kind: "info", title: `Projection fin ${ctx.refYear} : ${fmt(ctx.projection)}`, detail: gp == null ? "Extrapolée du rythme actuel." : `À ce rythme, ${gp >= 0 ? "+" : ""}${gp.toFixed(1)}% vs ${ctx.prevYear} complet (${fmt(ctx.prevFull)}).` });
  const dormant = ctx.profiles.filter((p) => p.trend === "dormant");
  if (dormant.length) ins.push({ kind: "warning", title: `${dormant.length} clients dormants à relancer`, detail: `${fmt(dormant.reduce((s, p) => s + p.totalCA, 0))} de CA historique en sommeil. Prioriser : ${dormant.slice(0, 3).map((p) => p.name).join(", ")}.` });
  const declining = ctx.profiles.filter((p) => p.trend === "baisse");
  if (declining.length) ins.push({ kind: "danger", title: `${declining.length} clients en baisse`, detail: `À contacter avant qu'ils décrochent : ${declining.slice(0, 4).map((p) => p.name).join(", ")}.` });
  const growingC = ctx.countries.filter((c) => { const gg = growthPct(c.curCA, c.prevCA); return gg != null && gg >= 20 && c.curCA > 0; }).sort((a, b) => (growthPct(b.curCA, b.prevCA) ?? 0) - (growthPct(a.curCA, a.prevCA) ?? 0)).slice(0, 3);
  if (growingC.length) ins.push({ kind: "success", title: "Pays prioritaires (forte croissance)", detail: growingC.map((c) => `${c.country} +${(growthPct(c.curCA, c.prevCA) ?? 0).toFixed(0)}%`).join(" · ") });
  if (ctx.topClientShareOfYear >= 0.25) ins.push({ kind: "warning", title: `Concentration : ${ctx.topClientName} = ${(ctx.topClientShareOfYear * 100).toFixed(0)}% du CA ${ctx.refYear}`, detail: "Dépendance forte à un seul client — diversifier le portefeuille." });
  const newC = ctx.profiles.filter((p) => p.trend === "nouveau");
  if (newC.length) ins.push({ kind: "info", title: `${newC.length} nouveaux clients en ${ctx.refYear}`, detail: `${fmt(newC.reduce((s, p) => s + p.curCA, 0))} de CA apporté par de nouveaux comptes.` });
  if (ctx.nullCount > 0) ins.push({ kind: "warning", title: `${ctx.nullCount} commandes ${ctx.refYear} sans montant`, detail: "Données incomplètes : le CA réel est sous-estimé tant qu'elles ne sont pas saisies dans le registre." });
  return ins;
}
