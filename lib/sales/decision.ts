/**
 * Sales & Analytics — DECISION ENGINE (v5). Squeezes maximum decision value out
 * of the EXISTING register only — NO new data. Everything here is built from
 * fields already stored: dates (order/shipment), amounts (pi/sales/received/
 * balance/transport/bank), payment_terms, client/country/saler.
 *
 * Provides: base-installed forecast, AR aging (anchored on shipment), churn risk
 * with a PER-CLIENT threshold (seasonal-aware), reorder prediction, retention
 * cohorts, growth decomposition (new/expansion/churn/contraction), concentration
 * (HHI), collection & country & saler scores, cost-leakage proxies, and noise
 * detection (samples / compensations / amendments). Pure + unit-tested.
 */
import type { IntelOrder } from "./intelligence.ts";

const DAY = 86_400_000;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const num = (x: number | null | undefined) => (x == null ? null : Number(x) || 0);
const ts = (d: string | null | undefined) => (d ? new Date(d).getTime() : NaN);

// ── payment terms parsing (e.g. "5/5TT" → 50% deposit, "100% TT HK" → 100% + HK) ─
export function parseTerms(t: string | null | undefined): { depositPct: number | null; corridor: string | null } {
  const s = (t ?? "").trim().toUpperCase();
  if (!s) return { depositPct: null, corridor: null };
  const corridor = /\bHK\b|HONG/.test(s) ? "HK" : null;
  if (/100\s*%/.test(s)) return { depositPct: 100, corridor };
  const m = /(\d+)\s*\/\s*(\d+)/.exec(s);
  if (m) { const a = +m[1], b = +m[2]; if (a + b > 0) return { depositPct: Math.round((a / (a + b)) * 100), corridor }; }
  if (/\bLC\b/.test(s)) return { depositPct: 0, corridor };
  return { depositPct: null, corridor };
}

// ── cadence of a client's order dates ────────────────────────────────────────
export function cadence(dates: string[]): { n: number; meanDays: number | null; p90Days: number | null; cv: number | null } {
  const t = dates.map(ts).filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
  if (t.length < 2) return { n: t.length, meanDays: null, p90Days: null, cv: null };
  const gaps: number[] = []; for (let i = 1; i < t.length; i++) gaps.push((t[i] - t[i - 1]) / DAY);
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const sd = Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length);
  const sorted = [...gaps].sort((a, b) => a - b);
  const p90 = sorted[Math.min(sorted.length - 1, Math.floor(0.9 * (sorted.length - 1)))];
  return { n: t.length, meanDays: Math.round(mean), p90Days: Math.round(p90), cv: mean > 0 ? sd / mean : null };
}

export type ChurnLevel = "ok" | "watch" | "risk" | "lost";
export type ClientSignal = { code: string; daysSinceLast: number | null; expectedGap: number | null; churnProb: number; churnLevel: ChurnLevel; nextDate: string | null; nextAmount: number | null };

