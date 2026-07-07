/**
 * Shipping Rate Refresh (m149) — pure helpers shared by the request modal,
 * the Operations queue and the document history card. No server imports so
 * client components can use everything here.
 */

import type { DocumentContainer } from "@/lib/types";

/** The editable "Shipping Summary" the sales rep confirms in the modal. */
export type ShippingSnapshot = {
  customer?: string;
  project?: string;
  destination_country?: string;
  destination_port?: string;
  port_of_loading?: string;
  incoterm?: string;
  shipping_method?: string;
  container_type?: string;
  containers_count?: string;
  estimated_volume?: string;
  product_family?: string;
};

/** Ordered field list — single source for the modal AND the ops detail. */
export const SNAPSHOT_FIELDS: { key: keyof ShippingSnapshot; label: string }[] = [
  { key: "customer", label: "Customer" },
  { key: "project", label: "Project" },
  { key: "destination_country", label: "Destination country" },
  { key: "destination_port", label: "Destination port" },
  { key: "port_of_loading", label: "Port of loading" },
  { key: "incoterm", label: "Incoterm" },
  { key: "shipping_method", label: "Shipping method" },
  { key: "container_type", label: "Container type" },
  { key: "containers_count", label: "Number of containers" },
  { key: "estimated_volume", label: "Estimated volume" },
  { key: "product_family", label: "Product family" },
];

/** Reason suggestions offered by the modal (free text stays possible). */
export const UPDATE_REASONS = [
  "Client requested updated quotation",
  "Shipping delay",
  "Port changed",
  "New quantities",
  "Cost verification",
] as const;

export type ShippingUpdateStatus =
  | "waiting"
  | "in_progress"
  | "completed"
  | "cancelled";

export const SHIPPING_UPDATE_STATUS_LABEL: Record<ShippingUpdateStatus, string> = {
  waiting: "Waiting",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export type ShippingUpdatePriority = "low" | "normal" | "high";

export const SHIPPING_UPDATE_PRIORITY_LABEL: Record<ShippingUpdatePriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
};

/** Coerce unknown JSONB into a clean snapshot (trimmed strings only). */
export function normalizeSnapshot(raw: unknown): ShippingSnapshot {
  if (!raw || typeof raw !== "object") return {};
  const out: ShippingSnapshot = {};
  for (const { key } of SNAPSHOT_FIELDS) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v === "string" && v.trim()) out[key] = v.trim();
    else if (typeof v === "number" && Number.isFinite(v)) out[key] = String(v);
  }
  return out;
}

/** Summarize a document's containers ("2× 40ft HC + 1× LCL") for prefill. */
export function containerSummary(containers: DocumentContainer[]): {
  container_type: string;
  containers_count: string;
} {
  const byType = new Map<string, number>();
  for (const c of containers ?? []) {
    const t = String(c.container_type ?? "").trim();
    const q = Number(c.quantity) || 0;
    if (!t || q <= 0) continue;
    byType.set(t, (byType.get(t) ?? 0) + q);
  }
  const parts = Array.from(byType.entries()).map(([t, q]) => `${q}× ${t}`);
  const total = Array.from(byType.values()).reduce((s, q) => s + q, 0);
  return {
    container_type: parts.join(" + "),
    containers_count: total ? String(total) : "",
  };
}

/**
 * Old → new delta. Freight and insurance compare independently; `total`
 * is the combined transport movement (what the margin actually feels).
 */
export function shippingDelta(req: {
  previous_freight_cost?: number | null;
  previous_insurance_cost?: number | null;
  new_freight_cost?: number | null;
  new_insurance_cost?: number | null;
}): { freight: number | null; insurance: number | null; total: number | null } {
  const d = (oldV?: number | null, newV?: number | null): number | null =>
    oldV == null || newV == null ? null : Number(newV) - Number(oldV);
  const freight = d(req.previous_freight_cost, req.new_freight_cost);
  const insurance = d(req.previous_insurance_cost, req.new_insurance_cost);
  const total =
    freight == null && insurance == null
      ? null
      : (freight ?? 0) + (insurance ?? 0);
  return { freight, insurance, total };
}

/** "+340.00" / "−120.00" / "0.00" — signed money delta for display. */
export function formatDelta(n: number | null): string {
  if (n == null) return "—";
  const abs = Math.abs(n).toFixed(2);
  if (n > 0) return `+${abs}`;
  if (n < 0) return `−${abs}`;
  return abs;
}

/** Age in whole days between an ISO date and now (null when unknown). */
export function quoteAgeDays(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
}

/* ===========================================================================
   Freight freshness — the margin-protection signal (m149 Lot 2)
   ===========================================================================
   A freight quote silently ages while a project runs for months; shipping to
   Africa can move a lot in that window. The badge turns that invisible risk
   into a colour the salesperson can't miss, wherever a document is shown.
   Thresholds are admin-tunable (app_settings) — NEVER hardcoded at a call
   site; callers pass the resolved config in. */

export type FreshnessThresholds = {
  /** Age (days) at which the quote turns amber ("getting old"). */
  warnDays: number;
  /** Age (days) at which the quote turns red ("likely outdated"). */
  criticalDays: number;
};

export const FRESHNESS_WARN_DAYS_KEY = "shipping.freshness_warn_days";
export const FRESHNESS_CRITICAL_DAYS_KEY = "shipping.freshness_critical_days";
export const FRESHNESS_DEFAULTS: FreshnessThresholds = {
  warnDays: 30,
  criticalDays: 90,
};

export type FreshnessLevel = "fresh" | "warn" | "stale" | "unknown";

export type Freshness = {
  level: FreshnessLevel;
  /** Traffic-light emoji for compact surfaces (🟢 🟡 🔴 ⚪). */
  emoji: string;
  /** Tailwind text tone for the dot / label. */
  tone: string;
  /** Human sentence, e.g. "Freight quote is 92 days old". */
  label: string;
};

/**
 * Classify a freight quote's age against the thresholds. `ageDays === null`
 * (no known quote date) is an honest "unknown", not a false green.
 */
export function freshnessLevel(
  ageDays: number | null,
  thresholds: FreshnessThresholds = FRESHNESS_DEFAULTS
): Freshness {
  const warn = Math.max(1, thresholds.warnDays);
  const critical = Math.max(warn + 1, thresholds.criticalDays);
  if (ageDays == null) {
    return {
      level: "unknown",
      emoji: "⚪",
      tone: "text-neutral-400",
      label: "No freight quote date on file",
    };
  }
  const aged = `Freight quote is ${ageDays} day${ageDays === 1 ? "" : "s"} old`;
  if (ageDays >= critical) {
    return { level: "stale", emoji: "🔴", tone: "text-rose-700", label: aged };
  }
  if (ageDays >= warn) {
    return { level: "warn", emoji: "🟡", tone: "text-amber-700", label: aged };
  }
  return {
    level: "fresh",
    emoji: "🟢",
    tone: "text-emerald-700",
    label: `Updated ${ageDays} day${ageDays === 1 ? "" : "s"} ago`,
  };
}
