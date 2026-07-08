import Link from "next/link";
import { loadForecastDeals } from "@/lib/forecast-data";
import {
  computeForecastTotals,
  weightedValue,
  fmtMoney,
} from "@/lib/forecast";

/**
 * Compact forecast strip for the dashboard.
 *
 * Self-loading async server component — the host page just mounts
 * `<ForecastStrip scopedUserId={global ? null : userId} />` and this
 * fetches + aggregates its own slice. Keeps the (already large)
 * dashboard page untouched beyond a one-line mount.
 *
 * Renders nothing when there are no forecasted deals (no empty noise
 * on a fresh account). Three quick numbers + a link into /forecast
 * for the full command center.
 */
export async function ForecastStrip({
  scopedUserId,
}: {
  scopedUserId: string | null;
}) {
  const deals = await loadForecastDeals(scopedUserId);
  if (deals.length === 0) return null;

  const totals = computeForecastTotals(deals);

  // Headline weighted figure per currency (compact — show the dominant
  // currency line; the full page breaks it out properly). "Near close"
  // = full value of deals at 90%+ (the old Commit bucket is gone —
  // probability is the only dial now).
  const weightedByCur = new Map<string, number>();
  const nearCloseByCur = new Map<string, number>();
  for (const d of deals) {
    weightedByCur.set(
      d.currency,
      (weightedByCur.get(d.currency) ?? 0) + weightedValue(d.total, d.probability)
    );
    if (d.probability != null && d.probability >= 90) {
      nearCloseByCur.set(
        d.currency,
        (nearCloseByCur.get(d.currency) ?? 0) + d.total
      );
    }
  }
  const weightedStr = formatTopCurrency(weightedByCur);
  const nearCloseStr =
    nearCloseByCur.size > 0 ? formatTopCurrency(nearCloseByCur) : "—";

  return (
    <section className="panel p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <div className="eyebrow">Forecast</div>
          <p className="text-[11px] text-neutral-500 mt-0.5">
            Weighted pipeline from active quotations
          </p>
        </div>
        <Link
          href="/forecast"
          className="text-[11px] text-neutral-600 hover:text-neutral-900 underline underline-offset-2 shrink-0"
        >
          Open forecast →
        </Link>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Metric label="Weighted" value={weightedStr} accent="emerald" />
        <Metric label="At 90%+" value={nearCloseStr} />
        <Metric
          label="Outdated"
          value={String(totals.staleCount)}
          accent={totals.staleCount > 0 ? "amber" : undefined}
          hint={`${totals.count} deal${totals.count === 1 ? "" : "s"}`}
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
      <div className={`mt-1 text-lg font-semibold tabular-nums leading-tight ${color}`}>
        {value}
      </div>
      {hint && <div className="text-[10px] text-neutral-400 mt-0.5">{hint}</div>}
    </div>
  );
}

/** Show the single biggest-currency figure compactly ("USD 47,200").
 *  The dashboard strip stays terse; /forecast shows the full per-
 *  currency breakdown. */
function formatTopCurrency(m: Map<string, number>): string {
  if (m.size === 0) return "—";
  let topCur = "USD";
  let max = -Infinity;
  for (const [cur, val] of m) {
    if (val > max) {
      max = val;
      topCur = cur;
    }
  }
  return fmtMoney(max, topCur);
}
