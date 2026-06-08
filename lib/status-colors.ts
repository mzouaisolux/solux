/**
 * Operational status to visual color system.
 *
 * Single source of truth for how each production order status is
 * represented visually across the app:
 *   - status pill (badge with bg + text + border)
 *   - status dot (small colored marker)
 *   - row left-border accent (4px stripe on the left of the row)
 *   - row background tint (very subtle, around 30% opacity)
 *
 * Design rules
 * ------------
 * - Subtle, not flashy. Backgrounds at /30 or /40 opacity, pill
 *   text uses the -800 shade, borders -200 / -300. No saturated
 *   fills, no gradients.
 * - Semantic mapping. Awaiting > amber, deposit > sky, production >
 *   violet, completion > emerald, shipping > teal / emerald-dark,
 *   delivered > neutral, cancelled > rose.
 * - Archived overrides everything. A row marked archived_at IS NOT
 *   NULL reads as neutral gray regardless of its status (archived =
 *   operationally muted).
 *
 * Tailwind JIT note
 * -----------------
 * Class strings only work if Tailwind sees them at build time. The
 * tailwind.config.ts content paths now include lib (all .ts/.tsx
 * files) so the JIT picks up the class names declared here. Without
 * that path the colors would fall back to unstyled defaults.
 */

import type { ProductionOrderStatus } from "@/lib/types";

export type StatusColor = {
  /** Small colored dot used in inline status badges. */
  dot: string;
  /** Left-border class for the 4px row accent stripe. */
  leftBorder: string;
  /** Row background tint — designed to be very subtle. */
  rowBg: string;
  /** Combined pill class (bg + text + border) for status badges. */
  pill: string;
};

/**
 * Canonical color map per production order status.
 *
 * Keep all class strings spelled out literally — Tailwind JIT can't
 * resolve dynamically-constructed class names (e.g. bg-COLOR-50 built
 * from a variable). Always write the full class name.
 */
export const PO_STATUS_COLORS: Record<ProductionOrderStatus, StatusColor> = {
  // Awaiting deposit — amber. Subtle attention-grabber for "money owed".
  awaiting_deposit: {
    dot: "bg-amber-500",
    leftBorder: "border-l-amber-400",
    rowBg: "",
    pill: "bg-amber-50 text-amber-800 border-amber-200",
  },
  // Deposit received — sky blue. Cleared the financial gate, production
  // can start.
  deposit_received: {
    dot: "bg-sky-500",
    leftBorder: "border-l-sky-400",
    rowBg: "",
    pill: "bg-sky-50 text-sky-800 border-sky-200",
  },
  // Production scheduled — indigo. Calendar/planning vibe.
  production_scheduled: {
    dot: "bg-indigo-500",
    leftBorder: "border-l-indigo-400",
    rowBg: "",
    pill: "bg-indigo-50 text-indigo-800 border-indigo-200",
  },
  // In production — violet. Active work in flight.
  in_production: {
    dot: "bg-violet-500",
    leftBorder: "border-l-violet-400",
    rowBg: "",
    pill: "bg-violet-50 text-violet-800 border-violet-200",
  },
  // Production delayed — orange. Stronger than amber, softer than red —
  // signals "we're behind schedule" without screaming emergency.
  production_delayed: {
    dot: "bg-orange-500",
    leftBorder: "border-l-orange-500",
    rowBg: "bg-orange-50/20",
    pill: "bg-orange-50 text-orange-800 border-orange-300",
  },
  // Production completed — emerald. Success signal.
  production_completed: {
    dot: "bg-emerald-500",
    leftBorder: "border-l-emerald-400",
    rowBg: "",
    pill: "bg-emerald-50 text-emerald-800 border-emerald-200",
  },
  // Shipment booked — teal. Logistic-y "in transit" feel.
  shipment_booked: {
    dot: "bg-teal-500",
    leftBorder: "border-l-teal-400",
    rowBg: "",
    pill: "bg-teal-50 text-teal-800 border-teal-200",
  },
  // Shipped — darker emerald. Stronger green for "actively moving".
  shipped: {
    dot: "bg-emerald-700",
    leftBorder: "border-l-emerald-600",
    rowBg: "",
    pill: "bg-emerald-100 text-emerald-900 border-emerald-300",
  },
  // Delivered — neutral. Operationally closed, no action needed. Use
  // gray to communicate "done, archive-eligible".
  delivered: {
    dot: "bg-neutral-500",
    leftBorder: "border-l-neutral-300",
    rowBg: "",
    pill: "bg-neutral-100 text-neutral-700 border-neutral-300",
  },
  // Cancelled — soft rose. NOT alarming red — the deal is dead, not
  // on fire. The cancellation banner on the detail page carries the
  // strong critical signal; in lists, this is a quiet "ignore me".
  cancelled: {
    dot: "bg-rose-400",
    leftBorder: "border-l-rose-300",
    rowBg: "",
    pill: "bg-rose-50 text-rose-700 border-rose-200",
  },
};

/**
 * Visual treatment for archived rows. Applies regardless of status —
 * archived takes priority because it means "operationally muted".
 * The dimming on the row is achieved by opacity at the caller site
 * (e.g. opacity-60), not via background tint.
 */
export const ARCHIVED_COLORS: StatusColor = {
  dot: "bg-neutral-400",
  leftBorder: "border-l-neutral-200",
  rowBg: "",
  pill: "bg-neutral-100 text-neutral-600 border-neutral-200",
};

/**
 * Resolve the color treatment for a row.
 *
 * Archived state wins over status — a cancelled-but-archived row reads
 * as gray, not rose. Use this in every list that renders POs.
 */
export function poStatusColors(
  status: ProductionOrderStatus,
  archived?: boolean | null
): StatusColor {
  if (archived) return ARCHIVED_COLORS;
  return PO_STATUS_COLORS[status];
}
