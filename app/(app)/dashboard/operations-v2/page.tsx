// =====================================================================
// DASHBOARD · OPERATIONS V2 — affair-centric operational cockpit.
//
// Owner ruling 2026-06-25: Orders in flight IS the centre. The board is
// anchored on the PROFORMA (the command) — the entity that task lists AND
// production orders already key on — so it covers the FULL execution universe:
//
//   task list draft / under_validation / needs_revision / validated
//   → production order (awaiting_deposit → production → shipping → delivered)
//
// This replaces the old "won quotation + task list" source, whose join was
// structurally broken (task lists key on the proforma, not the won quotation
// → it surfaced ~1 of ~15 real affairs). Verified on real data 2026-06-25.
//
// Alerts are ATTRIBUTES of the affair (shown on the card); the Action Center is
// a condensed side summary. ZERO IMPACT: this is its own route; it touches no
// existing file. Reuses the pure engines (flight stage, pills, ops-alert,
// severity) — no new workflow, no new status, no new business logic.
//
// Verify under a REAL operations/TLM login — getOperationsActions is role-
// filtered, so super_admin/View-As shows more action badges than a real user.
// =====================================================================

import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole } from "@/lib/auth";
import { getOperationsActions, type ActionItem } from "@/lib/action-center";
import {
  computeOperationsAlert,
  type OperationsAlert,
} from "@/lib/operations-alerts";
import { computeOrderPills } from "@/lib/order-pills";
import { computeOrderFlightStage } from "@/lib/lifecycle";
import {
  computeProductionDelay,
  computeProductionPaymentState,
  type ProductionOrder,
  type PaymentMode,
  type PaymentTerms,
} from "@/lib/types";
import { deriveOrderSeverity } from "@/lib/order-severity";
import {
  ruleFor,
  categoryTone,
  OPS_FILTER_DIMENSIONS,
  type DashCategory,
} from "@/lib/dashboard-operations-config";
import { resolveUserLabelStrings } from "@/lib/user-display";
import OrdersFilterBar, { type FilterOption } from "@/components/dashboard/OrdersFilterBar";
import KpiCard from "@/components/dashboard/KpiCard";
import OrderInFlightBoardV2, {
  type OrderCardV2,
  type ActionBadge,
} from "@/components/dashboard/OrderInFlightCardV2";
import TodaysWorkBoard, {
  type TodaysWorkGroups,
  type TaskCard,
} from "@/components/dashboard/TodaysWorkBoard";

export const dynamic = "force-dynamic";

// Labels, categories, placement and priorities ALL live in the rulebook
// (lib/dashboard-operations-config) — never hard-coded here. Only the role tag
// shorthand stays local (purely cosmetic).
const ROLE_SHORT: Record<string, string> = {
  sales: "SALES",
  task_list_manager: "TLM",
  operations: "OPS",
  management: "MGMT",
};

const PO_TERMINAL = new Set(["delivered", "cancelled"]);
const IN_PRODUCTION_STATUSES = new Set([
  "production_scheduled",
  "in_production",
  "production_delayed",
]);