/** Personalised, seasonal-aware churn + reorder prediction for one client. */
export function clientSignal(code: string, orders: readonly IntelOrder[], refDate: string): ClientSignal {
  const withDate = orders.filter((o) => o.date);
  const dates = withDate.map((o) => o.date as string);
  const cad = cadence(dates);
  const lastTs = Math.max(0, ...dates.map(ts).filter((x) => !Number.isNaN(x)));
  const refTs = ts(refDate);
  if (!lastTs) return { code, daysSinceLast: null, expectedGap: null, churnProb: 0, churnLevel: "ok", nextDate: null, nextAmount: null };
  const daysSince = (refTs - lastTs) / DAY;
  const base = cad.p90Days ?? (cad.meanDays != null ? cad.meanDays * 1.5 : null);
  let prob: number, gap: number | null = null;
  if (base == null) { prob = daysSince > 540 ? 0.85 : daysSince > 365 ? 0.55 : 0.15; }
  else { const pad = (cad.cv ?? 0) > 0.6 ? 1.4 : 1.0; gap = Math.round(base * pad); prob = clamp01((daysSince / gap - 0.8) / 0.8); }
  const level: ChurnLevel = prob >= 0.85 ? "lost" : prob >= 0.5 ? "risk" : prob >= 0.25 ? "watch" : "ok";
  // reorder prediction (only if not lost)
  const recent = withDate.slice().sort((a, b) => ts(b.date) - ts(a.date)).slice(0, 3);
  const amts = recent.map((o) => num(o.sales_amount)).filter((x): x is number => x != null);
  const nextAmount = amts.length ? Math.round(amts.reduce((a, b) => a + b, 0) / amts.length) : null;
  const nextDate = level !== "lost" && cad.meanDays != null && lastTs ? new Date(lastTs + cad.meanDays * DAY).toISOString().slice(0, 10) : null;
  return { code, daysSinceLast: Math.round(daysSince), expectedGap: gap, churnProb: Math.round(prob * 100) / 100, churnLevel: level, nextDate, nextAmount };
}

export function clientSignals(orders: readonly IntelOrder[], refDate: string): Map<string, ClientSignal> {
  const g = new Map<string, IntelOrder[]>();
  for (const o of orders) { if (!o.clientCode) continue; let a = g.get(o.clientCode); if (!a) { a = []; g.set(o.clientCode, a); } a.push(o); }
  const m = new Map<string, ClientSignal>();
  for (const [code, os] of g) m.set(code, clientSignal(code, os, refDate));
  return m;
}

// ── AR aging — anchored on shipment date (fallback order date). No due dates ──
export type AgingBucket = { label: string; amount: number; count: number };
export type Debtor = { code: string; name: string; country: string; outstanding: number; oldestDays: number };
export function arAging(orders: readonly IntelOrder[], refDate: string): { totalOutstanding: number; buckets: AgingBucket[]; debtors: Debtor[] } {
  const refTs = ts(refDate);
  const B: [string, number, number][] = [["0–30 j", 0, 30], ["31–60 j", 30, 60], ["61–90 j", 60, 90], ["> 90 j", 90, Infinity]];
  const buckets: AgingBucket[] = B.map(([label]) => ({ label, amount: 0, count: 0 }));
  const byClient = new Map<string, Debtor>();
  for (const o of orders) {
    const bal = num(o.balance); if (bal == null || bal <= 0.5) continue;
    const anchor = ts(o.shipmentDate) || ts(o.date);
    const ageDays = Number.isNaN(anchor) ? 9999 : Math.max(0, (refTs - anchor) / DAY);
    const bi = B.findIndex(([, lo, hi]) => ageDays >= lo && ageDays < hi);
    if (bi >= 0) { buckets[bi].amount += bal; buckets[bi].count++; }
    const d = byClient.get(o.clientCode) ?? { code: o.clientCode, name: o.clientName, country: o.country, outstanding: 0, oldestDays: 0 };
    d.outstanding += bal; d.oldestDays = Math.max(d.oldestDays, Math.round(ageDays)); byClient.set(o.clientCode, d);
  }
  return { totalOutstanding: buckets.reduce((s, b) => s + b.amount, 0), buckets, debtors: [...byClient.values()].sort((a, b) => b.outstanding - a.outstanding).slice(0, 12) };
}

