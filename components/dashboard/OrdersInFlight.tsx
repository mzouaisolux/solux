import Link from "next/link";
import { getT } from "@/lib/i18n/server";
import type { ProductionTaskListStatus } from "@/lib/types";
import { ORDER_PILL_TONES, type OrderPill } from "@/lib/order-pills";
import {
  computeOrderFlightStage,
  ORDER_FLIGHT_PHASES,
  type OrderStageTone,
} from "@/lib/lifecycle";

/**
 * The operational bird's-eye view of in-flight orders.
 *
 * Each row shows, for a 3-second read:
 *   1. identity + value
 *   2. the REAL current stage (badge) + plain-English context — computed by
 *      computeOrderFlightStage (the single source of truth in lib/lifecycle).
 *   3. operational pills (payment / production / logistics / blocker)
 *   4. a compact 6-phase progress strip (Quote → … → Delivered) with the
 *      active phase highlighted in the stage's tone.
 *
 * The same stage logic is used for every role; visibility (which orders) is
 * decided upstream by the dashboard's RLS-scoped query.
 */
export type OrderInFlight = {
  doc_id: string;
  doc_number: string | null;
  affair_name?: string | null;
  client_name: string;
  client_country: string | null;
  client_code: string | null;
  product_summary: string;
  total_value: number;
  currency: string;
  task_list_id: string | null;
  task_list_status: ProductionTaskListStatus | null;
  production_status?: string | null;
  current_deadline?: string | null;
  delay_days?: number | null;
  ending_in_days?: number | null;
  shipment_booked?: boolean | null;
  etd?: string | null;
  eta?: string | null;
  actual_completion_date?: string | null;
  production_order_id?: string | null;
  pills?: OrderPill[];
};

/** Tone → badge + dot classes for the current-stage chip and active dot. */
const TONE: Record<OrderStageTone, { pill: string; dot: string }> = {
  neutral: { pill: "border-neutral-200 bg-neutral-50 text-neutral-700", dot: "bg-neutral-400" },
  sky: { pill: "border-sky-200 bg-sky-50 text-sky-800", dot: "bg-sky-500" },
  amber: { pill: "border-amber-200 bg-amber-50 text-amber-800", dot: "bg-amber-500" },
  violet: { pill: "border-violet-200 bg-violet-50 text-violet-800", dot: "bg-violet-500" },
  emerald: { pill: "border-emerald-200 bg-emerald-50 text-emerald-800", dot: "bg-emerald-600" },
  red: { pill: "border-red-200 bg-red-50 text-red-700", dot: "bg-red-500" },
};

/** Compact "Aug 21" date for the ETA chip. */
function fmtShortDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "2-digit",
  });
}

/**
 * Build the always-on ETA chip — the operational anchor that pairs with any
 * delay pill so users never see "+50d" without knowing the resulting date.
 *
 * Three flavors:
 *   - Delivered → emerald "Delivered <date>" using actual_completion_date.
 *   - In flight + ETA → neutral "ETA <date>" (current_deadline).
 *   - No ETA yet → null (the card just shows the stage chip without a date).
 */
function etaChipLabel(
  o: OrderInFlight
): { text: string; cls: string; title?: string } | null {
  const delivered =
    o.production_status === "delivered" ||
    !!o.actual_completion_date && o.production_status !== "cancelled";
  if (delivered) {
    const when =
      fmtShortDate(o.actual_completion_date) ?? fmtShortDate(o.eta) ?? null;
    if (!when) return null;
    return {
      text: `Delivered ${when}`,
      cls: "border-emerald-200 bg-emerald-50 text-emerald-800",
      title: `Actual completion · ${when}`,
    };
  }
  if (o.production_status === "cancelled") return null;
  const when = fmtShortDate(o.current_deadline);
  if (!when) return null;
  return {
    text: `ETA ${when}`,
    cls: "border-neutral-200 bg-neutral-50 text-neutral-700",
    title: `Current expected completion · ${when}`,
  };
}

/**
 * Route an order row to the right surface for its stage. Pre-validation →
 * task-list config; validated or beyond → production tracking; nothing yet →
 * the quotation.
 */
function resolveOrderRowHref(o: OrderInFlight): string {
  const tlReady =
    o.task_list_status === "validated" || o.task_list_status === "production_ready";
  const poUsable =
    !!o.production_order_id &&
    o.production_status !== null &&
    o.production_status !== "cancelled";
  if (tlReady && poUsable && o.production_order_id) {
    return `/production/orders/${o.production_order_id}`;
  }
  if (poUsable && o.production_status !== "awaiting_deposit" && o.production_order_id) {
    return `/production/orders/${o.production_order_id}`;
  }
  if (o.task_list_id) return `/task-lists/${o.task_list_id}`;
  return `/documents/${o.doc_id}`;
}

