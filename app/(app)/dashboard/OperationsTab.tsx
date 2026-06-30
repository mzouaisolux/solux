// =====================================================================
// OPERATIONS TAB — restored VERBATIM from the pre-Phase-2 dashboard
// (owner ruling 2026-06-13: "le dashboard opération, je le veux
// exactement comme il était précédemment"). Content order unchanged:
//
//   1. Key numbers strip (4 operational KPI cards)
//   2. Action Center (original sections: Urgent / Waiting for me /
//      Waiting on client / Info to complete — no re-bucketing, no cap)
//   3. Orders in flight (full pills + delays + payment state)
//   4. Business snapshot (compact KPIs, de-prioritised)
//
// Code blocks below are copied from git HEAD's dashboard page; only
// the page-level plumbing (sales ?sales= filter bar) was left behind.
// We'll iterate on what to remove/add WITH the owner, on this base.
// =====================================================================

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import KpiCard from "@/components/dashboard/KpiCard";
import { ActionCenter } from "@/components/action-center/ActionCenter";
import OrdersInFlight, {
  type OrderInFlight,
} from "@/components/dashboard/OrdersInFlight";
import {
  computeProductionDelay,
  computeProductionPaymentState,
  type ProductionOrder,
  type PaymentMode,
  type PaymentTerms,
  type ProductionPaymentState,
} from "@/lib/types";
import { computeOrderPills } from "@/lib/order-pills";
import {
  computeOperationsAlert,
  alertPriorityDesc,
  type OperationsAlert,
} from "@/lib/operations-alerts";
import { applyPOScope } from "@/lib/queries";
import type { ActionCenterData } from "@/lib/action-center";