// ── base-installed forecast (bottom-up, explainable) ─────────────────────────
export type Forecast = { curYTD: number; forecastFullYear: number; remaining: number; prevFull: number; activeClients: number };
export function baseForecast(orders: readonly IntelOrder[], refYear: number): Forecast {
  // per-client: last full year as baseline × momentum (YTD vs same-period last yr), floored at what they already did this year.
  const ytdM = Math.max(...orders.filter((o) => o.year === refYear && o.sales_amount != null && o.month != null).map((o) => o.month as number), 0) || 12;
  const byClient = new Map<string, IntelOrder[]>();
  for (const o of orders) { if (!o.clientCode) continue; let a = byClient.get(o.clientCode); if (!a) { a = []; byClient.set(o.clientCode, a); } a.push(o); }
  const sumYear = (os: IntelOrder[], y: number, throughM = 12) => os.reduce((s, o) => s + (o.year === y && o.sales_amount != null && (o.month ?? 0) <= throughM ? (num(o.sales_amount) as number) : 0), 0);
  let forecast = 0, curYTD = 0, prevFull = 0, active = 0;
  for (const os of byClient.values()) {
    const cur = sumYear(os, refYear, ytdM), prevY = sumYear(os, refYear - 1, ytdM), prevFullC = sumYear(os, refYear - 1);
    const baselineFull = prevFullC || sumYear(os, refYear - 2) || (ytdM > 0 ? (cur / ytdM) * 12 : 0);
    if (cur === 0 && baselineFull === 0) continue;
    active++;
    const momentum = prevY > 0 ? Math.max(0.4, Math.min(2.2, cur / prevY)) : 1;
    forecast += Math.max(cur, baselineFull * momentum);
    curYTD += cur; prevFull += prevFullC;
  }
  return { curYTD, forecastFullYear: Math.round(forecast), remaining: Math.round(forecast - curYTD), prevFull, activeClients: active };
}

// ── retention cohorts (by first-order year) ──────────────────────────────────
export type Cohort = { year: number; size: number; retention: (number | null)[] }; // retention[lag] = rate at year+lag
export function retentionCohorts(orders: readonly IntelOrder[]): { cohorts: Cohort[]; avg: (number | null)[]; years: number[] } {
  const firstYear = new Map<string, number>(); const activeYears = new Map<string, Set<number>>();
  for (const o of orders) { if (o.year == null || !o.clientCode) continue; const y = firstYear.get(o.clientCode); if (y == null || o.year < y) firstYear.set(o.clientCode, o.year); let s = activeYears.get(o.clientCode); if (!s) { s = new Set(); activeYears.set(o.clientCode, s); } s.add(o.year); }
  const years = [...new Set(orders.map((o) => o.year).filter((y): y is number => y != null))].sort((a, b) => a - b);
  const maxLag = years.length - 1;
  const byCohort = new Map<number, string[]>();
  for (const [code, y] of firstYear) { let a = byCohort.get(y); if (!a) { a = []; byCohort.set(y, a); } a.push(code); }
  const cohorts: Cohort[] = [];
  for (const y of years) {
    const codes = byCohort.get(y) ?? []; if (!codes.length) continue;
    const retention: (number | null)[] = [];
    for (let lag = 0; lag <= maxLag; lag++) { const yy = y + lag; if (yy > years[years.length - 1]) { retention.push(null); continue; } const r = codes.filter((c) => activeYears.get(c)?.has(yy)).length / codes.length; retention.push(Math.round(r * 100) / 100); }
    cohorts.push({ year: y, size: codes.length, retention });
  }
  const avg: (number | null)[] = [];
  for (let lag = 0; lag <= maxLag; lag++) { const vals = cohorts.map((c) => c.retention[lag]).filter((v): v is number => v != null); avg.push(vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100 : null); }
  return { cohorts, avg, years };
}