export default function OrdersInFlight({ orders }: { orders: OrderInFlight[] }) {
  const t = getT();
  if (orders.length === 0) {
    return (
      <div className="rounded-xl border border-neutral-200/80 bg-white shadow-soft p-10 text-center">
        <p className="text-sm text-neutral-500">{t("oif.empty")}</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-200/80 bg-white shadow-soft overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-100">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-widerx text-neutral-500">
            {t("oif.title")}
          </div>
          <div className="text-xs text-neutral-500 mt-0.5">
            {t("oif.subtitle", { n: orders.length })}
          </div>
        </div>
        <Link
          href="/operations"
          className="text-xs text-neutral-500 hover:text-neutral-900 hover:underline"
        >
          {t("common.view_all_arrow")}
        </Link>
      </div>
      <ul className="divide-y divide-neutral-100">
        {orders.map((o) => {
          const stage = computeOrderFlightStage(o);
          const tone = TONE[stage.tone];
          // The ETA chip is the operational anchor — pair it with any delay
          // pill so the resulting completion date is always visible. When the
          // order is already delivered, the chip flips to "Delivered <date>".
          const etaLabel = etaChipLabel(o);
          return (
            <li
              key={o.doc_id}
              className="px-5 py-4 hover:bg-neutral-50/60 transition-colors"
            >
              <Link href={resolveOrderRowHref(o)} className="block">
                {/* Header — client (biggest), affair below, doc code +
                    products as the technical reference line. Value anchored
                    on the right with its "Value" label. */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-neutral-900 truncate">
                      {o.client_name}
                      {o.client_country && (
                        <span className="text-neutral-400 font-normal">
                          {" "}
                          · {o.client_country}
                        </span>
                      )}
                    </div>
                    {o.affair_name && (
                      <div className="text-[12px] text-neutral-600 mt-0.5 truncate">
                        {o.affair_name}
                      </div>
                    )}
                    <div className="text-[11px] text-neutral-400 mt-0.5 truncate">
                      <span className="font-mono">{o.doc_number ?? "—"}</span>
                      {o.product_summary ? ` · ${o.product_summary}` : ""}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold tabular-nums text-neutral-900">
                      {o.currency}{" "}
                      {o.total_value >= 1000
                        ? `${(o.total_value / 1000).toLocaleString(undefined, {
                            maximumFractionDigits: 1,
                          })}k`
                        : o.total_value.toLocaleString()}
                    </div>
                    <div className="text-[10px] text-neutral-400 uppercase tracking-widerx mt-0.5">
                      Value
                    </div>
                  </div>
                </div>

                {/* Compact operational chip row — stage + always-on ETA +
                    delay + other ops pills all on ONE line. This is the
                    "right now" snapshot; the lifecycle strip below carries
                    the visual progression separately. Tooltip on the stage
                    chip carries the plain-English context. */}
                <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                  <span
                    title={stage.context}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${tone.pill}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                    {stage.label}
                  </span>
                  {etaLabel && (
                    <span
                      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium tabular-nums whitespace-nowrap ${etaLabel.cls}`}
                      title={etaLabel.title}
                    >
                      {etaLabel.text}
                    </span>
                  )}
                  {o.pills?.map((p, i) => (
                    <span
                      key={i}
                      title={p.title ?? p.label}
                      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium tabular-nums whitespace-nowrap ${ORDER_PILL_TONES[p.tone]}`}
                    >
                      {p.label}
                    </span>
                  ))}
                </div>

                {/* Lifecycle progression — the operational pipeline:
                    QUOTE → TASK LIST → PAYMENT → PRODUCTION → SHIPPING → DELIVERED.
                    This is the strongest visual signal on the row — it gives
                    teams immediate orientation, momentum, and a sense of where
                    the project sits. Stays full-width with labels; only the
                    metadata above became compact, never the pipeline itself. */}
                <div className="mt-3 flex items-center gap-0">
                  {ORDER_FLIGHT_PHASES.map((_, i) => {
                    const isDone = i < stage.phaseIndex;
                    const isCurrent = i === stage.phaseIndex;
                    return (
                      <div key={i} className="flex-1 flex items-center gap-0">
                        <div className="relative flex items-center justify-center">
                          <div
                            className={`h-2.5 w-2.5 rounded-full shrink-0 transition-colors ${
                              isCurrent
                                ? `${tone.dot} ring-4 ring-black/5`
                                : isDone
                                ? "bg-neutral-900"
                                : "bg-white border border-neutral-300"
                            }`}
                          />
                        </div>
                        {i < ORDER_FLIGHT_PHASES.length - 1 && (
                          <div
                            className={`flex-1 h-[2px] mx-1 transition-colors ${
                              isDone ? "bg-neutral-900" : "bg-neutral-200"
                            }`}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-1.5 flex items-start gap-0">
                  {ORDER_FLIGHT_PHASES.map((label, i) => {
                    const isCurrent = i === stage.phaseIndex;
                    const isDone = i < stage.phaseIndex;
                    return (
                      <div key={label} className="flex-1 text-left pr-1">
                        <div
                          className={`text-[10px] uppercase tracking-widerx font-semibold ${
                            isCurrent
                              ? "text-neutral-900"
                              : isDone
                              ? "text-neutral-600"
                              : "text-neutral-400"
                          }`}
                        >
                          {label}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

