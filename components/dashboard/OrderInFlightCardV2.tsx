// =====================================================================
// OrderInFlightBoardV2 — the AFFAIR-CENTRIC cockpit for /dashboard/operations-v2.
//
// Owner ruling 2026-06-25: Orders in flight IS the centre of the operations
// dashboard. Each card is a real execution affair, anchored on the PROFORMA
// (the command) so the board covers the FULL universe (task list draft →
// validation → deposit → production → shipping → delivered), not just affairs
// that already have a production order. Alerts are an ATTRIBUTE of the affair,
// shown ON the card. The board groups affairs into severity BANDS so the most
// problematic rise to the top:
//
//   🔴 Blocked  →  🟠 Action required  →  🔵 At risk  →  🟢 On track
//
// Reuses the canonical computeOrderFlightStage (label/tone/context) + the
// 7-phase V2 strip (lib/lifecycle-v2). No data access; the page computes
// everything and passes plain props. Hardcoded English to match the app.
// =====================================================================

import Link from "next/link";
import { ORDER_PILL_TONES, type OrderPill } from "@/lib/order-pills";
import { computeOrderFlightStage, type OrderStageTone } from "@/lib/lifecycle";
import { ORDER_FLIGHT_PHASES_V2, phase7Index } from "@/lib/lifecycle-v2";
import type { OrderInFlight } from "@/components/dashboard/OrdersInFlight";
import type { SeverityTier } from "@/lib/order-severity";

/** One "⚠ what · [WHO]" chip surfaced on the card from an attached action. */
export type ActionBadge = {
  id: string;
  label: string;
  /** Short role tag — OPS / SALES / TLM / MGMT — or null. */
  role: string | null;
  tone: "danger" | "warn" | "info";
};

/** An execution affair (proforma-anchored) enriched with severity + exceptions. */
export type OrderCardV2 = OrderInFlight & {
  client_id?: string | null;
  /** The commercial who owns this order (sales_owner ?? creator) — drives the filter. */
  ownerId?: string | null;
  severityTier: SeverityTier;
  badges: ActionBadge[];
};

/** Tone → badge + dot classes for the current-stage chip (verbatim from OrdersInFlight). */
const TONE: Record<OrderStageTone, { pill: string; dot: string }> = {
  neutral: { pill: "border-neutral-200 bg-neutral-50 text-neutral-700", dot: "bg-neutral-400" },
  sky: { pill: "border-sky-200 bg-sky-50 text-sky-800", dot: "bg-sky-500" },
  amber: { pill: "border-amber-200 bg-amber-50 text-amber-800", dot: "bg-amber-500" },
  violet: { pill: "border-violet-200 bg-violet-50 text-violet-800", dot: "bg-violet-500" },
  emerald: { pill: "border-emerald-200 bg-emerald-50 text-emerald-800", dot: "bg-emerald-600" },
  red: { pill: "border-red-200 bg-red-50 text-red-700", dot: "bg-red-500" },
};

const TIER_ORDER: SeverityTier[] = ["blocked", "action_required", "at_risk", "on_track"];

const TIER_META: Record<
  SeverityTier,
  { label: string; help: string; border: string; dot: string; head: string }
> = {
  blocked: { label: "Blocked", help: "Stuck or actively wrong — handle now.", border: "border-l-rose-500", dot: "bg-rose-500", head: "text-rose-700" },
  action_required: { label: "Action required", help: "A clear to-do will move it forward.", border: "border-l-amber-500", dot: "bg-amber-500", head: "text-amber-700" },
  at_risk: { label: "At risk", help: "A timer is running — watch & nudge.", border: "border-l-sky-500", dot: "bg-sky-500", head: "text-sky-700" },
  on_track: { label: "On track", help: "Progressing normally.", border: "border-l-emerald-500", dot: "bg-emerald-500", head: "text-neutral-500" },
};

const BADGE_TONE: Record<ActionBadge["tone"], string> = {
  danger: "border-rose-200 bg-rose-50 text-rose-700",
  warn: "border-amber-200 bg-amber-50 text-amber-800",
  info: "border-sky-200 bg-sky-50 text-sky-700",
};

function fmtShortDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", day: "2-digit" });
}

