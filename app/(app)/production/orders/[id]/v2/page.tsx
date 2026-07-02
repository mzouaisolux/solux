import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole } from "@/lib/auth";
import { resolveUserLabelStrings } from "@/lib/user-display";
import { PremiumPill } from "@/components/production/premium-ui";
import {
  CollapsibleSection,
  SummaryStat,
  SummaryRow,
} from "@/components/production/CollapsibleSection";
import {
  computeNextAction,
  type NextActionItem,
  type NaTone,
} from "@/lib/production-next-action";
import {
  PRODUCTION_ORDER_STATUS_LABEL,
  PRODUCTION_PAYMENT_STATE_LABEL,
  computeExpectedBalance,
  computeExpectedDeposit,
  computeEffectiveBalanceDueDate,
  computeProductionDelay,
  computeProductionPaymentState,
  type PaymentMode,
  type PaymentTerms,
  type ProductionOrderStatus,
} from "@/lib/types";
import { computeDelayBreakdown } from "@/lib/delays";
import { calendarDaysBetween, todayISO } from "@/lib/working-days";
import { normalizeBlProfile, blProfileStatus } from "@/lib/bl";
import {
  requiredShippingDocs,
  computeShippingDocsReadiness,
} from "@/lib/shipping-docs";
import { LC_EXPIRY_WARNING_DAYS } from "@/lib/operations-alerts";

/**
 * Production order detail — REDESIGN PROTOTYPE (read-only preview).
 *
 * Non-destructive sibling of ./page.tsx: same data + same derivations, but laid
 * out around the audit's five moves — one "Next action" band, a ranked attention
 * queue, a single live-status row, a single status read, and slim sections with
 * smart empty states. Editing still lives on the live page; every CTA links back
 * there. The live page is untouched.
 *
 * URL: /production/orders/<id>/v2
 */
