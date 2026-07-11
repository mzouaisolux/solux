import { freshnessLevel, type FreshnessThresholds } from "@/lib/shipping-update";

/** Solux DNA status dot (premium.css `.sx-dot-*`) — replaces the traffic-light
 *  emoji on premium surfaces. Charte tones only: fresh = Flash Green,
 *  warn = amber, stale = ink (strongest signal), unknown = mute. */
const DOT_CLASS: Record<string, string> = {
  fresh: "sx-dot-green",
  warn: "sx-dot-amber",
  stale: "sx-dot-ink",
  unknown: "sx-dot-mute",
};

export function FreshnessDot({ level }: { level: string }) {
  return <span className={DOT_CLASS[level] ?? "sx-dot-mute"} aria-hidden />;
}

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
        <FreshnessDot level={f.level} />
        {ageDays == null ? "—" : `${ageDays}d`}
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${f.tone} ${className}`}>
      <FreshnessDot level={f.level} />
      {f.label}
    </span>
  );
}
