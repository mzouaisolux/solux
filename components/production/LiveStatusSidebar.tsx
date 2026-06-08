/**
 * Sticky "live status" sidebar (m075).
 *
 * The cockpit. Mirrors the values from `OrderOperationsStrip` in a vertical
 * compact layout that sticks to the viewport as the operator scrolls
 * through delays, payments, shipping, comments etc. — so the project's
 * current state is always visible without scrolling back to the top.
 *
 * Pure presentation. Every value is computed by the page loader and
 * passed in (single source of truth — this card does NOT recompute KPIs).
 * The top operations strip and this sidebar render the SAME data; this
 * card is just the persistent view that survives scroll.
 */

import type { DelayType } from "@/lib/delays";
import { DELAY_TYPE_LABEL } from "@/lib/delays";
import type { ProductionPaymentState } from "@/lib/types";
import type { OperationsShippingState } from "./OrderOperationsStrip";

export type StageTone = "neutral" | "amber" | "rose" | "emerald" | "sky";

export type LiveStatusSidebarProps = {
  initialEta: string | null;
  currentEta: string | null;
  actualCompletion: string | null;
  factoryDelayDays: number;
  externalDelayDays: number;
  latestDelayType: DelayType | null;
  paymentState: ProductionPaymentState | null;
  daysToEta: number | null;
  shipping: OperationsShippingState;
  productionStage: { label: string; tone: StageTone };
};

const DOT: Record<StageTone, string> = {
  neutral: "bg-neutral-300",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  emerald: "bg-emerald-500",
  sky: "bg-sky-500",
};

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
}

function paymentSummary(
  state: ProductionPaymentState | null
): { label: string; tone: StageTone } {
  switch (state) {
    case "paid_in_full":
      return { label: "Paid in full", tone: "emerald" };
    case "no_deposit_required":
      return { label: "No deposit required", tone: "emerald" };
    case "deposit_received":
      return { label: "Deposit received", tone: "sky" };
    case "partial_balance":
      return { label: "Balance pending", tone: "amber" };
    case "awaiting_deposit":
      return { label: "Awaiting deposit", tone: "rose" };
    default:
      return { label: "—", tone: "neutral" };
  }
}

function shippingSummary(
  s: OperationsShippingState
): { label: string; tone: StageTone } {
  switch (s) {
    case "delivered":
      return { label: "Delivered", tone: "emerald" };
    case "shipped":
      return { label: "In transit", tone: "sky" };
    case "booked":
      return { label: "Booked", tone: "sky" };
    case "ready_to_ship":
      return { label: "Waiting booking", tone: "amber" };
    case "cancelled":
      return { label: "Cancelled", tone: "neutral" };
    default:
      return { label: "Not started", tone: "neutral" };
  }
}

/** Premium status dot: green = positive/active, ink = attention, mute = idle. */
const DOT_PREMIUM: Record<StageTone, string> = {
  neutral: "po-dot--mute",
  amber: "po-dot--ink",
  rose: "po-dot--ink",
  emerald: "po-dot--green",
  sky: "po-dot--green",
};

export function LiveStatusSidebar(props: LiveStatusSidebarProps) {
  const {
    initialEta,
    currentEta,
    actualCompletion,
    factoryDelayDays,
    externalDelayDays,
    latestDelayType,
    paymentState,
    daysToEta,
    shipping,
    productionStage,
  } = props;
  const totalDelay = factoryDelayDays + externalDelayDays;
  const payment = paymentSummary(paymentState);
  const shippingState = shippingSummary(shipping);

  return (
    <aside className="sticky top-6 self-start space-y-3">
      <div className="eyebrow px-1">Live status</div>
      <div className="panel overflow-hidden">
        {/* ETA cluster */}
        <div className="p-4 space-y-3">
          <DateRow label="Initial ETA" value={fmt(initialEta)} />
          <DateRow
            label="Current ETA"
            value={fmt(currentEta)}
            sub={
              daysToEta == null
                ? null
                : daysToEta < 0
                ? `${Math.abs(daysToEta)}d past`
                : daysToEta === 0
                ? "Due today"
                : `In ${daysToEta}d`
            }
          />
          {actualCompletion && (
            <DateRow
              label="Actual completion"
              value={fmt(actualCompletion)}
              pos
            />
          )}
        </div>

        {/* Delay breakdown */}
        <div className="px-4 py-3 border-t border-[color:var(--line)] space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="po-rk uppercase tracking-[0.07em]">Total delay</span>
            <span
              className="po-rv"
              style={{ fontSize: "16px" }}
              title={
                latestDelayType
                  ? `Latest event: ${DELAY_TYPE_LABEL[latestDelayType]}`
                  : undefined
              }
            >
              {totalDelay === 0
                ? "On schedule"
                : totalDelay > 0
                ? `+${totalDelay}d`
                : `${totalDelay}d`}
            </span>
          </div>
          {(factoryDelayDays !== 0 || externalDelayDays !== 0) && (
            <div className="grid grid-cols-2 gap-2 pt-1">
              <SubChip
                label="Factory"
                days={factoryDelayDays}
                hazard={factoryDelayDays > 0}
              />
              <SubChip label="External" days={externalDelayDays} />
            </div>
          )}
        </div>

        {/* Operational state */}
        <div className="px-4 py-3 border-t border-[color:var(--line)] space-y-2.5">
          <StateRow label="Payment" value={payment.label} tone={payment.tone} />
          <StateRow
            label="Shipping"
            value={shippingState.label}
            tone={shippingState.tone}
          />
          <StateRow
            label="Production"
            value={productionStage.label}
            tone={productionStage.tone}
          />
        </div>
      </div>
    </aside>
  );
}

function DateRow({
  label,
  value,
  sub,
  pos,
}: {
  label: string;
  value: string;
  sub?: string | null;
  pos?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="po-rk uppercase tracking-[0.07em]">{label}</span>
      <div className="text-right">
        <div
          className="po-rv"
          style={pos ? { color: "var(--green-deep)" } : undefined}
        >
          {value}
        </div>
        {sub && (
          <div className="text-[10px] text-[color:var(--mute)] tabular-nums">
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}

/** Factory / External split chip. Factory with a slip → Hazard treatment. */
function SubChip({
  label,
  days,
  hazard = false,
}: {
  label: string;
  days: number;
  hazard?: boolean;
}) {
  return (
    <div className={`po-subchip ${hazard ? "dark" : ""}`}>
      <div className="sk">{label}</div>
      <div className="sv">
        {days === 0 ? "0d" : days > 0 ? `+${days}d` : `${days}d`}
      </div>
    </div>
  );
}

function StateRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: StageTone;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="po-rk uppercase tracking-[0.07em]">{label}</span>
      <div className="flex items-center gap-2 min-w-0">
        <span className={`po-dot ${DOT_PREMIUM[tone]}`} aria-hidden />
        <span className="text-xs font-medium text-[color:var(--ink)] truncate">
          {value}
        </span>
      </div>
    </div>
  );
}
