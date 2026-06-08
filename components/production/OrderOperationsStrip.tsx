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
    <section className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
      <div className="po-kpi">
        <div className="k">Initial ETA</div>
        <div className="val">{fmtLongDate(initialEta)}</div>
        <div className="sub">Baseline · locked at activation</div>
      </div>

      <div className="po-kpi">
        <div className="k">Current ETA</div>
        <div className="val">{fmtLongDate(currentEta)}</div>
        <div className="sub">
          {daysToEta == null
            ? "—"
            : daysToEta < 0
            ? `${Math.abs(daysToEta)}d past`
            : daysToEta === 0
            ? "Due today"
            : `In ${daysToEta}d`}
        </div>
      </div>

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

/** The most important card: distinguishes factory vs external responsibility.
 *  Slipping → Hazard treatment (ink frame + danger stripe + ▲); on schedule
 *  → calm card with a Flash-Green positive value. No rainbow. */
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
  // No slip at all → calm card, positive (green) value.
  if (totalDays <= 0) {
    return (
      <div className="po-kpi">
        <div className="k">Delay</div>
        <div className="val">
          <span className="pos">On schedule</span>
        </div>
        <div className="sub">No deadline shift recorded.</div>
      </div>
    );
  }
  // Mixed: show the dominant axis at the top, the other axis as a sub-line.
  const factoryDominant = factoryDays >= externalDays;
  if (factoryDominant && factoryDays > 0) {
    return (
      <div className="po-kpi alert">
        <div className="k">Delay</div>
        <div className="val">
          <span className="tri">▲</span>
          <span>+{factoryDays}d Factory</span>
        </div>
        <div className="sub">
          {externalDays > 0 ? `+${externalDays}d external · ` : ""}
          counts toward factory KPI
        </div>
      </div>
    );
  }
  // External-only or external-dominant slip → still Hazard (urgency, no color).
  const extLabel =
    latestType && latestType !== "production"
      ? DELAY_TYPE_LABEL[latestType].replace(" delay", "")
      : "External";
  return (
    <div className="po-kpi alert">
      <div className="k">Delay</div>
      <div className="val">
        <span className="tri">▲</span>
        <span>
          +{externalDays}d {extLabel}
        </span>
      </div>
      <div className="sub">
        {factoryDays > 0 ? `+${factoryDays}d factory · ` : ""}
        does not affect factory KPI
      </div>
    </div>
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
      <div className="po-kpi">
        <div className="k">Payment</div>
        <div className="val">
          <span className="pos">
            {state === "paid_in_full" ? "Paid in full" : "No deposit required"}
          </span>
        </div>
        <div className="sub">
          {state === "paid_in_full"
            ? "Balance settled."
            : "Cash-on-receipt terms."}
        </div>
      </div>
    );
  }
  if (state === "awaiting_deposit") {
    return (
      <div className="po-kpi">
        <div className="k">Payment</div>
        <div className="val">Awaiting deposit</div>
        <div className="sub">Production gated on the deposit.</div>
      </div>
    );
  }
  // Partial / deposit received → show balance remaining.
  const money = fmtMoney(balanceRemaining ?? null, currency);
  return (
    <div className="po-kpi">
      <div className="k">Payment</div>
      <div className="val">Balance pending</div>
      <div className="sub">
        {money ? `${money} remaining` : "Balance not yet received"}
        {daysToEta != null && daysToEta >= 0 ? ` · due in ${daysToEta}d` : ""}
      </div>
    </div>
  );
}

function ShipKpi({
  title,
  sub,
  pos = false,
}: {
  title: string;
  sub?: string | null;
  pos?: boolean;
}) {
  return (
    <div className="po-kpi">
      <div className="k">Shipping</div>
      <div className="val">{pos ? <span className="pos">{title}</span> : title}</div>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
}

function ShippingCard({ state }: { state: OperationsShippingState }) {
  switch (state) {
    case "delivered":
      return (
        <ShipKpi title="Delivered" sub="Project closed on the logistics side." pos />
      );
    case "shipped":
      return <ShipKpi title="In transit" sub="Container has sailed." />;
    case "booked":
      return <ShipKpi title="Booked" sub="Carrier confirmed · awaiting load." />;
    case "ready_to_ship":
      return (
        <ShipKpi title="Waiting booking" sub="Production complete · book the carrier." />
      );
    case "cancelled":
      return <ShipKpi title="Cancelled" />;
    default:
      return (
        <ShipKpi title="Not started" sub="Surfaces once production is complete." />
      );
  }
}
