import { freshnessLevel, type FreshnessThresholds } from "@/lib/shipping-update";

/**
 * The margin-protection signal: a traffic-light freight-age badge (m149
 * Lot 2). Pure/presentational — pass the age in days and the (admin-tuned)
 * thresholds. `compact` renders just the dot + "58d" for tight list rows;
 * otherwise the full sentence ("Freight quote is 92 days old").
 */
export function ShippingFreshnessBadge({
  ageDays,
  thresholds,
  compact = false,
  className = "",
}: {
  ageDays: number | null;
  thresholds?: FreshnessThresholds;
  compact?: boolean;
  className?: string;
}) {
  const f = freshnessLevel(ageDays, thresholds);
  if (compact) {
    return (
      <span
        className={`inline-flex items-center gap-1 text-[11px] font-medium ${f.tone} ${className}`}
        title={f.label}
      >
        <span aria-hidden>{f.emoji}</span>
        {ageDays == null ? "—" : `${ageDays}d`}
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${f.tone} ${className}`}>
      <span aria-hidden>{f.emoji}</span>
      {f.label}
    </span>
  );
}
