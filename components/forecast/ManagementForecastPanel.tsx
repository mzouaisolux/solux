import Link from "next/link";
import { loadForecastDeals, resolveOwnerLabels } from "@/lib/forecast-data";
import {
  computeForecastTotals,
  forecastByOwner,
  forecastByCountry,
  forecastByFamily,
  weightedValue,
  closesThisQuarter,
  currentQuarterKey,
  quarterLabel,
  fmtMoney,
  type ForecastBucket,
} from "@/lib/forecast";

/**
 * ManagementForecastPanel — executive forecast block for the dashboard.
 *
 * Admin / Super Admin only (mounted conditionally by the dashboard).
 * Company-wide by default; if a sales filter is applied, `scopedUserId`
 * narrows it to that rep.
 *
 * Self-loading async server component — the dashboard just mounts it.
 * Renders nothing when there are no forecasted deals (quiet on a fresh
 * book). Reads like an exec summary: four headline numbers + three
 * compact "where is it" breakdowns. Not an analytics console.
 */
export async function ManagementForecastPanel({
  scopedUserId,
}: {
  scopedUserId: string | null;
}) {
  const deals = await loadForecastDeals(scopedUserId);
  if (deals.length === 0) return null;

  const ownerLabels = await resolveOwnerLabels(
    deals.map((d) => d.ownerId ?? "").filter(Boolean)
  );

  const totals = computeForecastTotals(deals);

  // Headline figures, bucketed per currency (mixed export books).
  const weightedByCur = new Map<string, number>();
  const commitByCur = new Map<string, number>();
  const quarterByCur = new Map<string, number>();
  for (const d of deals) {
    weightedByCur.set(
      d.currency,
      (weightedByCur.get(d.currency) ?? 0) + weightedValue(d.total, d.probability)
    );
    if (d.category === "commit") {
      commitByCur.set(d.currency, (commitByCur.get(d.currency) ?? 0) + d.total);
    }
    if (closesThisQuarter(d.expectedCloseDate)) {
      quarterByCur.set(
        d.currency,
        (quarterByCur.get(d.currency) ?? 0) + weightedValue(d.total, d.probability)
      );
    }
  }

  const byOwner = forecastByOwner(deals, ownerLabels).slice(0, 5);
  const byCountry = forecastByCountry(deals).slice(0, 5);
  const byFamily = forecastByFamily(deals).slice(0, 5);
  const dominantCurrency = pickDominant(weightedByCur);
  const thisQuarter = quarterLabel(currentQuarterKey());

  return (
    <section className="panel p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <div className="eyebrow">Commercial forecast</div>
          <p className="text-[11px] text-neutral-500 mt-0.5">
            Company-wide weighted pipeline from active quotations
          </p>
        </div>
        <Link
          href="/forecast"
          className="text-[11px] text-neutral-600 hover:text-neutral-900 underline underline-offset-2 shrink-0"
        >
          Open workspace →
        </Link>
      </div>

      {/* Headline numbers */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Metric
          label="Weighted pipeline"
          value={formatMoneyMap(weightedByCur)}
          accent="emerald"
        />
        <Metric
          label="Commit"
          value={commitByCur.size > 0 ? formatMoneyMap(commitByCur) : "—"}
        />
        <Metric
          label={`Closing ${thisQuarter}`}
          value={quarterByCur.size > 0 ? formatMoneyMap(quarterByCur) : "—"}
        />
        <Metric
          label="Outdated"
          value={String(totals.staleCount)}
          accent={totals.staleCount > 0 ? "amber" : undefined}
          hint={`${totals.count} forecasted deal${totals.count === 1 ? "" : "s"}`}
        />
      </div>

      {/* Compact breakdowns */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <MiniBreakdown
          title="By salesperson"
          buckets={byOwner}
          currency={dominantCurrency}
        />
        <MiniBreakdown
          title="By country"
          buckets={byCountry}
          currency={dominantCurrency}
        />
        <MiniBreakdown
          title="By product family"
          buckets={byFamily}
          currency={dominantCurrency}
        />
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  accent,
  hint,
}: {
  label: string;
  value: string;
  accent?: "emerald" | "amber";
  hint?: string;
}) {
  const color =
    accent === "emerald"
      ? "text-emerald-700"
      : accent === "amber"
      ? "text-amber-700"
      : "text-neutral-900";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-medium">
        {label}
      </div>
      <div
        className={`mt-1 text-xl font-semibold tabular-nums leading-tight whitespace-pre-line ${color}`}
      >
        {value}
      </div>
      {hint && <div className="text-[10px] text-neutral-400 mt-0.5">{hint}</div>}
    </div>
  );
}

function MiniBreakdown({
  title,
  buckets,
  currency,
}: {
  title: string;
  buckets: ForecastBucket[];
  currency: string;
}) {
  const max = Math.max(1, ...buckets.map((b) => b.weighted));
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-medium mb-2">
        {title}
      </div>
      {buckets.length === 0 ? (
        <p className="text-[11px] text-neutral-400">No data</p>
      ) : (
        <ul className="space-y-1.5">
          {buckets.map((b) => (
            <li key={b.key}>
              <div className="flex items-baseline justify-between gap-2 text-[11px]">
                <span className="text-neutral-700 truncate">{b.label}</span>
                <span className="tabular-nums text-neutral-900 shrink-0">
                  {fmtMoney(b.weighted, currency)}
                </span>
              </div>
              <div className="mt-0.5 h-1 rounded-full bg-neutral-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-neutral-800"
                  style={{ width: `${Math.max(3, (b.weighted / max) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function pickDominant(m: Map<string, number>): string {
  let top = "USD";
  let max = -Infinity;
  for (const [cur, val] of m) {
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