export async function OperationsTab({ actionData }: { actionData: ActionCenterData }) {
  const supabase = createClient();
  const t = getT();
  const now = new Date();
  const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

  // ---- documents (same lean shape as the old page) ----
  let allDocsQuery = supabase
    .from("documents")
    .select(
      "id, number, total_price, status, currency, date, created_by, client_id, archived_at, affair_name, affair_id"
    )
    // Commercial KPIs (pipeline + won revenue) count QUOTATIONS only — a
    // proforma is the production command, not a deal.
    .eq("type", "quotation")
    .order("date", { ascending: false });
  const { data: allDocsRaw, error: allDocsErr } = await allDocsQuery;
  let allDocs: any[] = allDocsRaw ?? [];
  if (allDocsErr && /archived_at/.test(allDocsErr.message ?? "")) {
    const { data: r2 } = await supabase
      .from("documents")
      .select(
        "id, number, total_price, status, currency, date, created_by, client_id, affair_name, affair_id"
      )
      .eq("type", "quotation")
      .order("date", { ascending: false });
    allDocs = (r2 ?? []).map((d: any) => ({ ...d, archived_at: null }));
  }
  const liveDocs = allDocs.filter((d: any) => !d.archived_at);
  const docs = liveDocs.filter((d: any) => new Date(d.date) >= twelveMonthsAgo);

  // ---- Business snapshot numbers (compact strip at the bottom) ----
  const ninetyDaysAgo = new Date(now);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const livePipelineDocs = liveDocs.filter(
    (d: any) => d.status === "sent" || d.status === "negotiating"
  );
  const livePipelineCount = livePipelineDocs.length;
  const livePipelineValue = livePipelineDocs.reduce(
    (s: number, d: any) => s + Number(d.total_price || 0),
    0
  );
  const liveWon90Revenue = liveDocs
    .filter((d: any) => d.status === "won" && new Date(d.date) >= ninetyDaysAgo)
    .reduce((s: number, d: any) => s + Number(d.total_price || 0), 0);
  const liveLifetimeWonValue = liveDocs
    .filter((d: any) => d.status === "won")
    .reduce((s: number, d: any) => s + Number(d.total_price || 0), 0);

  // ---- Orders in flight ----
  // Won deals now in production. The production task list is created from the
  // PROFORMA, so production_task_lists.quotation_id points at the proforma, NOT
  // the won quotation — matching a task list on the won quote's id therefore
  // never hits (that left this section permanently empty). Join on affair_id
  // instead, which the won quotation (m124) and its task list (F4) both carry.
  // Limit to 5 most-recent so the section stays scannable.
  const wonDocs = (docs ?? []).filter((d) => d.status === "won").slice(0, 20);
  const wonAffairIds = [
    ...new Set(wonDocs.map((d: any) => d.affair_id).filter(Boolean)),
  ] as string[];
  let taskListByAffair = new Map<
    string,
    { id: string; status: any; number: string | null }
  >();
  if (wonAffairIds.length > 0) {
    const { data: tls } = await supabase
      .from("production_task_lists")
      .select("id, affair_id, status, number, date")
      .in("affair_id", wonAffairIds)
      .order("date", { ascending: false });
    for (const t of tls ?? []) {
      if (t.affair_id && !taskListByAffair.has(t.affair_id)) {
        taskListByAffair.set(t.affair_id, {
          id: t.id,
          status: t.status,
          number: t.number,
        });
      }
    }
  }
  const ordersForFlight = wonDocs
    .filter((d: any) => d.affair_id && taskListByAffair.has(d.affair_id))
    .slice(0, 5);
  const flightDocIds = ordersForFlight.map((d: any) => d.id);
  const linesByDoc = new Map<string, { name: string; qty: number }[]>();
  if (flightDocIds.length > 0) {
    const { data: lns } = await supabase
      .from("document_lines")
      .select("document_id, quantity, product_name, products(name)")
      .in("document_id", flightDocIds);
    for (const l of lns ?? []) {
      if (!linesByDoc.has(l.document_id)) linesByDoc.set(l.document_id, []);
      linesByDoc.get(l.document_id)!.push({
        name: (l.products as any)?.name ?? (l as any).product_name ?? "—",
        qty: Number(l.quantity || 0),
      });
    }
  }
  const flightClientIds = Array.from(
    new Set(
      ordersForFlight
        .map((d: any) => d.client_id)
        .filter((x: string | null) => !!x)
    )
  ) as string[];
  const clientByDoc = new Map<
    string,
    { company_name: string; country: string | null; client_code: string | null }
  >();
  if (flightClientIds.length > 0) {
    const { data: cls } = await supabase
      .from("clients")
      .select("id, company_name, country, client_code")
      .in("id", flightClientIds);
    const byId = new Map<string, any>((cls ?? []).map((c: any) => [c.id, c]));
    for (const d of ordersForFlight as any[]) {
      const c = d.client_id ? byId.get(d.client_id) : null;
      if (c) {
        clientByDoc.set(d.id, {
          company_name: c.company_name,
          country: c.country ?? null,
          client_code: c.client_code ?? null,
        });
      }
    }
  }
  const ordersInFlight: OrderInFlight[] = ordersForFlight.map((d: any) => {
    const lines = linesByDoc.get(d.id) ?? [];
    const totalUnits = lines.reduce((s, l) => s + l.qty, 0);
    const firstName = lines[0]?.name ?? "—";
    const summary =
      lines.length === 0
        ? t("oif.no_products")
        : `${firstName}${
            lines.length > 1 ? ` +${lines.length - 1} ${t("common.more")}` : ""
          } · ${totalUnits} ${t("oif.units")}`;
    const tl = taskListByAffair.get(d.affair_id);
    const cl = clientByDoc.get(d.id);
    return {
      doc_id: d.id,
      doc_number: d.number,
      affair_name: d.affair_name ?? null,
      client_name: cl?.company_name ?? "—",
      client_country: cl?.country ?? null,
      client_code: cl?.client_code ?? null,
      product_summary: summary,
      total_value: Number(d.total_price || 0),
      currency: (d.currency as string) ?? "USD",
      task_list_id: tl?.id ?? null,
      task_list_status: tl?.status ?? null,
    };
  });

  // ---- Operational alerts + KPIs ----
  type OpsAlertRow = {
    id: string;
    number: string | null;
    clientName: string;
    docNumber: string | null;
    totalPrice: number;
    currency: string;
    deadline: string | null;
    status: string;
    alert: OperationsAlert;
  };
  const rawOpsBuilder: any = supabase
    .from("production_orders")
    .select(
      `
      *,
      documents:quotation_id(number, total_price, currency, payment_mode, payment_terms),
      clients:client_id(company_name)
      `
    )
    .order("updated_at", { ascending: false });
  const { data: rawOps, error: opsErr } = await applyPOScope(rawOpsBuilder, "active");
  if (opsErr) {
    console.error("[dashboard] production_orders load failed:", opsErr.message);
  }
  const opsAlerts: OpsAlertRow[] = (rawOps ?? []).map((row: any) => {
    const totalPrice = Number(row.documents?.total_price ?? 0);
    const paymentMode = (row.documents?.payment_mode ?? null) as PaymentMode | null;
    const paymentTerms = (row.documents?.payment_terms ?? null) as PaymentTerms | null;
    return {
      id: row.id,
      number: row.number,
      clientName: row.clients?.company_name ?? "—",
      docNumber: row.documents?.number ?? null,
      totalPrice,
      currency: row.documents?.currency ?? "USD",
      deadline: row.current_production_deadline,
      status: row.status,
      alert: computeOperationsAlert({
        order: row as ProductionOrder,
        totalPrice,
        paymentMode,
        paymentTerms,
      }),
    };
  });
  const opsRevenueInProduction = opsAlerts.reduce((s, r) => s + r.totalPrice, 0);
  const opsActiveCount = opsAlerts.length;
  const opsAwaitingDepositCount = opsAlerts.filter(
    (r) => r.alert.level === "awaiting_deposit"
  ).length;
  const opsDelayedCount = opsAlerts.filter(
    (r) => r.alert.level === "delayed" || r.alert.level === "overdue"
  ).length;

  // ---- Enrich ordersInFlight with production_order metadata ----
  type PoMeta = {
    production_order_id: string | null;
    production_status: string | null;
    current_deadline: string | null;
    initial_deadline: string | null;
    actual_completion_date: string | null;
    shipment_booked: boolean | null;
    etd: string | null;
    eta: string | null;
    payment_state: ProductionPaymentState | null;
    balance_reminder_days_before_eta: number | null;
  };
  const poMetaByDocId = new Map<string, PoMeta>();
  for (const r of (rawOps ?? []) as any[]) {
    if (!r.quotation_id) continue;
    const doc = r.documents ?? {};
    const totalPrice = Number(doc.total_price ?? 0);
    const paymentMode = (doc.payment_mode ?? null) as PaymentMode | null;
    const paymentTerms = (doc.payment_terms ?? null) as PaymentTerms | null;
    const paymentState = computeProductionPaymentState({
      totalPrice,
      paymentMode,
      paymentTerms,
      depositReceived: Number(r.deposit_received_amount ?? 0),
      balanceReceived: Number(r.balance_received_amount ?? 0),
    });
    poMetaByDocId.set(r.quotation_id, {
      production_order_id: r.id ?? null,
      production_status: r.status ?? null,
      current_deadline: r.current_production_deadline ?? null,
      initial_deadline: r.initial_production_deadline ?? null,
      actual_completion_date: r.actual_completion_date ?? null,
      shipment_booked: r.shipment_booked ?? null,
      etd: r.etd ?? null,
      eta: r.eta ?? null,
      payment_state: paymentState,
      balance_reminder_days_before_eta: r.balance_reminder_days_before_eta ?? null,
    });
  }
  for (const o of ordersInFlight) {
    const meta = poMetaByDocId.get(o.doc_id);
    if (!meta) continue;
    o.production_order_id = meta.production_order_id;
    o.production_status = meta.production_status;
    o.current_deadline = meta.current_deadline;
    o.actual_completion_date = meta.actual_completion_date;
    o.shipment_booked = meta.shipment_booked;
    o.etd = meta.etd;
    o.eta = meta.eta;
    o.delay_days = computeProductionDelay({
      initial_production_deadline: meta.initial_deadline,
      current_production_deadline: meta.current_deadline,
    });
    if (meta.current_deadline) {
      const d = new Date(meta.current_deadline + "T00:00:00Z").getTime();
      const today = new Date(
        new Date().toISOString().slice(0, 10) + "T00:00:00Z"
      ).getTime();
      if (Number.isFinite(d) && Number.isFinite(today)) {
        o.ending_in_days = Math.round((d - today) / (1000 * 60 * 60 * 24));
      }
    }
    o.pills = computeOrderPills({
      production_status: o.production_status,
      current_deadline: o.current_deadline,
      delay_days: o.delay_days,
      ending_in_days: o.ending_in_days,
      shipment_booked: o.shipment_booked,
      etd: o.etd,
      eta: o.eta,
      actual_completion_date: o.actual_completion_date,
      payment_state: meta.payment_state,
      task_list_status: o.task_list_status,
      balance_reminder_days_before_eta: meta.balance_reminder_days_before_eta,
    });
  }

  // ---- render: the old OperationsSlot, unchanged ----
  return (
    <div className="space-y-6">
      {/* TOP STRIP — operational KPI cards, the 4 numbers an ops
          manager needs to see first thing each morning. */}
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-widerx text-neutral-500 mb-1.5">
          {t("ops.key_numbers")}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label={t("ops.revenue_in_production")}
            value={formatMoney(opsRevenueInProduction)}
            featured
          />
          <KpiCard label={t("ops.active_orders")} value={String(opsActiveCount)} />
          <KpiCard label={t("ops.awaiting_deposit")} value={String(opsAwaitingDepositCount)} />
          <KpiCard label={t("ops.delayed_overdue")} value={String(opsDelayedCount)} />
        </div>
      </div>

      {/* ACTION CENTER — original sections, original ordering. */}
      <ActionCenter data={actionData} />

      {/* ORDERS IN FLIGHT — standalone (own header + chrome). */}
      <OrdersInFlight orders={ordersInFlight} />

      {/* COMPACT KPI SUMMARY — Business KPIs visible but de-prioritised. */}
      <section className="rounded-xl border border-neutral-200/80 bg-neutral-50/30 p-4 space-y-3">
        <div className="text-[10px] font-semibold uppercase tracking-widerx text-neutral-500">
          {t("ops.business_snapshot")}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard label={t("ops.active_pipeline")} value={formatMoney(livePipelineValue)} />
          <KpiCard label={t("ops.active_deals")} value={String(livePipelineCount)} />
          <KpiCard label={t("ops.revenue_90d")} value={formatMoney(liveWon90Revenue)} />
          <KpiCard label={t("ops.lifetime_won")} value={formatMoney(liveLifetimeWonValue)} />
        </div>
        <Link href="/business" className="text-[10px] text-neutral-400 italic block">
          {t("ops.open_business")}
        </Link>
      </section>
    </div>
  );
}

/** Compact "$1.84M" style formatter — used in KPIs + footers. */
function formatMoney(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "$0";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `$${(value / 1_000_000).toLocaleString(undefined, {
      maximumFractionDigits: 2,
    })}M`;
  }
  if (abs >= 1_000) {
    return `$${(value / 1_000).toLocaleString(undefined, {
      maximumFractionDigits: 1,
    })}k`;
  }
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
