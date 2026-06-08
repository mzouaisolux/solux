/**
 * Top operational summary for the Production Order page (m072).
 *
 * Five cards, sized for instant read at a glance:
 *
 *   INITIAL ETA · CURRENT ETA · DELAY · PAYMENT STATUS · SHIPPING STATUS
 *
 * The DELAY card shows the FACTORY / EXTERNAL split with distinct colors
 * (rose for factory — counts toward factory KPI; amber for external —
 * does not). This is the single most operationally important card on
 * the page: at a glance, anyone can tell who is responsible for the
 * current ETA being later than the baseline.
 *
 * Pure presentation — every value is computed by the page loader and
 * passed in. No DB calls here.
 */

import type { DelayType } from "@/lib/delays";
import { DELAY_TYPE_LABEL } from "@/lib/delays";
import type { ProductionPaymentState } from "@/lib/types";

export type OperationsShippingState =
  | "not_started"
  | "ready_to_ship"
  | "booked"
  | "shipped"
  | "delivered"
  | "cancelled";

export type OrderOperationsStripProps = {
  initialEta: string | null;
  currentEta: string | null;
  /** Day-deltas attributed to the factory (red KPI). */
  factoryDelayDays: number;
  /** Day-deltas attributed to external causes (amber, non-KPI). */
  externalDelayDays: number;
  /** Latest delay-type — drives the secondary label on the DELAY card. */
  latestDelayType: DelayType | null;
  /** Payment state from computeProductionPaymentState. */
  paymentState: ProductionPaymentState | null;
  /** Outstanding balance (when relevant). */
  balanceRemaining?: number | null;
  /** Currency for display. */
  currency?: string | null;
  /** Days until ETA — drives "Due in Nd" hint on the payment card. */
  daysToEta?: number | null;
  /** Shipping execution state — derived from production_status. */
  shipping: OperationsShippingState;
};

/** Compact "Wed Jul 08 2026" for the top strip. */
function fmtLongDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
}

function fmtMoney(v: number | null | undefined, c: string | null | undefined) {
  if (v == null) return null;
  const cur = (c ?? "USD") as string;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: cur,
      maximumFractionDigits: 0,
    }).format(v);
  } catch {
    return `${cur} ${Math.round(v).toLocaleString()}`;
  }
}

export function OrderOperationsStrip({
  initialEta,
  currentEta,
  factoryDelayDays,
  externalDelayDays,
  latestDelayType,
  paymentState,
  balanceRemaining,
  currency,
  daysToEta,
  shipping,
}: OrderOperationsStripProps) {
  const totalDelay = factoryDelayDays + externalDelayDays;
  return (
    <section className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      <Card label="Initial ETA" tone="neutral">
        <div className="text-base font-semibold text-neutral-900 tabular-nums">
          {fmtLongDate(initialEta)}
        </div>
        <div className="text-[11px] text-neutral-500 mt-0.5">
          Baseline · locked at activation
        </div>
      </Card>

      <Card label="Current ETA" tone="neutral">
        <div className="text-base font-semibold text-neutral-900 tabular-nums">
          {fmtLongDate(currentEta)}
        </div>
        <div className="text-[11px] text-neutral-500 mt-0.5">
          {daysToEta == null
            ? "—"
            : daysToEta < 0
            ? `${Math.abs(daysToEta)}d past`
            : daysToEta === 0
            ? "Due today"
            : `In ${daysToEta}d`}
        </div>
      </Card>

      <DelayCard
        factoryDays={factoryDelayDays}
        externalDays={externalDelayDays}
        latestType={latestDelayType}
        totalDays={totalDelay}
      />

      <PaymentCard
        state={paymentState}
        balanceRemaining={balanceRemaining}
        currency={currency}
        daysToEta={daysToEta}
      />

      <ShippingCard state={shipping} />
    </section>
  );
}

function Card({
  label,
  tone,
  children,
}: {
  label: string;
  tone: "neutral" | "rose" | "amber" | "emerald" | "sky";
  children: React.ReactNode;
}) {
  const ring: Record<typeof tone, string> = {
    neutral: "border-neutral-200 bg-white",
    rose: "border-rose-300 bg-rose-50/50",
    amber: "border-amber-300 bg-amber-50/50",
    emerald: "border-emerald-300 bg-emerald-50/50",
    sky: "border-sky-300 bg-sky-50/50",
  };
  return (
    <div className={`rounded-xl border ${ring[tone]} p-3.5`}>
      <div className="text-[10px] font-bold uppercase tracking-widerx text-neutral-500 mb-1">
        {label}
      </div>
      {children}
    </div>
  );
}

