import Sparkline from "./Sparkline";

/**
 * Premium SaaS KPI card.
 *
 * Standard variant: white surface, neutral text, green/red trend indicator,
 * monochrome sparkline.
 *
 * Featured variant: dark surface (solux-ink), white text, green accents.
 * Use for the most important metric on the page (e.g. revenue) — one per
 * row, max two for emphasis.
 */
export default function KpiCard({
  label,
  value,
  change,
  changeUnit = "%",
  sparkline,
  featured = false,
}: {
  label: string;
  /** Pre-formatted big number — "$1.84M", "34.2%", "42". */
  value: string;
  /** % change vs previous period — positive = up arrow + green. */
  change?: number | null;
  /** Unit suffix on the change indicator ("%" or " pts"). */
  changeUnit?: string;
  /** Historical series for the mini-chart. */
  sparkline?: number[];
  featured?: boolean;
}) {
  // ---- Color logic ----
  // Featured cards: white text on dark background, green sparkline.
  // Standard cards: neutral on white, dark sparkline.
  // Trend indicator: green for positive, red for negative, neutral for zero.
  const labelClass = featured
    ? "text-[10px] uppercase tracking-widerx font-semibold text-neutral-400"
    : "text-[10px] uppercase tracking-widerx font-semibold text-neutral-500";
  const valueClass = featured
    ? "text-3xl font-bold tabular-nums tracking-tight text-white"
    : "text-3xl font-bold tabular-nums tracking-tight text-neutral-900";
  const sparkColor = featured ? "#22c55e" : "#0b0f19";

  // Trend indicator
  let trendIcon: string | null = null;
  let trendClass = "";
  if (change != null && Number.isFinite(change)) {
    const isUp = change > 0;
    const isDown = change < 0;
    if (isUp) {
      trendIcon = "↗";
      trendClass = featured ? "text-emerald-400" : "text-emerald-600";
    } else if (isDown) {
      trendIcon = "↘";
      trendClass = featured ? "text-red-400" : "text-red-600";
    } else {
      trendIcon = "→";
      trendClass = featured ? "text-neutral-500" : "text-neutral-400";
    }
  }

  return (
    <div
      className={`rounded-xl border p-4 transition-all duration-150 shadow-soft hover:shadow-card-hover ${
        featured
          ? "border-neutral-900 bg-neutral-900 text-white"
          : "border-neutral-200/80 bg-white"
      }`}
    >
      <div className={labelClass}>{label}</div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div>
          <div className={valueClass}>{value}</div>
          {change != null && Number.isFinite(change) && (
            <div className={`text-[11px] font-semibold mt-1 ${trendClass}`}>
              <span className="mr-1">{trendIcon}</span>
              {change > 0 ? "+" : ""}
              {change.toFixed(1)}
              {changeUnit}
            </div>
          )}
        </div>
        {sparkline && sparkline.length > 1 && (
          <div className="opacity-90">
            <Sparkline
              values={sparkline}
              width={86}
              height={32}
              stroke={sparkColor}
              strokeWidth={1.5}
            />
          </div>
        )}
      </div>
    </div>
  );
}