export default async function OperationsV2Page({
  searchParams,
}: {
  searchParams?: { owner?: string };
}) {
  const supabase = createClient();
  const { userId, effectiveRole } = await getEffectiveRole();
  const ownerFilter = searchParams?.owner ?? null;

  // ---- ANCHOR: live proformas (the command) ----
  const { data: pfRaw } = await supabase
    .from("documents")
    .select(
      "id, number, total_price, status, currency, date, archived_at, client_id, affair_id, affair_name, payment_mode, payment_terms, created_by, sales_owner_id"
    )
    .eq("type", "proforma")
    .order("date", { ascending: false })
    .limit(200);
  const proformas = (pfRaw ?? [])
    .filter((d: any) => !d.archived_at && d.status !== "cancelled")
    .slice(0, 40);
  const proformaIds = proformas.map((d: any) => d.id);

  // ---- their task list (latest per proforma) ----
  const taskListByPf = new Map<string, { id: string; status: any; number: string | null }>();
  if (proformaIds.length) {
    const { data: tls } = await supabase
      .from("production_task_lists")
      .select("id, quotation_id, status, number, date")
      .in("quotation_id", proformaIds)
      .order("date", { ascending: false });
    for (const t of tls ?? []) {
      if (!taskListByPf.has(t.quotation_id)) {
        taskListByPf.set(t.quotation_id, { id: t.id, status: t.status, number: t.number });
      }
    }
  }

  // ---- their production order (latest per proforma; any status) ----
  const poByPf = new Map<string, any>();
  if (proformaIds.length) {
    const { data: pos } = await supabase
      .from("production_orders")
      .select("*")
      .in("quotation_id", proformaIds)
      .order("updated_at", { ascending: false });
    for (const p of pos ?? []) {
      if (!poByPf.has(p.quotation_id)) poByPf.set(p.quotation_id, p);
    }
  }

  // ---- product lines + clients ----
  const linesByDoc = new Map<string, { name: string; qty: number }[]>();
  if (proformaIds.length) {
    const { data: lns } = await supabase
      .from("document_lines")
      .select("document_id, quantity, product_name, products(name)")
      .in("document_id", proformaIds);
    for (const l of lns ?? []) {
      if (!linesByDoc.has(l.document_id)) linesByDoc.set(l.document_id, []);
      linesByDoc.get(l.document_id)!.push({
        name: (l.products as any)?.name ?? (l as any).product_name ?? "—",
        qty: Number(l.quantity || 0),
      });
    }
  }
  const clientIds = Array.from(
    new Set(proformas.map((d: any) => d.client_id).filter(Boolean))
  ) as string[];
  const clientById = new Map<string, any>();
  if (clientIds.length) {
    const { data: cls } = await supabase
      .from("clients")
      .select("id, company_name, country, client_code")
      .in("id", clientIds);
    for (const c of cls ?? []) clientById.set(c.id, c);
  }

  // ---- Action Center (role-filtered upstream) → indexed by entity ----
  const actionData = await getOperationsActions(userId, effectiveRole);
  const allActions: ActionItem[] = [
    ...actionData.sections.urgent,
    ...actionData.sections.waiting_me,
    ...actionData.sections.waiting_client,
    ...actionData.sections.info_missing,
  ];
  const actionsByEntity = new Map<string, ActionItem[]>();
  for (const it of allActions) {
    const k = `${it.entityType}:${it.entityId}`;
    if (!actionsByEntity.has(k)) actionsByEntity.set(k, []);
    actionsByEntity.get(k)!.push(it);
  }

  // ---- build enriched, severity-ranked affair cards + KPI counters ----
  const ranked: { card: OrderCardV2; rank: number }[] = [];
  let inProduction = 0;
  let delayed = 0;
  let shipmentPending = 0;
  let awaitingDeposit = 0;

  for (const pf of proformas as any[]) {
    const tl = taskListByPf.get(pf.id);
    const po = poByPf.get(pf.id);

    // EXECUTION GATE — Orders in flight is NOT a CRM pipeline. Only affairs
    // that have truly ENTERED production belong here: a production order exists
    // (and isn't closed), or the task list is validated/production_ready (just
    // released). Draft / under_validation / needs_revision are still being
    // prepared — they live in "Today's work" above, never in the cockpit.
    const poStatus0 = po?.status ?? null;
    const poClosed = poStatus0 === "cancelled" || poStatus0 === "delivered";
    const tlReleased = tl?.status === "validated" || tl?.status === "production_ready";
    if (!((po && !poClosed) || (!po && tlReleased))) continue;

    const cl = pf.client_id ? clientById.get(pf.client_id) : null;
    const lines = linesByDoc.get(pf.id) ?? [];
    const totalUnits = lines.reduce((s, l) => s + l.qty, 0);
    const firstName = lines[0]?.name ?? "—";
    const summary =
      lines.length === 0
        ? "No products"
        : `${firstName}${lines.length > 1 ? ` +${lines.length - 1} more` : ""} · ${totalUnits} units`;

    const totalPrice = Number(pf.total_price ?? 0);
    const paymentMode = (pf.payment_mode ?? null) as PaymentMode | null;
    const paymentTerms = (pf.payment_terms ?? null) as PaymentTerms | null;

    const current_deadline = po?.current_production_deadline ?? null;
    const delay_days = computeProductionDelay({
      initial_production_deadline: po?.initial_production_deadline ?? null,
      current_production_deadline: current_deadline,
    });
    let ending_in_days: number | undefined;
    if (current_deadline) {
      const dl = new Date(current_deadline + "T00:00:00Z").getTime();
      const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").getTime();
      if (Number.isFinite(dl) && Number.isFinite(today)) {
        ending_in_days = Math.round((dl - today) / 86_400_000);
      }
    }

    const paymentState = po
      ? computeProductionPaymentState({
          totalPrice,
          paymentMode,
          paymentTerms,
          depositReceived: Number(po.deposit_received_amount ?? 0),
          balanceReceived: Number(po.balance_received_amount ?? 0),
        })
      : null;

    const pills = computeOrderPills({
      production_status: po?.status ?? null,
      current_deadline,
      delay_days,
      ending_in_days,
      shipment_booked: po?.shipment_booked ?? null,
      etd: po?.etd ?? null,
      eta: po?.eta ?? null,
      actual_completion_date: po?.actual_completion_date ?? null,
      payment_state: paymentState,
      task_list_status: tl?.status ?? null,
      balance_reminder_days_before_eta: po?.balance_reminder_days_before_eta ?? null,
    });

    const alert: OperationsAlert | null = po
      ? computeOperationsAlert({ order: po as ProductionOrder, totalPrice, paymentMode, paymentTerms })
      : null;

    const stage = computeOrderFlightStage({
      task_list_id: tl?.id ?? null,
      task_list_status: tl?.status ?? null,
      production_status: po?.status ?? null,
      shipment_booked: po?.shipment_booked ?? null,
      etd: po?.etd ?? null,
      eta: po?.eta ?? null,
      delay_days,
    });

    // attach action-center items by ANY of the affair's related entities
    const keys = [
      po?.id ? `production_order:${po.id}` : null,
      tl?.id ? `task_list:${tl.id}` : null,
      `document:${pf.id}`,
      pf.client_id ? `client:${pf.client_id}` : null,
    ].filter(Boolean) as string[];
    const seen = new Set<string>();
    const acts: ActionItem[] = [];
    for (const k of keys) {
      for (const it of actionsByEntity.get(k) ?? []) {
        if (!seen.has(it.id)) {
          seen.add(it.id);
          acts.push(it);
        }
      }
    }

    // Only signals the rulebook places on the in-flight card (flight | both).
    const flightActs = acts.filter((a) => {
      const p = ruleFor(a.kind).placement;
      return p === "flight" || p === "both";
    });

    const sev = deriveOrderSeverity({
      alertLevel: alert?.level ?? null,
      stageTone: stage.tone,
      pillTones: pills.map((p) => p.tone),
      actionCategories: flightActs.map((a) => ruleFor(a.kind).category),
    });

    const badges: ActionBadge[] = flightActs.map((a) => ({
      id: a.id,
      label: ruleFor(a.kind).label,
      role: a.roles?.[0] ? ROLE_SHORT[a.roles[0]] ?? null : null,
      tone: categoryTone(ruleFor(a.kind).category),
    }));

    // KPI counters — only over LIVE production orders (not delivered/cancelled).
    if (po && !po.archived_at && !PO_TERMINAL.has(po.status)) {
      if (alert?.level === "awaiting_deposit" || po.status === "awaiting_deposit") awaitingDeposit++;
      if (alert?.level === "delayed" || alert?.level === "overdue") delayed++;
      if (IN_PRODUCTION_STATUSES.has(po.status)) inProduction++;
      if (po.status === "production_completed" && !po.shipment_booked) shipmentPending++;
    }

    const card: OrderCardV2 = {
      doc_id: pf.id,
      doc_number: pf.number,
      affair_name: pf.affair_name ?? null,
      client_id: pf.client_id ?? null,
      ownerId: pf.sales_owner_id ?? pf.created_by ?? null,
      client_name: cl?.company_name ?? "—",
      client_country: cl?.country ?? null,
      client_code: cl?.client_code ?? null,
      product_summary: summary,
      total_value: totalPrice,
      currency: (pf.currency as string) ?? "USD",
      task_list_id: tl?.id ?? null,
      task_list_status: tl?.status ?? null,
      production_order_id: po?.id ?? null,
      production_status: po?.status ?? null,
      current_deadline,
      delay_days,
      ending_in_days,
      shipment_booked: po?.shipment_booked ?? null,
      etd: po?.etd ?? null,
      eta: po?.eta ?? null,
      actual_completion_date: po?.actual_completion_date ?? null,
      pills,
      severityTier: sev.tier,
      badges,
    };
    ranked.push({ card, rank: sev.rank });
  }

  ranked.sort((a, b) => b.rank - a.rank || b.card.total_value - a.card.total_value);
  const cards = ranked.map((x) => x.card);

  // ---- filter dimension: by COMMERCIAL (owner). Extensible to team/region
  // via OPS_FILTER_DIMENSIONS. Applies to the board only — Today's Work stays
  // the viewer's own tasks. ----
  const ownerDim = OPS_FILTER_DIMENSIONS.find((d) => d.key === "owner")!;
  const ownerIds = Array.from(new Set(cards.map((c) => c.ownerId).filter(Boolean))) as string[];
  const ownerLabels = ownerIds.length
    ? await resolveUserLabelStrings(ownerIds)
    : new Map<string, string>();
  const ownerCounts = new Map<string, number>();
  for (const c of cards) if (c.ownerId) ownerCounts.set(c.ownerId, (ownerCounts.get(c.ownerId) ?? 0) + 1);
  const ownerOptions: FilterOption[] = [
    { id: null, label: "All", count: cards.length, href: "/dashboard/operations-v2" },
    ...ownerIds
      .map((id) => ({
        id,
        label: ownerLabels.get(id) ?? `User · ${id.slice(0, 4)}`,
        count: ownerCounts.get(id) ?? 0,
        href: `/dashboard/operations-v2?owner=${id}`,
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
  ];
  const visibleCards = ownerFilter ? cards.filter((c) => c.ownerId === ownerFilter) : cards;

  // ---- "Today's work" — the action-center exceptions as 3 task columns.
  // These are the operator's to-dos (incl. PRE-execution prep like validating
  // a task list), distinct from the execution cockpit below.
  const toTask = (it: ActionItem): TaskCard => ({
    id: it.id,
    title: ruleFor(it.kind).label,
    sub: it.subtitle,
    role: it.roles?.[0] ? ROLE_SHORT[it.roles[0]] ?? null : null,
    href: it.href,
    tag: it.tag ?? null,
  });
  // Today's Work = signals the rulebook places in "today" (or "both"), grouped
  // by configured category and ordered by configured priority.
  const todayItems = allActions.filter((a) => {
    const p = ruleFor(a.kind).placement;
    return p === "today" || p === "both";
  });
  const byPriority = (a: ActionItem, b: ActionItem) =>
    ruleFor(b.kind).priority - ruleFor(a.kind).priority;
  const pickCategory = (cat: DashCategory) =>
    todayItems.filter((a) => ruleFor(a.kind).category === cat).sort(byPriority).map(toTask);
  const todaysWork: TodaysWorkGroups = {
    blocked: pickCategory("blocked"),
    action: pickCategory("action_required"),
    risk: pickCategory("at_risk"),
  };

  return (
    <div className="mx-auto max-w-screen-2xl px-6 py-8 space-y-6">
      <div>
        <div className="eyebrow">Operations</div>
        <h1 className="doc-title">Operations cockpit</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Today&apos;s work up top · affairs in execution below.{" "}
          <span className="ml-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
            Prototype · operations-v2
          </span>
        </p>
      </div>

      {/* TOP — what needs doing today (3 task columns). */}
      <TodaysWorkBoard groups={todaysWork} />

      {/* BOTTOM — the full-width execution cockpit. */}
      <section className="space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCard label="Orders in production" value={String(inProduction)} />
          <KpiCard label="Delayed / overdue" value={String(delayed)} />
          <KpiCard label="Shipment pending" value={String(shipmentPending)} />
          <KpiCard label="Awaiting deposit" value={String(awaitingDeposit)} />
        </div>
        {ownerIds.length >= 2 && (
          <OrdersFilterBar
            dimensionLabel={ownerDim.label}
            options={ownerOptions}
            activeId={ownerFilter}
          />
        )}
        <OrderInFlightBoardV2 orders={visibleCards} />
      </section>
    </div>
  );
}