export default async function ProductionOrderV2Page({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createClient();
  await getEffectiveRole();

  const [orderRes, historyRes, docsRes] = await Promise.all([
    supabase
      .from("production_orders")
      .select(
        "*, documents:quotation_id(id, number, type, total_price, currency, status, payment_mode, payment_terms, incoterm, purchase_order_number, bank_account_id), clients(company_name, country, client_code, contact_name, bl_profile), task_lists:task_list_id(id, number, status)"
      )
      .eq("id", params.id)
      .maybeSingle(),
    supabase
      .from("production_deadline_changes")
      .select("previous_date, new_date, delay_type, days_added, reason, created_at")
      .eq("production_order_id", params.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("order_documents")
      .select("kind, archived_at")
      .eq("production_order_id", params.id),
  ]);

  const order = orderRes.data as any;
  if (orderRes.error) {
    console.error("[po v2] load failed:", orderRes.error.message);
    notFound();
  }
  if (!order) notFound();

  const status = order.status as ProductionOrderStatus;
  const doc = order.documents as any;
  const cli = order.clients as any;
  const currency = (doc?.currency as string) ?? "USD";

  // ---- Payment math (mirrors the live page) --------------------------------
  const totalPrice = Number(doc?.total_price ?? 0);
  const paymentMode = (doc?.payment_mode ?? null) as PaymentMode | null;
  const paymentTerms = (doc?.payment_terms ?? null) as PaymentTerms | null;
  const expectedDeposit = computeExpectedDeposit(totalPrice, paymentMode, paymentTerms);
  const expectedBalance = computeExpectedBalance(totalPrice, paymentMode, paymentTerms);
  const depositReceived = Number(order.deposit_received_amount ?? 0);
  const balanceReceived = Number(order.balance_received_amount ?? 0);
  const paymentState = computeProductionPaymentState({
    totalPrice,
    paymentMode,
    paymentTerms,
    depositReceived,
    balanceReceived,
  });
  const productionCanStart =
    paymentState === "deposit_received" ||
    paymentState === "partial_balance" ||
    paymentState === "paid_in_full" ||
    paymentState === "no_deposit_required";
  const balanceRemaining = Math.max(0, totalPrice - depositReceived - balanceReceived);
  const balanceOutstanding =
    expectedBalance > 0 && balanceReceived + 0.01 < expectedBalance;

  const balanceDue = computeEffectiveBalanceDueDate({
    balanceDueDate: (order.balance_due_date ?? null) as string | null,
    paymentMode,
    paymentTerms,
    currentProductionDeadline: (order.current_production_deadline ?? null) as string | null,
    eta: (order.eta ?? null) as string | null,
  });
  const balanceDueDaysLate = balanceDue.date
    ? calendarDaysBetween(balanceDue.date, todayISO())
    : null;

  const lcExpiryDate = (order.lc_expiry_date ?? null) as string | null;
  const lcDaysToExpiry = lcExpiryDate ? calendarDaysBetween(todayISO(), lcExpiryDate) : null;
  const lcCritical =
    balanceOutstanding && lcDaysToExpiry !== null && lcDaysToExpiry <= LC_EXPIRY_WARNING_DAYS;

  // ---- Delay breakdown -----------------------------------------------------
  const delayBreakdown = computeDelayBreakdown(
    ((historyRes.data ?? []) as any[]).map((h) => ({
      previous_date: h.previous_date,
      new_date: h.new_date,
      delay_type: h.delay_type ?? null,
      days_added: h.days_added ?? null,
      reason: h.reason ?? null,
      created_at: h.created_at,
    }))
  );
  const totalDelay = delayBreakdown.factoryDays + delayBreakdown.externalDays;
  const delay = computeProductionDelay({
    initial_production_deadline: order.initial_production_deadline,
    current_production_deadline: order.current_production_deadline,
  });

  // ---- Shipping / BL / docs readiness --------------------------------------
  const blProfile = normalizeBlProfile(cli?.bl_profile);
  const blStatus = blProfileStatus(blProfile);
  const shippingRequirements = requiredShippingDocs({
    paymentMode,
    blDocuments: blProfile.documents,
  });
  const presentKinds = Array.from(
    new Set(
      ((docsRes.data ?? []) as any[])
        .filter((d) => !d.archived_at && d.kind)
        .map((d) => d.kind as string)
    )
  );
  const docsReadiness = computeShippingDocsReadiness(shippingRequirements, presentKinds);
  const ciGenerated =
    presentKinds.includes("commercial_invoice") ||
    !!order.commercial_invoice_number;

  // ---- Days to ETA (mirrors the live page) ---------------------------------
  const daysToEta = (() => {
    const cur = order.current_production_deadline as string | null;
    if (!cur) return null;
    const t0 = Date.parse(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
    const t1 = Date.parse(cur + "T00:00:00Z");
    if (!Number.isFinite(t0) || !Number.isFinite(t1)) return null;
    return Math.ceil((t1 - t0) / 86_400_000);
  })();

  // ---- Project identity (affair + sales owner) -----------------------------
  let affairName: string | null = null;
  let salesLabel = "—";
  if (order.quotation_id) {
    try {
      const { data: q } = await supabase
        .from("documents")
        .select("affair_name, created_by, sales_owner_id")
        .eq("id", order.quotation_id)
        .maybeSingle();
      affairName = ((q as any)?.affair_name as string | null) ?? null;
      const ownerId =
        ((q as any)?.sales_owner_id as string | null) ??
        ((q as any)?.created_by as string | null);
      if (ownerId) {
        const labels = await resolveUserLabelStrings([ownerId]);
        salesLabel = labels.get(ownerId) ?? "—";
      }
    } catch {
      /* keep defaults */
    }
  }

  // ---- The redesign core ---------------------------------------------------
  const na = computeNextAction({
    status: status as any,
    paymentState: paymentState as any,
    productionCanStart,
    shipmentBooked: !!order.shipment_booked,
    depositOverrideActive: !!order.deposit_override_at,
    blStatus,
    docsAllRequiredReady: docsReadiness.allRequiredReady,
    docsRequiredReady: docsReadiness.requiredReady,
    docsRequiredTotal: docsReadiness.requiredTotal,
    ciGenerated,
    balanceOutstanding,
    balanceRemainingLabel: `${currency} ${fmtMoney(balanceRemaining)}`,
    balanceDueLabel: balanceDue.date ? fmtDate(balanceDue.date) : null,
    balanceDueDaysLate,
    daysToEta,
    balanceReminderDaysBeforeEta:
      (order.balance_reminder_days_before_eta ?? null) as number | null,
    lcCritical,
    lcDaysToExpiry,
    archived: !!order.archived_at,
  });

  const livePath = `/production/orders/${params.id}`;
  const paymentLabel = PRODUCTION_PAYMENT_STATE_LABEL[paymentState];
  const shippingLabel = order.shipment_booked
    ? "Booked"
    : status === "shipped"
    ? "In transit"
    : status === "delivered"
    ? "Delivered"
    : status === "production_completed"
    ? "Awaiting booking"
    : "Not started";
  const suggestedNext = na.primary?.title ?? null;
  const prodMini: { variant: "pos" | "ink" | "line"; label: string } =
    order.actual_completion_date || status === "production_completed"
      ? { variant: "pos", label: "Completed" }
      : status === "production_delayed"
      ? { variant: "ink", label: "Delayed" }
      : status === "in_production"
      ? { variant: "line", label: "In progress" }
      : { variant: "line", label: "Not started" };

  return (
    <div className="po-premium mx-auto max-w-screen-lg px-6 py-8 space-y-5">
      {/* Prototype ribbon — this is a preview, the live page is unchanged. */}
      <div className="flex items-center justify-between gap-3 flex-wrap rounded border border-[color:var(--line-2)] bg-white px-3 py-2 text-[11px] text-[color:var(--ink-soft)]">
        <span>
          <b className="text-[color:var(--ink)]">Redesign preview</b> · read-only.
          Editing lives on the full order page.
        </span>
        <Link href={livePath} className="btn-secondary !py-1 !px-2 !text-[11px]">
          Open live page →
        </Link>
      </div>

      {/* ---------- HEADER ---------- */}
      <div className="min-w-0">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="eyebrow">Production order</div>
          <PremiumPill variant={status === "cancelled" ? "line" : "pos"}>
            {PRODUCTION_ORDER_STATUS_LABEL[status]}
            {order.archived_at ? " · archived" : ""}
          </PremiumPill>
        </div>
        {affairName ? (
          <>
            <h1 className="po-order-id mt-2">{affairName}</h1>
            <div className="font-mono text-sm text-neutral-500 mt-1">
              {order.number ?? "—"}
            </div>
          </>
        ) : (
          <h1 className="po-order-id mt-2 font-mono">{order.number ?? "—"}</h1>
        )}
        <div className="po-metarow mt-4">
          <div>
            <div className="po-k">Client</div>
            <Link href={`/clients/${order.client_id}`} className="po-v hover:underline">
              {cli?.company_name ?? "—"}
              {cli?.client_code ? ` (${cli.client_code})` : ""}
            </Link>
          </div>
          <div>
            <div className="po-k">Sales</div>
            <div className="po-v">{salesLabel}</div>
          </div>
          <div>
            <div className="po-k">Value</div>
            <div className="po-v num">
              {currency} {fmtMoney(totalPrice)}
            </div>
          </div>
          <div>
            <div className="po-k">Quotation</div>
            <Link href={`/documents/${order.quotation_id}`} className="po-v num hover:underline">
              {doc?.number ?? "—"}
            </Link>
          </div>
        </div>
      </div>

      {/* ---------- ① NEXT ACTION ---------- */}
      {na.closed ? (
        <section className="panel px-5 py-4 text-sm text-neutral-700">
          {status === "cancelled"
            ? "This order has been cancelled — no further action is expected."
            : order.archived_at
            ? "This order has been archived."
            : "This order has been delivered. Workflow closed."}
        </section>
      ) : na.primary ? (
        <section
          className={`panel px-6 py-5 ${na.primary.tone === "blocked" ? "po-attention" : ""}`}
          style={{ background: "#fafafa", borderColor: "var(--line-2)" }}
        >
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="eyebrow" style={{ color: "var(--ink)" }}>
                  Next action
                </div>
                <ToneTag tone={na.primary.tone} />
              </div>
              <div
                className="mt-2 font-medium text-[color:var(--ink)]"
                style={{ fontSize: "21px", letterSpacing: "-0.01em" }}
              >
                {na.primary.title}
              </div>
              <p className="text-sm text-neutral-600 mt-1 max-w-xl">
                {na.primary.detail}
              </p>
            </div>
            <Link href={livePath} className="btn-primary shrink-0">
              {na.primary.ctaLabel ?? "Open order"} →
            </Link>
          </div>
        </section>
      ) : (
        <section className="panel px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="po-dot po-dot--green" aria-hidden />
            <span className="text-sm font-medium text-[color:var(--ink)]">
              All clear
            </span>
          </div>
          <p className="text-sm text-neutral-600 mt-1">
            Nothing needs you on this order right now.
          </p>
        </section>
      )}

      {/* ---------- ② NEEDS ATTENTION (ranked queue) ---------- */}
      {na.queue.length > 0 && (
        <section className="panel overflow-hidden">
          <div className="px-5 py-3 border-b border-[color:var(--line)]">
            <div className="eyebrow">Needs attention</div>
          </div>
          {na.queue.map((item, i) => (
            <QueueRow
              key={item.key}
              item={item}
              href={livePath}
              last={i === na.queue.length - 1}
            />
          ))}
        </section>
      )}

      {/* ---------- ③ LIVE STATUS (single row) ---------- */}
      <div>
        <div className="eyebrow mb-2.5">Live status</div>
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="po-kpi">
          <div className="k">Current ETA</div>
          <div className="val">
            {order.current_production_deadline ? (
              fmtLong(order.current_production_deadline)
            ) : (
              <span style={{ color: "var(--mute)" }}>Not scheduled</span>
            )}
          </div>
          <div className="sub">
            {daysToEta == null
              ? "awaiting schedule"
              : daysToEta < 0
              ? `${Math.abs(daysToEta)}d past`
              : daysToEta === 0
              ? "due today"
              : `in ${daysToEta}d`}
          </div>
        </div>
        {totalDelay > 0 ? (
          <div className="po-kpi alert">
            <div className="k">Delay</div>
            <div className="val">
              <span className="tri">▲</span>
              <span>+{totalDelay}d</span>
            </div>
            <div className="sub">
              {delayBreakdown.factoryDays > 0 ? `${delayBreakdown.factoryDays}d factory` : ""}
              {delayBreakdown.factoryDays > 0 && delayBreakdown.externalDays > 0 ? " · " : ""}
              {delayBreakdown.externalDays > 0 ? `${delayBreakdown.externalDays}d external` : ""}
            </div>
          </div>
        ) : (
          <div className="po-kpi">
            <div className="k">Delay</div>
            <div className="val">
              <span className="pos">On schedule</span>
            </div>
            <div className="sub">no deadline shift</div>
          </div>
        )}
        <div className="po-kpi">
          <div className="k">Payment</div>
          <div className="val">{paymentLabel}</div>
          <div className="sub">
            {balanceRemaining > 0
              ? `${currency} ${fmtMoney(balanceRemaining)} left`
              : "settled"}
          </div>
        </div>
        <div className="po-kpi">
          <div className="k">Shipping</div>
          <div className="val">{shippingLabel}</div>
          <div className="sub">
            {blStatus === "complete" ? "BL profile ready" : "BL profile incomplete"}
          </div>
        </div>
        </section>
      </div>

      {/* ---------- ④ STATUS (single control, not 9 buttons) ---------- */}
      <section className="panel px-5 py-3.5 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[11px] uppercase tracking-widerx font-semibold text-neutral-500">
            Status
          </span>
          <span className="inline-flex items-center gap-2 rounded-md border border-[color:var(--line-2)] bg-white px-3 py-1.5 text-[13px] font-medium text-[color:var(--ink)]">
            <span
              className={`po-dot ${status === "cancelled" ? "po-dot--mute" : "po-dot--green"}`}
              aria-hidden
            />
            {PRODUCTION_ORDER_STATUS_LABEL[status]}
            <svg
              className="h-3.5 w-3.5 text-neutral-400"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden
            >
              <path
                fillRule="evenodd"
                d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                clipRule="evenodd"
              />
            </svg>
          </span>
          {suggestedNext && !na.closed && (
            <span className="text-xs text-neutral-500">
              Suggested next:{" "}
              <b className="text-neutral-800 font-medium">{suggestedNext}</b>
            </span>
          )}
        </div>
        <span className="text-[11px] text-neutral-400">
          Updated {relTime(order.updated_at)} · change on the live page
        </span>
      </section>

      {/* ---------- ⑤ SLIM SECTIONS (smart summaries + empty states) ---------- */}
      <CollapsibleSection
        title="Payment"
        badge={
          <PremiumPill
            variant={
              paymentState === "awaiting_deposit"
                ? "ink"
                : balanceRemaining > 0
                ? "line"
                : "pos"
            }
          >
            {paymentLabel}
          </PremiumPill>
        }
        summary={
          <SummaryRow>
            <SummaryStat
              label="Deposit"
              value={
                expectedDeposit > 0
                  ? depositReceived + 0.01 >= expectedDeposit
                    ? "Received"
                    : "Pending"
                  : "None"
              }
              tone={
                expectedDeposit > 0
                  ? depositReceived + 0.01 >= expectedDeposit
                    ? "success"
                    : "warn"
                  : "muted"
              }
            />
            <SummaryStat
              label="Balance remaining"
              value={`${currency} ${fmtMoney(balanceRemaining)}`}
              tone={balanceRemaining > 0 ? "warn" : "success"}
            />
            <SummaryStat
              label="Balance due"
              value={balanceDue.date ? fmtDate(balanceDue.date) : "Set at booking"}
              tone={balanceDueDaysLate != null && balanceDueDaysLate > 0 ? "danger" : "default"}
            />
            <SummaryStat
              label="LC expiry"
              value={lcExpiryDate ? fmtDate(lcExpiryDate) : "No LC"}
              tone={lcCritical ? "danger" : "muted"}
            />
          </SummaryRow>
        }
      >
        <ManageOnLive href={livePath} what="deposits, balance, LC and reminders" />
      </CollapsibleSection>

      <CollapsibleSection
        title="Shipping & logistics"
        defaultOpen={
          status === "production_completed" && !order.shipment_booked
        }
        attention={status === "production_completed" && !order.shipment_booked}
        attentionLabel={blStatus !== "complete" ? "BL profile required" : "Book shipment"}
        badge={
          <>
            {order.shipment_booked ? (
              <PremiumPill variant="pos">Booked</PremiumPill>
            ) : (
              <PremiumPill variant="line">Not booked</PremiumPill>
            )}
            {docsReadiness.allRequiredReady ? (
              <PremiumPill variant="pos">Docs ready</PremiumPill>
            ) : (
              <PremiumPill variant="ink">
                Docs {docsReadiness.requiredReady}/{docsReadiness.requiredTotal}
              </PremiumPill>
            )}
          </>
        }
        summary={
          <SummaryRow>
            <SummaryStat
              label="BL number"
              value={order.shipment_booked ? "See live page" : "Set at booking"}
              tone={order.shipment_booked ? "default" : "muted"}
            />
            <SummaryStat
              label="ETD / ETA"
              value={
                order.etd || order.eta
                  ? `${fmtDate(order.etd)} · ${fmtDate(order.eta)}`
                  : "Book to schedule"
              }
              tone={order.etd || order.eta ? "default" : "muted"}
            />
            <SummaryStat
              label="BL profile"
              value={blStatus === "complete" ? "Complete" : "Incomplete"}
              tone={blStatus === "complete" ? "success" : "warn"}
            />
            <SummaryStat
              label="Required docs"
              value={`${docsReadiness.requiredReady} of ${docsReadiness.requiredTotal} ready`}
              tone={docsReadiness.allRequiredReady ? "success" : "warn"}
            />
          </SummaryRow>
        }
      >
        <ManageOnLive href={livePath} what="booking, BL details and export documents" />
      </CollapsibleSection>

      <CollapsibleSection
        title="Production"
        badge={<PremiumPill variant={prodMini.variant}>{prodMini.label}</PremiumPill>}
        summary={
          <SummaryRow>
            <SummaryStat
              label="Working days"
              value={order.production_working_days ?? "Not set yet"}
              tone={order.production_working_days == null ? "muted" : "default"}
            />
            <SummaryStat
              label="Current ETA"
              value={
                order.current_production_deadline
                  ? fmtDate(order.current_production_deadline)
                  : "Not scheduled"
              }
              tone={order.current_production_deadline ? "default" : "muted"}
            />
            <SummaryStat
              label="Total delay"
              value={totalDelay > 0 ? `+${totalDelay}d` : "On schedule"}
              tone={totalDelay > 0 ? "warn" : "success"}
            />
            <SummaryStat
              label="Completed"
              value={order.actual_completion_date ? fmtDate(order.actual_completion_date) : "In progress"}
              tone={order.actual_completion_date ? "success" : "muted"}
            />
          </SummaryRow>
        }
      >
        <ManageOnLive href={livePath} what="status, baseline and the deadline history" />
      </CollapsibleSection>
    </div>
  );
}

/* ------------------------------------------------------------------ helpers */

function ToneTag({ tone }: { tone: NaTone }) {
  const map: Record<NaTone, { variant: "pos" | "ink" | "line"; label: string }> = {
    blocked: { variant: "ink", label: "Blocked" },
    action: { variant: "line", label: "To do" },
    at_risk: { variant: "line", label: "Watch" },
    info: { variant: "line", label: "Info" },
    good: { variant: "pos", label: "On track" },
  };
  const t = map[tone];
  return <PremiumPill variant={t.variant}>{t.label}</PremiumPill>;
}

function QueueRow({
  item,
  href,
  last,
}: {
  item: NextActionItem;
  href: string;
  last: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-3 px-5 py-3.5 ${
        last ? "" : "border-b border-[color:var(--line)]"
      }`}
    >
      <ToneTag tone={item.tone} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-[color:var(--ink)]">{item.title}</div>
        <div className="text-xs text-neutral-500">{item.detail}</div>
      </div>
      {item.ctaLabel && (
        <Link href={href} className="btn-secondary !py-1.5 !px-3 !text-xs shrink-0">
          {item.ctaLabel}
        </Link>
      )}
    </div>
  );
}

function ManageOnLive({ href, what }: { href: string; what: string }) {
  return (
    <p className="text-xs text-neutral-500">
      Manage {what} on the{" "}
      <Link href={href} className="text-neutral-800 underline">
        full order page →
      </Link>
    </p>
  );
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function fmtLong(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
}

function fmtMoney(v: number): string {
  if (!Number.isFinite(v) || v === 0) return "0";
  return v.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function relTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "—";
  const s = Math.max(0, (Date.now() - then) / 1000);
  if (s < 90) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