// ── growth decomposition (YTD-aligned): new / expansion / contraction / churn ─
export type GrowthDecomp = { total: number; newC: number; expansion: number; contraction: number; churn: number; curYTD: number; prevYTD: number };
export function growthDecomposition(orders: readonly IntelOrder[], refYear: number): GrowthDecomp {
  const ytdM = Math.max(...orders.filter((o) => o.year === refYear && o.sales_amount != null && o.month != null).map((o) => o.month as number), 0) || 12;
  const cur = new Map<string, number>(), prev = new Map<string, number>();
  for (const o of orders) { const a = num(o.sales_amount); if (a == null || (o.month ?? 0) > ytdM) continue; if (o.year === refYear) cur.set(o.clientCode, (cur.get(o.clientCode) ?? 0) + a); else if (o.year === refYear - 1) prev.set(o.clientCode, (prev.get(o.clientCode) ?? 0) + a); }
  let newC = 0, expansion = 0, contraction = 0, churn = 0, curYTD = 0, prevYTD = 0;
  const codes = new Set([...cur.keys(), ...prev.keys()]);
  for (const c of codes) { const a = cur.get(c) ?? 0, b = prev.get(c) ?? 0; curYTD += a; prevYTD += b; if (b === 0) newC += a; else if (a === 0) churn -= b; else if (a >= b) expansion += a - b; else contraction += a - b; }
  return { total: curYTD - prevYTD, newC, expansion, contraction, churn, curYTD, prevYTD };
}

// ── Herfindahl concentration (0..1) ──────────────────────────────────────────
export function hhi(values: number[]): number { const total = values.reduce((a, b) => a + Math.max(0, b), 0); if (total <= 0) return 0; return values.reduce((s, v) => s + (Math.max(0, v) / total) ** 2, 0); }

// ── collection risk (0..100, higher = riskier), from payment behaviour ───────
export function collectionRisk(orders: readonly IntelOrder[]): number {
  let billed = 0, received = 0, outstanding = 0, depSum = 0, depN = 0;
  for (const o of orders) { const pi = num(o.piAmount) ?? num(o.sales_amount); if (pi != null) billed += pi; const r = num(o.received); if (r != null) received += r; const b = num(o.balance); if (b != null && b > 0) outstanding += b; const t = parseTerms(o.paymentTerms).depositPct; if (t != null) { depSum += t; depN++; } }
  const paidRatio = billed > 0 ? received / billed : 1;
  const outRatio = billed > 0 ? outstanding / billed : 0;
  const avgDep = depN ? depSum / depN : 50;
  // higher risk when: low paid ratio, high outstanding, low deposit taken.
  const score = 100 * (0.5 * clamp01(1 - paidRatio) + 0.3 * clamp01(outRatio) + 0.2 * clamp01(1 - avgDep / 100));
  return Math.round(score);
}

// ── cost-leakage proxies by country (no COGS needed) ─────────────────────────
export type Leakage = { country: string; transportRatio: number; bankRatio: number; ca: number };
export function leakageByCountry(orders: readonly IntelOrder[]): Leakage[] {
  const g = new Map<string, { pi: number; transp: number; recv: number; bank: number; ca: number }>();
  for (const o of orders) { const a = g.get(o.country) ?? { pi: 0, transp: 0, recv: 0, bank: 0, ca: 0 }; a.pi += num(o.piAmount) ?? num(o.sales_amount) ?? 0; a.transp += num(o.transportation) ?? 0; a.recv += num(o.received) ?? 0; a.bank += num(o.bankCharge) ?? 0; a.ca += num(o.sales_amount) ?? 0; g.set(o.country, a); }
  return [...g.entries()].map(([country, v]) => ({ country, transportRatio: v.pi > 0 ? v.transp / v.pi : 0, bankRatio: v.recv > 0 ? v.bank / v.recv : 0, ca: v.ca })).filter((x) => x.ca > 0).sort((a, b) => b.transportRatio - a.transportRatio);
}

// ── noise detection: samples / free / compensation / amendments ──────────────
export type NoiseKind = "sample" | "free" | "compensation" | "amendment" | null;
export function classifyNoise(o: { pi_no?: string | null; clientName?: string | null; name?: string | null }): NoiseKind {
  const s = `${o.pi_no ?? ""} ${o.clientName ?? o.name ?? ""}`.toUpperCase();
  if (/样品|SAMPLE|SKT1[0-9]/.test(s)) return "sample";
  if (/FREE/.test(s)) return "free";
  if (/赔偿|COMPENSAT/.test(s)) return "compensation";
  if (/-C\b|-C$/.test(o.pi_no ?? "")) return "amendment";
  return null;
}
