import {
  PRODUCTION_ORDER_STATUS_LABEL,
  PRODUCTION_PAYMENT_STATE_LABEL,
  type ProductionOrderStatus,
  type ProductionPaymentState,
} from "@/lib/types";
import { poStatusColors } from "@/lib/status-colors";

/**
 * Compact status pill — now backed by the centralized color system
 * (lib/status-colors.ts) so it reads consistently across the app
 * (PO detail, follow-up table, operations, dashboard).
 */
export function ProductionOrderStatusBadge({
  status,
  size = "sm",
  archived = false,
}: {
  status: ProductionOrderStatus;
  size?: "sm" | "md";
  /** When true, overrides status color with the neutral "archived" treatment. */
  archived?: boolean;
}) {
  const padding =
    size === "md" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-[11px]";
  const colors = poStatusColors(status, archived);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium ${colors.pill} ${padding}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${colors.dot}`} />
      {PRODUCTION_ORDER_STATUS_LABEL[status]}
      {archived && (
        <span className="text-[9px] uppercase tracking-widerx opacity-70">
          · archived
        </span>
      )}
    </span>
  );
}

/**
 * Compact "+7 days" / "On time" indicator. Red on delay, neutral on time,
 * green when pulled forward (rare).
 */
export function DelayBadge({
  delayDays,
  short = false,
}: {
  delayDays: number | null;
  short?: boolean;
}) {
  if (delayDays === null) {
    return (
      <span className="inline-flex items-center text-[11px] text-neutral-400">
        —
      </span>
    );
  }
  if (delayDays === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
        ● On time
      </span>
    );
  }
  if (delayDays > 0) {
    const danger = delayDays >= 7;
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
          danger
            ? "bg-red-50 border-red-200 text-red-700"
            : "bg-amber-50 border-amber-200 text-amber-800"
        }`}
        title={`Original deadline pushed back by ${delayDays} day${
          delayDays === 1 ? "" : "s"
        }`}
      >
        ▲ +{delayDays}
        {short ? "d" : ` day${delayDays === 1 ? "" : "s"}`}
      </span>
    );
  }
  // Pulled forward (negative delay)
  const days = Math.abs(delayDays);
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-sky-50 border border-sky-200 px-2 py-0.5 text-[11px] font-medium text-sky-700"
      title={`Original deadline pulled forward by ${days} day${
        days === 1 ? "" : "s"
      }`}
    >
      ▼ −{days}
      {short ? "d" : ` day${days === 1 ? "" : "s"}`}
    </span>
  );
}

/** Compact pill for the computed payment state on a production order. */
const PAYMENT_STATE_STYLES: Record<
  ProductionPaymentState,
  { bg: string; text: string; border: string; dot: string }
> = {
  no_terms: {
    bg: "bg-neutral-50",
    text: "text-neutral-500",
    border: "border-neutral-200",
    dot: "bg-neutral-300",
  },
  awaiting_deposit: {
    bg: "bg-amber-50",
    text: "text-amber-800",
    border: "border-amber-200",
    dot: "bg-amber-500",
  },
  deposit_received: {
    bg: "bg-sky-50",
    text: "text-sky-800",
    border: "border-sky-200",
    dot: "bg-sky-500",
  },
  partial_balance: {
    bg: "bg-indigo-50",
    text: "text-indigo-800",
    border: "border-indigo-200",
    dot: "bg-indigo-500",
  },
  paid_in_full: {
    bg: "bg-emerald-50",
    text: "text-emerald-800",
    border: "border-emerald-200",
    dot: "bg-emerald-500",
  },
  no_deposit_required: {
    bg: "bg-neutral-50",
    text: "text-neutral-700",
    border: "border-neutral-200",
    dot: "bg-neutral-400",
  },
};

export function PaymentStatusBadge({
  state,
}: {
  state: ProductionPaymentState;
}) {
  const s = PAYMENT_STATE_STYLES[state];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border ${s.border} ${s.bg} ${s.text} px-2 py-0.5 text-[11px] font-medium`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {PRODUCTION_PAYMENT_STATE_LABEL[state]}
    </span>
  );
}