/** Always-on ETA / Delivered chip (verbatim from OrdersInFlight). */
function etaChipLabel(
  o: OrderCardV2
): { text: string; cls: string; title?: string } | null {
  const delivered =
    o.production_status === "delivered" ||
    (!!o.actual_completion_date && o.production_status !== "cancelled");
  if (delivered) {
    const when = fmtShortDate(o.actual_completion_date) ?? fmtShortDate(o.eta) ?? null;
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

/** Route a row to the right surface for its stage (verbatim from OrdersInFlight). */
function resolveOrderRowHref(o: OrderCardV2): string {
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

function fmtValue(o: OrderCardV2): string {
  const v = o.total_value;
  return `${o.currency} ${
    v >= 1000
      ? `${(v / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}k`
      : v.toLocaleString()
  }`;
}

/** One execution-affair card. */
function Row({ o }: { o: OrderCardV2 }) {
  const stage = computeOrderFlightStage(o);
  const tone = TONE[stage.tone];
  const sev = TIER_META[o.severityTier];
  const etaLabel = etaChipLabel(o);
  const activePhase = phase7Index(stage.label);
  return (
    <li
      className={`border-l-4 ${sev.border} px-5 py-4 hover:bg-neutral-50/60 transition-colors`}
    >
      <Link href={resolveOrderRowHref(o)} className="block">
        {/* Header — client, project/affair, command ref + products, value. */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-neutral-900 truncate">
              <span className={`mr-1.5 inline-block h-2 w-2 rounded-full align-middle ${sev.dot}`} title={sev.label} aria-hidden />
              {o.client_name}
              {o.client_country && (
                <span className="text-neutral-400 font-normal"> · {o.client_country}</span>
              )}
            </div>
            {o.affair_name && (
              <div className="text-[12px] text-neutral-600 mt-0.5 truncate">{o.affair_name}</div>
            )}
            <div className="text-[11px] text-neutral-400 mt-0.5 truncate">
              <span className="font-mono">{o.doc_number ?? "—"}</span>
              {o.product_summary ? ` · ${o.product_summary}` : ""}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-sm font-bold tabular-nums text-neutral-900">{fmtValue(o)}</div>
            <div className="text-[10px] text-neutral-400 uppercase tracking-wider mt-0.5">Value</div>
          </div>
        </div>

        {/* State row — stage + always-on ETA + ops pills. */}
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
          {o.pills?.map((p: OrderPill, i: number) => (
            <span
              key={i}
              title={p.title ?? p.label}
              className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium tabular-nums whitespace-nowrap ${ORDER_PILL_TONES[p.tone]}`}
            >
              {p.label}
            </span>
          ))}
        </div>

        {/* Exceptions row — what needs doing + WHO. Only when present. */}
        {o.badges.length > 0 && (
          <div className="mt-2 flex items-center gap-1.5 flex-wrap">
            {o.badges.map((b) => (
              <span
                key={b.id}
                className={`inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[10.5px] font-medium whitespace-nowrap ${BADGE_TONE[b.tone]}`}
              >
                <span aria-hidden>⚠</span>
                {b.label}
                {b.role && (
                  <span className="rounded bg-white/70 px-1 text-[9px] font-bold uppercase tracking-wide opacity-80">
                    {b.role}
                  </span>
                )}
              </span>
            ))}
          </div>
        )}

        {/* 7-phase execution timeline. */}
        <div className="mt-3 flex items-center gap-0">
          {ORDER_FLIGHT_PHASES_V2.map((_, i) => {
            const isDone = i < activePhase;
            const isCurrent = i === activePhase;
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
                {i < ORDER_FLIGHT_PHASES_V2.length - 1 && (
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
          {ORDER_FLIGHT_PHASES_V2.map((label, i) => {
            const isCurrent = i === activePhase;
            const isDone = i < activePhase;
            return (
              <div key={label} className="flex-1 text-left pr-1">
                <div
                  className={`text-[9.5px] uppercase tracking-wide font-semibold ${
                    isCurrent ? "text-neutral-900" : isDone ? "text-neutral-600" : "text-neutral-400"
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
}

export default function OrderInFlightBoardV2({ orders }: { orders: OrderCardV2[] }) {
  // orders arrive already sorted by severity rank (desc) — group into bands.
  const byTier = new Map<SeverityTier, OrderCardV2[]>();
  for (const t of TIER_ORDER) byTier.set(t, []);
  for (const o of orders) byTier.get(o.severityTier)!.push(o);

  return (
    <div className="rounded-xl border border-neutral-200/80 bg-white shadow-soft overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-100">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
            Orders in flight
          </div>
          <div className="text-xs text-neutral-500 mt-0.5">
            {orders.length} affair{orders.length > 1 ? "s" : ""} in execution · most urgent first
          </div>
        </div>
        <Link href="/operations" className="text-xs text-neutral-500 hover:text-neutral-900 hover:underline">
          View all →
        </Link>
      </div>

      {orders.length === 0 ? (
        <div className="p-10 text-center text-sm text-neutral-500">No affairs in execution right now.</div>
      ) : (
        TIER_ORDER.filter((t) => byTier.get(t)!.length > 0).map((t) => {
          const meta = TIER_META[t];
          const list = byTier.get(t)!;
          return (
            <section key={t}>
              <div className="flex items-center gap-2 bg-neutral-50/70 px-5 py-1.5 border-b border-neutral-100">
                <span className={`h-2 w-2 rounded-full ${meta.dot}`} aria-hidden />
                <span className={`text-[11px] font-semibold uppercase tracking-wider ${meta.head}`}>
                  {meta.label}
                </span>
                <span className="rounded-full bg-neutral-200/70 px-1.5 text-[10px] tabular-nums text-neutral-600">
                  {list.length}
                </span>
                <span className="text-[11px] text-neutral-400 hidden sm:inline">· {meta.help}</span>
              </div>
              <ul className="divide-y divide-neutral-100">
                {list.map((o) => (
                  <Row key={o.doc_id} o={o} />
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
