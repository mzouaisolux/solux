import Link from "next/link";
import { getEffectiveRole } from "@/lib/auth";
import { hasUiCapability } from "@/lib/permissions";
import {
  loadActiveQuotationsForForecast,
  resolveOwnerLabels,
} from "@/lib/forecast-data";
import {
  ForecastWorkspace,
  type ForecastRow,
} from "@/components/forecast/ForecastWorkspace";
import { ForecastMethodology } from "@/components/forecast/ForecastMethodology";
import {
  computeForecastTotals,
  forecastByQuarter,
  forecastByOwner,
  forecastByCountry,
  forecastByFamily,
  weightedValue,
  fmtMoney,
  type ForecastDeal,
  type ForecastBucket,
} from "@/lib/forecast";

/**
 * /forecast — the operational forecast workspace + command center.
 *
 * NOT a passive analytics page. The centerpiece is an inline-editable
 * table of EVERY active quotation (sent / negotiating) — sales sets the
 * probability / category / close date right here, no navigation. The
 * KPI strip + distribution breakdowns sit around it as live context.
 *
 * Admin / TLM / operations get the company-wide view; sales sees their
 * own deals only.
 */
export default async function ForecastPage() {
  const { userId } = await getEffectiveRole();
  // Global (company-wide) view is matrix-managed via forecast.view_global
  // — management roles see everyone's pipeline, sales sees only their own.
  const global = await hasUiCapability("forecast.view_global");
  const scopedUserId = global ? null : userId ?? null;

  // ALL active quotations (forecasted or not) — the workspace edits the
  // full set; the analytics below derive from the forecasted subset.
  const allDeals = await loadActiveQuotationsForForecast(scopedUserId);
  const forecasted = allDeals.filter((d) => d.probability != null);

  const ownerLabels = global
    ? await resolveOwnerLabels(allDeals.map((d) => d.ownerId ?? "").filter(Boolean))
    : new Map<string, string>();

  // ---- Currency context ------------------------------------------------
  const currencies = Array.from(new Set(forecasted.map((d) => d.currency)));
  const dominantCurrency = pickDominantCurrency(forecasted);
  const mixed = currencies.length > 1;

  // ---- Headline KPIs (forecasted only) ---------------------------------
  const weightedByCur = new Map<string, number>();
  const commitByCur = new Map<string, number>();
  for (const d of forecasted) {
    weightedByCur.set(
      d.currency,
      (weightedByCur.get(d.currency) ?? 0) + weightedValue(d.total, d.probability)
    );
    if (d.category === "commit") {
      commitByCur.set(d.currency, (commitByCur.get(d.currency) ?? 0) + d.total);
    }
  }
  const totals = computeForecastTotals(forecasted);
  const unsetCount = allDeals.length - forecasted.length;

  // ---- Breakdowns (forecasted only) ------------------------------------
  const byQuarter = forecastByQuarter(forecasted);
  const byOwner = global ? forecastByOwner(forecasted, ownerLabels) : [];
  const byCountry = forecastByCountry(forecasted);
  const byFamily = forecastByFamily(forecasted);

  // ---- Workspace rows (serializable, owner label pre-resolved) ---------
  const rows: ForecastRow[] = allDeals.map((d) => ({
    id: d.id,
    number: d.number,
    clientName: d.clientName,
    country: d.country,
    ownerLabel: d.ownerId ? ownerLabels.get(d.ownerId) ?? null : null,
    total: d.total,
    currency: d.currency,
    status: d.status,
    probability: d.probability,
    category: d.category,
    expectedCloseDate: d.expectedCloseDate,
    updatedAt: d.updatedAt,
  }));

  return (
    <div className="mx-auto max-w-screen-2xl px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="eyebrow">Forecast</div>
          <h1 className="doc-title mt-1">
            {global ? "Commercial forecast" : "My forecast"}
          </h1>
          <p className="text-xs text-neutral-500 mt-2 max-w-xl">
            Your live pipeline of active quotations. Set probability,
            category and expected close inline — no need to open each
            quotation. The quotation stays the source of truth.
          </p>
        </div>
        <div className="text-right">
          <div className="eyebrow">View</div>
          <div
            className={`mt-1 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
              global
                ? "border-neutral-900 bg-neutral-900 text-white"
                : "border-sky-300 bg-sky-50 text-sky-800"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                global ? "bg-emerald-400" : "bg-sky-400"
              }`}
            />
            {global ? "Global · company-wide" : "Personal · my deals only"}
          </div>
        </div>
      </div>

      {/* Shared forecasting language — glossary + method. Collapsed by
          default; available whether or not there are deals yet. */}
      <ForecastMethodology />

      {allDeals.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard
              label="Weighted forecast"
              primary={weightedByCur.size > 0 ? formatMoneyMap(weightedByCur) : "—"}
              hint="Σ value × probability across forecasted deals"
              accent="emerald"
            />
            <KpiCard
              label="Commit"
              primary={commitByCur.size > 0 ? formatMoneyMap(commitByCur) : "—"}
              hint="Full value of deals marked Commit"
            />
            <KpiCard
              label="Forecasted / active"
              primary={`${forecasted.length} / ${allDeals.length}`}
              hint={
                unsetCount > 0
                  ? `${unsetCount} still need a forecast`
                  : "Every active deal is forecasted"
              }
              accent={unsetCount > 0 ? "amber" : undefined}
            />
            <KpiCard
              label="Outdated forecasts"
              primary={String(totals.staleCount)}
              hint="Not updated in 30+ days — reconfirm to keep reliable"
              accent={totals.staleCount > 0 ? "amber" : undefined}
            />
          </div>

          {/* Workspace — the editable centerpiece */}
          <ForecastWorkspace initialRows={rows} showOwner={global} />

          {/* Distribution analytics (forecasted only) */}
          {forecasted.length > 0 && (
            <>
              {mixed && (
                <p className="text-[11px] text-neutral-500">
                  Distribution breakdowns are shown in{" "}
                  <b>{dominantCurrency}</b>; deals in other currencies are
                  summed at face value for relative comparison.
                </p>
              )}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <BreakdownCard
                  title="By quarter"
                  subtitle="Weighted revenue by expected closing quarter"
                  buckets={byQuarter}
                  currency={dominantCurrency}
                  emptyHint="No expected closing dates set yet."
                />
                {global && (
                  <BreakdownCard
                    title="By salesperson"
                    subtitle="Weighted pipeline per rep"
                    buckets={byOwner}
                    currency={dominantCurrency}
                    emptyHint="No owners resolved."
                  />
                )}
                <BreakdownCard
                  title="By country"
                  subtitle="Weighted pipeline by client country"
                  buckets={byCountry}
                  currency={dominantCurrency}
                />
                <BreakdownCard
                  title="By product family"
                  subtitle="Weighted pipeline by dominant family on each deal"
                  buckets={byFamily}
                  currency={dominantCurrency}
                />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ============================================================
   Sub-components
   ============================================================ */

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-neutral-200 bg-neutral-50/50 px-6 py-16 text-center">
      <h2 className="text-sm font-semibold text-neutral-900">
        No active quotations
      </h2>
      <p className="text-xs text-neutral-500 mt-2 max-w-md mx-auto">
        The forecast workspace lists quotations in <b>sent</b> or{" "}
        <b>negotiating</b> status. Once you send a quotation to a client,
        it shows up here ready to forecast.
      </p>
      <Link
        href="/clients"
        className="inline-block mt-4 text-xs text-neutral-700 hover:text-neutral-900 underline underline-offset-2"
      >
        Go to quotations →
      </Link>
    </div>
  );
}

function KpiCard({
  label,
  primary,
  hint,
  accent,
}: {
  label: string;
  primary: string;
  hint?: string;
  accent?: "emerald" | "amber";
}) {
  const accentClass =
    accent === "emerald"
      ? "text-emerald-700"
      : accent === "amber"
      ? "text-amber-700"
      : "text-neutral-900";
  return (
    <div className="panel p-4">
      <div className="eyebrow">{label}</div>
      <div
        className={`mt-2 text-2xl font-semibold tabular-nums leading-tight whitespace-pre-line ${accentClass}`}
      >
        {primary}
      </div>
      {hint && <div className="text-[11px] text-neutral-500 mt-1.5">{hint}</div>}
    </div>
  );
}

function BreakdownCard({
  title,
  subtitle,
  buckets,
  currency,
  emptyHint = "Nothing to show yet.",
}: {
  title: string;
  subtitle: string;
  buckets: ForecastBucket[];
  currency: string;
  emptyHint?: string;
}) {
  const max = Math.max(1, ...buckets.map((b) => b.weighted));
  return (
    <section className="panel p-5">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
          <p className="text-[11px] text-neutral-500 mt-0.5">{subtitle}</p>
        </div>
        <span className="text-[11px] text-neutral-400 tabular-nums">
          {buckets.length} group{buckets.length === 1 ? "" : "s"}
        </span>
      </div>
      {buckets.length === 0 ? (
        <p className="text-xs text-neutral-400 py-4 text-center">{emptyHint}</p>
      ) : (
        <ul className="space-y-2">
          {buckets.map((b) => (
            <li key={b.key}>
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="text-neutral-700 truncate">{b.label}</span>
                <span className="tabular-nums font-medium text-neutral-900 shrink-0">
                  {fmtMoney(b.weighted, currency)}
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-neutral-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-neutral-900"
                  style={{ width: `${Math.max(2, (b.weighted / max) * 100)}%` }}
                />
              </div>
              <div className="flex items-center justify-between mt-0.5">
                <span className="text-[10px] text-neutral-400 tabular-nums">
                  {b.count} deal{b.count === 1 ? "" : "s"}
                </span>
                {b.commit > 0 && (
                  <span className="text-[10px] text-emerald-700 tabular-nums">
                    {fmtMoney(b.commit, currency)} commit
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ============================================================
   Helpers
   ============================================================ */

function pickDominantCurrency(deals: ForecastDeal[]): string {
  const byCur = new Map<string, number>();
  for (const d of deals) {
    byCur.set(d.currency, (byCur.get(d.currency) ?? 0) + d.total);
  }
  let top = "USD";
  let max = -1;
  for (const [cur, val] of byCur) {
    if (val > max) {
      max = val;
      top = cur;
    }
  }
  return top;
}

function formatMoneyMap(m: Map<string, number>): string {
  if (m.size === 0) return "—";
  const keys = Array.from(m.keys()).sort((a, b) => {
    if (a === "USD") return -1;
    if (b === "USD") return 1;
    return a.localeCompare(b);
  });
  return keys
    .map((k) => `${k} ${Math.round(m.get(k) ?? 0).toLocaleString()}`)
    .join("\n");
}