/** The most important card: distinguishes factory vs external responsibility. */
function DelayCard({
  factoryDays,
  externalDays,
  latestType,
  totalDays,
}: {
  factoryDays: number;
  externalDays: number;
  latestType: DelayType | null;
  totalDays: number;
}) {
  // No slip at all → calm green.
  if (totalDays <= 0) {
    return (
      <Card label="Delay" tone="emerald">
        <div className="text-base font-semibold text-emerald-900 tabular-nums">
          On schedule
        </div>
        <div className="text-[11px] text-emerald-700/80 mt-0.5">
          No deadline shift recorded.
        </div>
      </Card>
    );
  }
  // Mixed: show the dominant axis at the top, the other axis as a sub-line.
  const factoryDominant = factoryDays >= externalDays;
  if (factoryDominant && factoryDays > 0) {
    return (
      <Card label="Delay" tone="rose">
        <div className="text-base font-semibold text-rose-900 tabular-nums">
          +{factoryDays}d <span className="text-[12px] font-medium">Factory</span>
        </div>
        <div className="text-[11px] text-rose-800/80 mt-0.5">
          {externalDays > 0
            ? `+${externalDays}d external · `
            : ""}
          counts toward factory KPI
        </div>
      </Card>
    );
  }
  // External-only or external-dominant slip → amber, NOT factory-attributable.
  return (
    <Card label="Delay" tone="amber">
      <div className="text-base font-semibold text-amber-900 tabular-nums">
        +{externalDays}d{" "}
        <span className="text-[12px] font-medium">
          {latestType && latestType !== "production"
            ? DELAY_TYPE_LABEL[latestType].replace(" delay", "")
            : "External"}
        </span>
      </div>
      <div className="text-[11px] text-amber-800/80 mt-0.5">
        {factoryDays > 0
          ? `+${factoryDays}d factory · `
          : ""}
        does not affect factory KPI
      </div>
    </Card>
  );
}

function PaymentCard({
  state,
  balanceRemaining,
  currency,
  daysToEta,
}: {
  state: ProductionPaymentState | null;
  balanceRemaining: number | null | undefined;
  currency: string | null | undefined;
  daysToEta: number | null | undefined;
}) {
  if (state === "paid_in_full" || state === "no_deposit_required") {
    return (
      <Card label="Payment" tone="emerald">
        <div className="text-base font-semibold text-emerald-900">
          {state === "paid_in_full" ? "Paid in full" : "No deposit required"}
        </div>
        <div className="text-[11px] text-emerald-700/80 mt-0.5">
          {state === "paid_in_full"
            ? "Balance settled."
            : "Cash-on-receipt terms."}
        </div>
      </Card>
    );
  }
  if (state === "awaiting_deposit") {
    return (
      <Card label="Payment" tone="rose">
        <div className="text-base font-semibold text-rose-900">
          Awaiting deposit
        </div>
        <div className="text-[11px] text-rose-800/80 mt-0.5">
          Production gated on the deposit.
        </div>
      </Card>
    );
  }
  // Partial / deposit received → show balance remaining.
  const money = fmtMoney(balanceRemaining ?? null, currency);
  const tone =
    daysToEta != null && daysToEta <= 7 ? "amber" : ("neutral" as const);
  return (
    <Card label="Payment" tone={tone}>
      <div className="text-base font-semibold text-neutral-900">
        Balance pending
      </div>
      <div className="text-[11px] text-neutral-600 mt-0.5">
        {money ? `${money} remaining` : "Balance not yet received"}
        {daysToEta != null && daysToEta >= 0
          ? ` · due in ${daysToEta}d`
          : ""}
      </div>
    </Card>
  );
}

function ShippingCard({ state }: { state: OperationsShippingState }) {
  switch (state) {
    case "delivered":
      return (
        <Card label="Shipping" tone="emerald">
          <div className="text-base font-semibold text-emerald-900">
            Delivered
          </div>
          <div className="text-[11px] text-emerald-700/80 mt-0.5">
            Project closed on the logistics side.
          </div>
        </Card>
      );
    case "shipped":
      return (
        <Card label="Shipping" tone="sky">
          <div className="text-base font-semibold text-sky-900">In transit</div>
          <div className="text-[11px] text-sky-800/80 mt-0.5">
            Container has sailed.
          </div>
        </Card>
      );
    case "booked":
      return (
        <Card label="Shipping" tone="sky">
          <div className="text-base font-semibold text-sky-900">Booked</div>
          <div className="text-[11px] text-sky-800/80 mt-0.5">
            Carrier confirmed · awaiting load.
          </div>
        </Card>
      );
    case "ready_to_ship":
      return (
        <Card label="Shipping" tone="amber">
          <div className="text-base font-semibold text-amber-900">
            Waiting booking
          </div>
          <div className="text-[11px] text-amber-800/80 mt-0.5">
            Production complete · book the carrier.
          </div>
        </Card>
      );
    case "cancelled":
      return (
        <Card label="Shipping" tone="neutral">
          <div className="text-base font-semibold text-neutral-700">
            Cancelled
          </div>
        </Card>
      );
    default:
      return (
        <Card label="Shipping" tone="neutral">
          <div className="text-base font-semibold text-neutral-700">
            Not started
          </div>
          <div className="text-[11px] text-neutral-500 mt-0.5">
            Surfaces once production is complete.
          </div>
        </Card>
      );
  }
}
