import { computeFreightStatus, type FreightValidityStatus } from "@/lib/freight-validity";

const STYLES: Record<FreightValidityStatus, string> = {
  valid: "bg-emerald-50 text-emerald-700 border-emerald-200",
  expiring_soon: "bg-amber-50 text-amber-800 border-amber-300",
  expired: "bg-rose-50 text-rose-700 border-rose-300",
  none: "bg-neutral-100 text-neutral-500 border-neutral-200",
};
const ICONS: Record<FreightValidityStatus, string> = {
  valid: "✓",
  expiring_soon: "⚠",
  expired: "✗",
  none: "—",
};

/**
 * Freight validity badge (m098). Green = valid, orange = expiring soon (<7d),
 * red = expired (with "expired X days ago"). Renders null when no validity set.
 * Pass `today` as a YYYY-MM-DD string (server "now") so it stays deterministic.
 */
export function FreightStatusBadge({
  validUntil,
  today,
  className = "",
}: {
  validUntil: string | null;
  today: string;
  className?: string;
}) {
  const s = computeFreightStatus(validUntil, today);
  if (s.status === "none") return null;
  const text =
    s.status === "valid"
      ? `Freight valid${validUntil ? ` · until ${validUntil}` : ""}`
      : s.label; // expiring_soon / expired carry their own phrasing
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${STYLES[s.status]} ${className}`}
      title={validUntil ? `Valid until ${validUntil}` : undefined}
    >
      <span aria-hidden>{ICONS[s.status]}</span>
      <span>{text}</span>
    </span>
  );
}
