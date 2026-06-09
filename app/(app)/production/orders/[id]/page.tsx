import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  CollapsibleSection,
  SummaryStat,
  SummaryRow,
} from "@/components/production/CollapsibleSection";
import { PremiumPill } from "@/components/production/premium-ui";
import { getEffectiveRole } from "@/lib/auth";
import { resolveUserLabelStrings } from "@/lib/user-display";
import { ATTACHMENTS_BUCKET } from "@/lib/attachments";
import OrderDocumentsTab, {
  type LogicalDocView,
  type DocVersionView,
  type AuditView,
} from "./OrderDocumentsTab";
import {
  ProductionOrderStatusBadge,
  DelayBadge,
  PaymentStatusBadge,
} from "@/components/ProductionOrderBadges";
import WorkflowStepper, {
  buildLifecycleStages,
} from "@/components/WorkflowStepper";
import {
  PRODUCTION_ORDER_STATUSES,
  PRODUCTION_ORDER_STATUS_LABEL,
  PRODUCTION_PAYMENT_STATE_LABEL,
  computeExpectedBalance,
  computeExpectedDeposit,
  computeProductionDelay,
  computeProductionPaymentState,
  isTechnicalRole,
  type PaymentMode,
  type PaymentTerms,
  type ProductionOrderStatus,
} from "@/lib/types";
import {
  setProductionTimeline,
  updateBalanceReminderOffset,
  updateProductionOrderPayments,
  updateProductionOrderShipment,
  updateProductionOrderStatus,
} from "../actions";
import { addWorkingDays } from "@/lib/working-days";
import { normalizeShippingDetails } from "@/lib/shipping";
import {
  computeDelayBreakdown,
  type DelayType,
} from "@/lib/delays";
import {
  isBaselineLocked,
  getInitialProjectCompletion,
  getProductionStartDate,
  isProductionActive,
  isStartedWithoutDeposit,
  projectCompletionFrom,
  getLifecyclePhase,
} from "@/lib/production-lifecycle";
import {
  computeOperationsAlert,
} from "@/lib/operations-alerts";
import { OperationsAlertBadge } from "@/components/OperationsAlertBadge";
import {
  OrderOperationsStrip,
  type OperationsShippingState,
} from "@/components/production/OrderOperationsStrip";
import { DelayTimelineCard } from "@/components/production/DelayTimelineCard";
import {
  LiveStatusSidebar,
  type StageTone,
} from "@/components/production/LiveStatusSidebar";
import { Timeline } from "@/components/Timeline";
import { CancellationBanner } from "@/components/CancellationBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { listEventsForEntity } from "@/lib/events";
import {
  StartWithoutDepositButton,
  DepositOverrideBadge,
} from "@/components/StartWithoutDepositButton";
import { MarkProductionCompleteButton } from "@/components/MarkProductionCompleteButton";
import { isAdminLike } from "@/lib/types";
import { hasUiCapability } from "@/lib/permissions";
import {
  EventDiscussionPanel,
  parseEventSearchParam,
} from "@/components/dashboard/EventDiscussionPanel";
import { RoleContextBanner } from "@/components/RoleContextBanner";
import { OrderConfigSummary } from "@/components/OrderConfigSummary";
import { ClientBlSummary } from "@/components/clients/ClientBlSummary";

/**
 * Production order detail — operational cockpit for a single order.
 *
 * Visible to: sales (read-only, scoped to their docs), TLM, admin.
 * Editable by: TLM + admin only — forms are simply not rendered for sales.
 */
export default async function ProductionOrderDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { event?: string | string[]; tab?: string };
}) {
  const supabase = createClient();
  const { userId: currentUserId, effectiveRole } = await getEffectiveRole();
  // ?event=<uuid> auto-opens the conversation drawer overlaid on this
  // page — used by the notification bell to land on "PO context +
  // conversation" in one click. Returns null when missing / invalid.
  const eventDiscussionId = parseEventSearchParam(searchParams?.event);
  const technical = isTechnicalRole(effectiveRole);
  const adminLike = isAdminLike(effectiveRole);
  // Capability-driven gating for the deposit-override button. Sales
  // (or any role without the capability) won't even see the button.
  // Backend keeps requireCapability() as the source of truth.
  const canStartWithoutDeposit = await hasUiCapability(
    "production_order.start_without_deposit"
  );
  // Same capability that gates updateProductionOrderStatus + the new
  // markProductionComplete action. We render the Mark Complete CTA only
  // for roles that can actually flip status; sales sees a read-only view.
  const canEditStatus = await hasUiCapability(
    "production_order.edit_status"
  );

  // Selecting `*` instead of an explicit column list — this way the
  // page keeps rendering even if migration 021 (production_validation_date,
  // production_working_days) hasn't been applied yet. PostgREST returns
  // whatever columns exist; missing fields just come back undefined.
  const { data: order, error: orderErr } = await supabase
    .from("production_orders")
    .select(
      "*, documents:quotation_id(id, number, total_price, currency, status, payment_mode, payment_terms, incoterm), clients(company_name, country, client_code, contact_name, bl_profile), task_lists:task_list_id(id, number, status)"
    )
    .eq("id", params.id)
    .maybeSingle();

  if (orderErr) {
    console.error("[production order detail] load failed:", orderErr.message);
    notFound();
  }
  if (!order) notFound();

  // Deadline change history. Tries the full m074 (updated_at / updated_by) +
  // m073 (days_added) + m072 (delay_type) shape first; falls back
  // step-by-step if migrations haven't been applied yet.
  let history: any[] | null = null;
  {
    const full = await supabase
      .from("production_deadline_changes")
      .select(
        "id, previous_date, new_date, days_added, delay_type, reason, changed_by, created_at, updated_at, updated_by"
      )
      .eq("production_order_id", params.id)
      .order("created_at", { ascending: false });
    if (!full.error) {
      history = full.data ?? [];
    } else {
      const m073 = await supabase
        .from("production_deadline_changes")
        .select(
          "id, previous_date, new_date, days_added, delay_type, reason, changed_by, created_at"
        )
        .eq("production_order_id", params.id)
        .order("created_at", { ascending: false });
      if (!m073.error) {
        history = m073.data ?? [];
      } else {
        const m072 = await supabase
          .from("production_deadline_changes")
          .select(
            "id, previous_date, new_date, delay_type, reason, changed_by, created_at"
          )
          .eq("production_order_id", params.id)
          .order("created_at", { ascending: false });
        if (!m072.error) {
          history = m072.data ?? [];
        } else {
          const legacy = await supabase
            .from("production_deadline_changes")
            .select("id, previous_date, new_date, reason, changed_by, created_at")
            .eq("production_order_id", params.id)
            .order("created_at", { ascending: false });
          history = legacy.data ?? [];
        }
      }
    }
  }

  // m072 / m073 — split the total slip into FACTORY vs EXTERNAL so the
  // page surfaces both axes (and the factory KPI stays honest). Each
  // event's contribution comes from `days_added` (authoritative post-m073)
  // with a defensive fallback to (new_date - previous_date).
  const delayBreakdown = computeDelayBreakdown(
    ((history ?? []) as any[]).map((h) => ({
      previous_date: h.previous_date,
      new_date: h.new_date,
      delay_type: h.delay_type ?? null,
      days_added: h.days_added ?? null,
      reason: h.reason ?? null,
      created_at: h.created_at,
    }))
  );

  // Shipping / BL execution details (m070). Normalised so missing/legacy
  // values render as empty inputs (and degrade gracefully without m070).
  const ship = normalizeShippingDetails((order as any).shipping_details);

  const status = order.status as ProductionOrderStatus;

  // Production stage label + tone for the sticky sidebar. Single function so
  // the sidebar and any future surface stay in sync.
  const productionStage: { label: string; tone: StageTone } = (() => {
    switch (status) {
      case "delivered":
        return { label: "Delivered", tone: "emerald" };
      case "shipped":
        return { label: "In transit", tone: "sky" };
      case "shipment_booked":
        return { label: "Shipment booked", tone: "sky" };
      case "production_completed":
        return { label: "Production complete", tone: "emerald" };
      case "in_production":
        return { label: "In production", tone: "amber" };
      case "production_delayed":
        return { label: "Production delayed", tone: "rose" };
      case "deposit_received":
      case "production_scheduled":
        return { label: "Ready to start", tone: "sky" };
      case "awaiting_deposit":
        return { label: "Awaiting deposit", tone: "amber" };
      case "cancelled":
        return { label: "Cancelled", tone: "neutral" };
      default:
        return { label: String(status ?? "—"), tone: "neutral" };
    }
  })();
  const delay = computeProductionDelay({
    initial_production_deadline: order.initial_production_deadline,
    current_production_deadline: order.current_production_deadline,
  });
  // Production Baseline state (m041 + production-lifecycle helpers).
  //   - baselineLocked: whether the Validation Date + Working Days
  //     are read-only (true once the baseline is confirmed).
  //   - productionStartDate: the REAL operational start date — null
  //     until deposit received OR override activated.
  //   - initialProjectCompletion: the FROZEN completion date stamped
  //     at activation. NULL until production starts.
  //   - lifecyclePhase: drives the UI between pre-start / in-production /
  //     completed / closed states (Deliverable C will branch on it).
  const baselineLocked = isBaselineLocked(order as any);
  const productionStartDate = getProductionStartDate(order as any);
  const productionActive = isProductionActive(order as any);
  const startedWithoutDeposit = isStartedWithoutDeposit(order as any);
  const initialProjectCompletion = getInitialProjectCompletion(order as any);
  const lifecyclePhase = getLifecyclePhase(order as any);
  // Pre-activation hint: "if production started today, projected
  // completion would land here". Purely informational — not a
  // commitment until activation freezes it.
  const previewCompletionIfStartingNow = !productionActive
    ? projectCompletionFrom(
        new Date().toISOString().slice(0, 10),
        (order as any).production_working_days
      )
    : null;
  const operationsAlert = computeOperationsAlert({
    order: order as any,
    totalPrice: Number((order.documents as any)?.total_price ?? 0),
    paymentMode: ((order.documents as any)?.payment_mode ?? null) as any,
    paymentTerms: ((order.documents as any)?.payment_terms ?? null) as any,
  });

  // Load operational events for this order — drives the Timeline below.
  const events = await listEventsForEntity("production_order", params.id, 100);

  /* ---- Order configuration summary ----
     Sales (and trackers in general) need a glanceable "what was
     ordered" card without bouncing to the task-list editor. Pull
     the TL lines + product names + sales-visible config fields so
     we can render flat "Label: Value" pairs per line below.

     `config_fields` is filtered to visible_in_task_list AND not
     internal_only — that's the exact set Sales sees on the doc.
     We exclude technical_values and factory_overrides entirely;
     those are operations / factory concerns, not Sales tracking. */
  let configLines: Array<{
    id: string;
    productName: string;
    productSku: string | null;
    quantity: number;
    configEntries: Array<{ label: string; value: string }>;
  }> = [];
  if (order.task_list_id) {
    const [{ data: tlLines }, { data: salesFields }] = await Promise.all([
      supabase
        .from("production_task_list_lines")
        .select(
          "id, quantity, config_values, position, product_name, product_sku, products(name, sku)"
        )
        .eq("task_list_id", order.task_list_id)
        .order("position", { ascending: true }),
      // Pull only the sales-visible field metadata so we know which
      // entries in config_values to render and how to label them.
      supabase
        .from("config_fields")
        .select("field_name, field_scope, internal_only, visible_in_task_list, active")
        .eq("active", true)
        .eq("visible_in_task_list", true),
    ]);
    // Sales-visible field set — `field_scope=technical` OR
    // `internal_only=true` rows are dropped. The PTL screen shows
    // both buckets in separate panels; here we only care about the
    // sales bucket so the card stays compact.
    const salesFieldNames = new Set(
      ((salesFields ?? []) as any[])
        .filter(
          (f) =>
            !f.internal_only &&
            (f.field_scope ?? "sales") !== "technical"
        )
        .map((f) => f.field_name as string)
    );
    configLines = ((tlLines ?? []) as any[]).map((l) => {
      const cv = (l.config_values ?? {}) as Record<string, any>;
      const entries: Array<{ label: string; value: string }> = [];
      for (const [k, v] of Object.entries(cv)) {
        if (!salesFieldNames.has(k)) continue;
        if (v == null || v === "") continue;
        // Pretty-print the field name: "color_temperature" → "Color temperature".
        const label = k
          .replace(/_/g, " ")
          .replace(/\b\w/g, (m) => m.toUpperCase());
        entries.push({ label, value: String(v) });
      }
      return {
        id: l.id,
        productName: (l.products as any)?.name ?? l.product_name ?? "—",
        productSku: (l.products as any)?.sku ?? l.product_sku ?? null,
        quantity: Number(l.quantity ?? 0),
        configEntries: entries,
      };
    });
  }

  // Resolve user labels for both the deadline history AND the timeline.
  // Same best-effort approach as the rest of the app — role + short
  // user id slice.
  const userIds = Array.from(
    new Set([
      ...(history ?? []).map((h: any) => h.changed_by).filter(Boolean),
      ...(history ?? []).map((h: any) => h.updated_by).filter(Boolean),
      ...events.map((e) => e.actor_id).filter(Boolean),
    ])
  ) as string[];
  const labelByUser = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: roles } = await supabase
      .from("user_roles")
      .select("user_id, role")
      .in("user_id", userIds);
    for (const r of roles ?? []) {
      labelByUser.set(
        r.user_id,
        `${r.role} · ${String(r.user_id).slice(0, 8)}`
      );
    }
  }
  function userLabel(uid: string | null | undefined): string {
    if (!uid) return "—";
    return labelByUser.get(uid) ?? uid.slice(0, 8) + "…";
  }

  // ---- Payment math (expected derives from the linked quotation) ----
  const doc = order.documents as any;
  const totalPrice = Number(doc?.total_price ?? 0);
  const paymentMode = (doc?.payment_mode ?? null) as PaymentMode | null;
  const paymentTerms = (doc?.payment_terms ?? null) as PaymentTerms | null;
  const expectedDeposit = computeExpectedDeposit(
    totalPrice,
    paymentMode,
    paymentTerms
  );
  const expectedBalance = computeExpectedBalance(
    totalPrice,
    paymentMode,
    paymentTerms
  );
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
  const currency = (doc?.currency as string) ?? "USD";

  // Single derivation of the live operational state — feeds both the top
  // OrderOperationsStrip and the sticky LiveStatusSidebar so they never drift.
  const liveStatus = {
    initialEta: (order.initial_production_deadline ?? null) as string | null,
    currentEta: (order.current_production_deadline ?? null) as string | null,
    actualCompletion: (order.actual_completion_date ?? null) as string | null,
    factoryDelayDays: delayBreakdown.factoryDays,
    externalDelayDays: delayBreakdown.externalDays,
    latestDelayType: delayBreakdown.latestType,
    paymentState,
    balanceRemaining: Math.max(0, totalPrice - depositReceived - balanceReceived),
    currency,
    daysToEta: (() => {
      const cur = order.current_production_deadline as string | null;
      if (!cur) return null;
      const t0 = Date.parse(
        new Date().toISOString().slice(0, 10) + "T00:00:00Z"
      );
      const t1 = Date.parse(cur + "T00:00:00Z");
      if (!Number.isFinite(t0) || !Number.isFinite(t1)) return null;
      return Math.ceil((t1 - t0) / 86_400_000);
    })(),
    shipping: (status === "delivered"
      ? "delivered"
      : status === "shipped"
      ? "shipped"
      : status === "shipment_booked"
      ? "booked"
      : status === "production_completed" &&
        !(order as any).shipment_booked
      ? "ready_to_ship"
      : status === "cancelled"
      ? "cancelled"
      : "not_started") as OperationsShippingState,
  };

  // ---- Lifecycle stages ----
  const lifecycle = buildLifecycleStages({
    quotationStatus: doc?.status ?? null,
    quotationId: order.quotation_id,
    hasTaskList: !!order.task_list_id,
    taskListStatus: (order.task_lists as any)?.status ?? null,
    taskListId: order.task_list_id,
    productionOrderStatus: status,
    productionOrderId: order.id,
  });

  // ---- Project identity (affair name + sales owner) ----
  // Surfaced prominently in the header so anyone landing on a PO instantly
  // knows WHICH project / customer / sales — never just an abstract number.
  // Fetched defensively: a missing column (pre-m056) leaves the defaults.
  let affairName: string | null = null;
  let salesLabel = "—";
  if (order.quotation_id) {
    try {
      const { data: q } = await supabase
        .from("documents")
        .select("affair_name, created_by")
        .eq("id", order.quotation_id)
        .maybeSingle();
      affairName = ((q as any)?.affair_name as string | null) ?? null;
      let ownerId = (q as any)?.created_by as string | null;
      // Prefer the assigned sales owner (m066) when set — read separately so
      // a missing column can't wipe out the affair name above.
      const { data: ov } = await supabase
        .from("documents")
        .select("sales_owner_id")
        .eq("id", order.quotation_id)
        .maybeSingle();
      const assigned = (ov as any)?.sales_owner_id as string | null;
      if (assigned) ownerId = assigned;
      if (ownerId) {
        const labels = await resolveUserLabelStrings([ownerId]);
        salesLabel = labels.get(ownerId) ?? "—";
      }
    } catch {
      /* keep defaults — never block the page on this */
    }
  }

  // ---- Order Documents hub (m099) — soft-fails to empty pre-migration. ----
  const activeTab = searchParams?.tab === "documents" ? "documents" : "overview";
  const docRows = (
    (
      await supabase
        .from("order_documents")
        .select("*")
        .eq("production_order_id", params.id)
        .order("version", { ascending: false })
    ).data ?? []
  ) as any[];
  const docAuditRows = (
    (
      await supabase
        .from("order_document_audit")
        .select("*")
        .eq("production_order_id", params.id)
        .order("created_at", { ascending: false })
    ).data ?? []
  ) as any[];
  const docUserIds = Array.from(
    new Set([...docRows.map((r) => r.uploaded_by), ...docAuditRows.map((a) => a.actor)].filter(Boolean))
  ) as string[];
  const docUserLabels = docUserIds.length
    ? await resolveUserLabelStrings(docUserIds)
    : new Map<string, string>();
  const docSigned = new Map<string, string>();
  await Promise.all(
    docRows.map(async (r) => {
      const { data } = await supabase.storage.from(ATTACHMENTS_BUCKET).createSignedUrl(r.storage_path, 3600);
      if (data?.signedUrl) docSigned.set(r.id, data.signedUrl);
    })
  );
  const toDocVersion = (r: any): DocVersionView => ({
    id: r.id,
    version: r.version,
    name: r.name,
    size: r.file_size,
    mime: r.mime_type,
    createdAt: r.created_at,
    byLabel: r.uploaded_by ? docUserLabels.get(r.uploaded_by) ?? null : null,
    signedUrl: docSigned.get(r.id) ?? null,
  });
  const docGroups = new Map<string, any[]>();
  for (const r of docRows) {
    const arr = docGroups.get(r.group_id);
    if (arr) arr.push(r);
    else docGroups.set(r.group_id, [r]);
  }
  const activeDocs: LogicalDocView[] = [];
  const archivedDocs: LogicalDocView[] = [];
  for (const [groupId, versions] of docGroups) {
    const sorted = versions.slice().sort((a, b) => b.version - a.version);
    const current = sorted[0];
    const view: LogicalDocView = {
      groupId,
      category: current.category ?? "other",
      current: toDocVersion(current),
      versions: sorted.map(toDocVersion),
    };
    (current.archived_at ? archivedDocs : activeDocs).push(view);
  }
  const docAuditView: AuditView[] = docAuditRows.map((a) => ({
    id: a.id,
    action: a.action,
    fileName: a.file_name,
    byLabel: a.actor ? docUserLabels.get(a.actor) ?? null : null,
    createdAt: a.created_at,
  }));
  const docCount = activeDocs.length;
  const ORDER_TABS: { key: string; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "documents", label: "Documents" },
  ];

  return (
    <div className="po-premium mx-auto max-w-screen-2xl px-6 py-8 space-y-5">
      {/* ---------- TABS (m099) ---------- */}
      <div className="po-tabbar">
        {ORDER_TABS.map((t) => (
          <Link
            key={t.key}
            href={`/production/orders/${params.id}${t.key === "documents" ? "?tab=documents" : ""}`}
            scroll={false}
            className={`po-tab ${activeTab === t.key ? "active" : ""}`}
          >
            {t.label}
            {t.key === "documents" && docCount > 0 ? (
              <span className="po-tab-count">{docCount}</span>
            ) : null}
          </Link>
        ))}
      </div>

      {activeTab === "documents" ? (
        <OrderDocumentsTab
          orderId={params.id}
          active={activeDocs}
          archived={archivedDocs}
          audit={docAuditView}
        />
      ) : (
      <>
      {/* ---------- HEADER ---------- */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="eyebrow">Production order</div>
            <PremiumPill variant={poStatusPillVariant(status)}>
              {PRODUCTION_ORDER_STATUS_LABEL[status]}
              {(order as any).archived_at ? " · archived" : ""}
            </PremiumPill>
            {(order as any).deposit_override_at && (
              <PremiumPill
                variant="line"
                title={(order as any).deposit_override_reason ?? undefined}
              >
                Started w/o deposit
              </PremiumPill>
            )}
            {delay != null && delay > 0 && (
              <PremiumPill
                variant="ink"
                title={`Original deadline pushed back by ${delay} day${
                  delay === 1 ? "" : "s"
                }`}
              >
                ▲ +{delay} day{delay === 1 ? "" : "s"}
              </PremiumPill>
            )}
            {delay === 0 && <PremiumPill variant="pos">On time</PremiumPill>}
            {operationsAlert.level !== "ok" && (
              <PremiumPill variant="ink" title={operationsAlert.message}>
                {operationsAlert.label}
              </PremiumPill>
            )}
          </div>
          {/* Lead with the PROJECT name so the page is instantly
              identifiable; the PO number stays as the technical reference
              right under it. */}
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
          {/* Customer · Sales · linked docs — everything needed to identify
              the deal without opening another page. */}
          <div className="po-metarow mt-4">
            <div>
              <div className="po-k">Client</div>
              <Link
                href={`/clients/${order.client_id}`}
                className="po-v hover:underline"
              >
                {(order.clients as any)?.company_name ?? "—"}
                {(order.clients as any)?.client_code
                  ? ` (${(order.clients as any).client_code})`
                  : ""}
              </Link>
            </div>
            <div>
              <div className="po-k">Sales</div>
              <div className="po-v">{salesLabel}</div>
            </div>
            <div>
              <div className="po-k">Quotation</div>
              <Link
                href={`/documents/${order.quotation_id}`}
                className="po-v num hover:underline"
              >
                {(order.documents as any)?.number ?? "—"}
              </Link>
            </div>
            <div>
              <div className="po-k">Task list</div>
              <Link
                href={`/task-lists/${order.task_list_id}`}
                className="po-v num hover:underline"
              >
                {(order.task_lists as any)?.number ?? "—"}
              </Link>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/production/orders" className="btn-secondary">
            ← All orders
          </Link>
        </div>
      </div>

      {/* ---------- ROLE CONTEXT BANNER ----------
          Diagnostic strip explaining why editing is hidden (when it is)
          and offering a Reset View-As button for super-admins stuck on
          a simulated role. Always renders something — green for
          technical users (reassurance), amber/neutral otherwise. */}
      <RoleContextBanner premium />

      {/* ---------- CANCELLATION BANNER (terminal states only) ---------- */}
      {status === "cancelled" && (
        <CancellationBanner
          tone="critical"
          title="This production order has been cancelled."
          detail="No further operational updates are expected. Refer to the timeline below for details on who cancelled it and when."
        />
      )}
      {status === "delivered" && (
        <CancellationBanner
          tone="muted"
          title="This order has been delivered."
          detail={
            order.actual_completion_date
              ? `Completed on ${order.actual_completion_date}. Workflow closed.`
              : "Workflow closed."
          }
        />
      )}

      {/* ---------- LIFECYCLE STEPPER ---------- */}
      <section className="panel p-4">
        <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
          <div>
            <div className="eyebrow">Order lifecycle</div>
            <p className="text-xs text-neutral-500 mt-0.5">
              From quotation to delivery — click any past stage to jump back.
            </p>
          </div>
        </div>
        <WorkflowStepper stages={lifecycle} premium />
      </section>

      {/* ---------- TOP OPERATIONAL STRIP (m072) ----------
          The single most important read on the page: who owes what
          right now? Five cards — initial ETA, current ETA, delay
          (factory vs external split), payment, shipping.
          Mobile: this strip is the only KPI surface. lg+: the sticky
          sidebar on the right takes over as the operator scrolls. */}
      <OrderOperationsStrip {...liveStatus} />

      {/* ---------- 2-COLUMN COCKPIT (m075) ----------
          Main content on the left, sticky live-status sidebar on the right.
          Single source of truth — both surfaces consume `liveStatus`. The
          sidebar hides on narrow screens; the top strip stays as the
          fallback KPI view. */}
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-[22px]">
        <div className="space-y-6 min-w-0">

      {/* ---------- PRODUCTION (status workflow + baseline) ---------- */}
      <CollapsibleSection
        title="Production"
        attention={status === "production_delayed"}
        attentionLabel="Delayed"
        badge={
          <PremiumPill variant={poStatusPillVariant(status)}>
            {PRODUCTION_ORDER_STATUS_LABEL[status]}
          </PremiumPill>
        }
        summary={
          <SummaryRow>
            <SummaryStat label="Status" value={productionStage.label} />
            <SummaryStat
              label="Start date"
              value={
                productionStartDate
                  ? new Date(productionStartDate).toLocaleDateString("en-GB")
                  : "Pending"
              }
              tone={productionStartDate ? "default" : "warn"}
            />
            <SummaryStat
              label="Working days"
              value={(order as any).production_working_days ?? "—"}
            />
            <SummaryStat
              label="Current ETA"
              value={fmtDate(order.current_production_deadline)}
            />
            <SummaryStat
              label="Completed"
              value={
                order.actual_completion_date
                  ? fmtDate(order.actual_completion_date)
                  : status === "production_completed"
                  ? "Yes"
                  : "No"
              }
              tone={
                order.actual_completion_date || status === "production_completed"
                  ? "success"
                  : "muted"
              }
            />
          </SummaryRow>
        }
      >
        {/* --- Operational status --- */}
        <div className="rounded-lg border border-neutral-200 p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
          <div>
            <div className="eyebrow">Operational status</div>
            <p className="text-xs text-neutral-500 mt-0.5">
              {technical
                ? "Click any chip below to flip the order to that status."
                : "Read-only — only the production team can change status."}
            </p>
          </div>
          <div className="text-[11px] text-neutral-500 text-right">
            Created{" "}
            <b className="text-neutral-700">
              {new Date(order.created_at).toLocaleDateString("en-GB")}
            </b>{" "}
            · Updated{" "}
            <b className="text-neutral-700">
              {new Date(order.updated_at).toLocaleString()}
            </b>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {PRODUCTION_ORDER_STATUSES.map((s) => {
            const isCurrent = s === status;
            if (technical && !isCurrent) {
              return (
                <form
                  key={s}
                  action={updateProductionOrderStatus}
                  className="inline"
                >
                  <input type="hidden" name="id" value={order.id} />
                  <input type="hidden" name="status" value={s} />
                  <SubmitButton
                    variant="secondary"
                    size="sm"
                    pendingLabel={PRODUCTION_ORDER_STATUS_LABEL[s]}
                    className="!rounded-full"
                  >
                    → {PRODUCTION_ORDER_STATUS_LABEL[s]}
                  </SubmitButton>
                </form>
              );
            }
            return (
              <span
                key={s}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium ${
                  isCurrent
                    ? "bg-neutral-900 text-white border border-neutral-900"
                    : "border border-neutral-200 bg-neutral-50 text-neutral-400"
                }`}
              >
                {PRODUCTION_ORDER_STATUS_LABEL[s]}
              </span>
            );
          })}
        </div>
        </div>

        {/* --- Production Baseline --- */}
        <div className="rounded-lg border border-neutral-200 p-4 space-y-4 mt-4">
        {/* Production Baseline — factory commitment + frozen completion. */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="eyebrow">Production Baseline</div>
            <p className="text-xs text-neutral-500 mt-0.5 max-w-2xl">
              Factory commitment. Working days are editable until
              production activates (deposit received or override). At
              activation, the Initial Project Completion freezes and
              becomes the immutable reference for delay tracking.
            </p>
          </div>
          {baselineLocked && (
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-neutral-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-widerx text-neutral-700"
                title={
                  (order as any).baseline_locked_at
                    ? `Locked at ${new Date(
                        (order as any).baseline_locked_at
                      ).toLocaleString()}`
                    : undefined
                }
              >
                <svg
                  className="h-3 w-3"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden
                >
                  <path
                    fillRule="evenodd"
                    d="M10 1a4 4 0 00-4 4v3H5a2 2 0 00-2 2v7a2 2 0 002 2h10a2 2 0 002-2v-7a2 2 0 00-2-2h-1V5a4 4 0 00-4-4zm2 7V5a2 2 0 10-4 0v3h4z"
                    clipRule="evenodd"
                  />
                </svg>
                Locked
                {(order as any).baseline_locked_at && (
                  <span className="ml-1 font-mono normal-case tracking-normal text-neutral-500">
                    {new Date(
                      (order as any).baseline_locked_at
                    ).toLocaleDateString("en-GB")}
                  </span>
                )}
              </span>
              {adminLike && (
                /* Placeholder unlock button — actual action lands in
                   Deliverable D (capability + admin RPC + audit event).
                   For now it's a disabled affordance so the UX is
                   discoverable and admins know the path will open up. */
                <button
                  type="button"
                  disabled
                  title="Admin unlock — coming in the next phase"
                  className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50/40 text-rose-700 px-2 py-1 text-[10px] font-semibold uppercase tracking-widerx opacity-60 cursor-not-allowed"
                >
                  Unlock baseline
                </button>
              )}
            </div>
          )}
        </div>

        {/* Row 1 — Validation Date · Working Days · Production Start Date.
            The first two are the locked commitment; the third reflects
            REAL operational activation. Production Start Date stays
            null/pending until deposit received OR override fires. */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <DeadlineCell
            label="Validation date"
            value={(order as any).production_validation_date}
            muted
          />
          <div className="rounded-lg border border-neutral-200/80 bg-white px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-widerx font-semibold text-neutral-500">
              Working days
            </div>
            <div className="text-base font-bold tabular-nums text-neutral-900 mt-1">
              {(order as any).production_working_days ?? "—"}
            </div>
            {(order as any).production_working_days != null && (
              <div className="text-[10px] text-neutral-500 mt-0.5">
                weekends excluded
              </div>
            )}
          </div>
          <div className="rounded-lg border border-neutral-200/80 bg-white px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-widerx font-semibold text-neutral-500">
              Production start date
            </div>
            {productionStartDate ? (
              <>
                <div className="text-base font-bold tabular-nums text-neutral-900 mt-1">
                  {new Date(productionStartDate).toLocaleDateString("en-GB")}
                </div>
                <div className="text-[10px] text-neutral-500 mt-0.5">
                  {startedWithoutDeposit
                    ? "Started without deposit (admin override)"
                    : "Deposit received"}
                </div>
              </>
            ) : (
              <>
                <div className="text-sm font-semibold text-amber-700 mt-1 flex items-center gap-1.5">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" />
                  Pending
                </div>
                <div className="text-[10px] text-neutral-500 mt-0.5">
                  awaiting deposit or override
                </div>
              </>
            )}
          </div>
        </div>

        {/* Row 2 — Initial Project Completion (large prominent cell).
            This is the FROZEN reference used by delay calculations.
            Pre-activation: explicit "Pending" state with a hint about
            what would happen today. Post-activation: the stamped
            value with a locked badge. */}
        <div
          className={`rounded-lg border px-4 py-3 ${
            productionActive
              ? "border-emerald-200 bg-emerald-50/40"
              : "border-amber-200 bg-amber-50/40"
          }`}
        >
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <div className="text-[10px] uppercase tracking-widerx font-semibold text-neutral-500">
              Initial project completion
            </div>
            {productionActive ? (
              <span className="text-[10px] uppercase tracking-widerx font-semibold text-emerald-700">
                ● Frozen at activation
              </span>
            ) : (
              <span className="text-[10px] uppercase tracking-widerx font-semibold text-amber-700">
                ◌ Pending activation
              </span>
            )}
          </div>
          {initialProjectCompletion ? (
            <div className="text-xl font-bold tabular-nums text-neutral-900 mt-1">
              {new Date(initialProjectCompletion).toLocaleDateString(
                undefined,
                {
                  weekday: "short",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                }
              )}
            </div>
          ) : (
            <div className="mt-1">
              <p className="text-sm font-semibold text-amber-900">
                Waiting for deposit to activate production timeline.
              </p>
              {previewCompletionIfStartingNow && (
                <p className="text-[11px] text-neutral-600 mt-1">
                  If production started today, completion would land
                  around{" "}
                  <b className="text-neutral-800">
                    {new Date(
                      previewCompletionIfStartingNow
                    ).toLocaleDateString("en-GB")}
                  </b>{" "}
                  — purely informational, not committed until activation.
                </p>
              )}
            </div>
          )}
        </div>

        {!baselineLocked && technical && (
          /* Working days edit form — visible until production activates.
             Ops needs to be able to revise the duration commitment for
             commercial communication / planning purposes before deposit
             lands. The lock fires automatically at activation
             (recordPayments / startWithoutDeposit), at which point this
             form disappears and the value becomes read-only.

             A revised working_days BEFORE activation simply updates the
             field — no Initial Project Completion to invalidate yet
             since it hasn't been stamped. */
          <form
            action={setProductionTimeline}
            className="border-t border-neutral-100 pt-4 grid grid-cols-1 md:grid-cols-[160px_1fr_auto] gap-3 items-end"
          >
            <input type="hidden" name="id" value={order.id} />
            <label className="block">
              <span className="label">Working days *</span>
              <input
                type="number"
                name="production_working_days"
                min={0}
                step={1}
                defaultValue={
                  (order as any).production_working_days ?? undefined
                }
                required
                placeholder="e.g. 25"
                className="input"
              />
              <span className="text-[10px] text-neutral-500 mt-1 block">
                Editable until deposit received or override fires.
              </span>
            </label>
            <label className="block">
              <span className="label">Reason (optional)</span>
              <input
                name="reason"
                placeholder="e.g. Updated factory window, supplier ETA"
                className="input"
              />
            </label>
            <SubmitButton variant="primary" pendingLabel="Saving…">
              {(order as any).production_working_days != null
                ? "Update working days"
                : "Save working days"}
            </SubmitButton>
          </form>
        )}
        </div>
      </CollapsibleSection>

      {/* ---------- DELAY & TIMELINE (m075) ---------- */}
      <CollapsibleSection
        title="Delay & timeline"
        attention={delayBreakdown.factoryDays + delayBreakdown.externalDays > 0}
        attentionLabel="Behind schedule"
        badge={
          delay == null ? (
            <PremiumPill variant="line" dot={false}>
              —
            </PremiumPill>
          ) : delay > 0 ? (
            <PremiumPill variant="ink">
              ▲ +{delay} day{delay === 1 ? "" : "s"}
            </PremiumPill>
          ) : (
            <PremiumPill variant="pos">On time</PremiumPill>
          )
        }
        summary={
          <SummaryRow>
            <SummaryStat
              label="Current ETA"
              value={fmtDate(liveStatus.currentEta)}
            />
            <SummaryStat
              emph
              label="Total delay"
              value={`${delayBreakdown.factoryDays + delayBreakdown.externalDays} d`}
            />
            <SummaryStat
              emph
              label="Factory delay"
              value={`${delayBreakdown.factoryDays} d`}
            />
            <SummaryStat
              emph
              label="External delay"
              value={`${delayBreakdown.externalDays} d`}
            />
            <SummaryStat
              label="Last delay reason"
              value={
                history && history[0]?.reason ? String(history[0].reason) : "—"
              }
              tone={history && history[0]?.reason ? "default" : "muted"}
            />
          </SummaryRow>
        }
      >
      {lifecyclePhase === "awaiting_start" &&
        canStartWithoutDeposit &&
        status === "awaiting_deposit" &&
        !(order as any).deposit_override_at && (
          <section className="rounded-xl border border-dashed border-amber-300 bg-amber-50/60 px-4 py-3 flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-widerx text-amber-900 font-semibold">
                Manual exception
              </div>
              <p className="text-xs text-amber-800 mt-0.5 max-w-md">
                For trusted long-term clients — launches production
                immediately and freezes the Initial Project Completion
                from today.
              </p>
            </div>
            <StartWithoutDepositButton orderId={order.id} />
          </section>
        )}
      {lifecyclePhase === "closed" && (
        <section className="rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
          {(order as any).archived_at
            ? "This production order has been archived."
            : "This production order has been cancelled — the deadline is no longer tracked."}
        </section>
      )}
      <DelayTimelineCard
        orderId={order.id}
        initialEta={order.initial_production_deadline ?? null}
        currentEta={order.current_production_deadline ?? null}
        actualCompletion={order.actual_completion_date ?? null}
        breakdown={delayBreakdown}
        events={((history ?? []) as any[]).map((h) => ({
          id: h.id,
          days_added: h.days_added ?? null,
          delay_type: (h.delay_type ?? null) as DelayType | null,
          reason: h.reason ?? null,
          previous_date: h.previous_date ?? null,
          new_date: h.new_date,
          created_at: h.created_at,
          updated_at: h.updated_at ?? null,
          changed_by: h.changed_by ?? null,
          updated_by: h.updated_by ?? null,
        }))}
        lifecyclePhase={lifecyclePhase as any}
        canEditDeadline={technical}
        canMarkComplete={canEditStatus}
        userLabel={userLabel}
      />
      </CollapsibleSection>

      {/* ---------- PAYMENT ---------- */}
      <CollapsibleSection
        title="Payment"
        attention={!productionCanStart && !(order as any).deposit_override_at}
        attentionLabel="Deposit due"
        badge={
          <PremiumPill
            variant={
              paymentState === "awaiting_deposit"
                ? "ink"
                : paymentState === "paid_in_full" ||
                  paymentState === "no_deposit_required" ||
                  paymentState === "deposit_received"
                ? "pos"
                : "line"
            }
          >
            {PRODUCTION_PAYMENT_STATE_LABEL[paymentState]}
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
              label="Deposit recv'd"
              value={`${currency} ${fmtMoney(depositReceived)}`}
            />
            <SummaryStat
              label="Balance remaining"
              value={`${currency} ${fmtMoney(liveStatus.balanceRemaining)}`}
              tone={liveStatus.balanceRemaining > 0 ? "warn" : "success"}
            />
            <SummaryStat
              label="Reminder"
              value={
                (order as any).balance_reminder_days_before_eta != null
                  ? `${(order as any).balance_reminder_days_before_eta}d before ETA`
                  : "—"
              }
            />
          </SummaryRow>
        }
      >
        <p className="text-xs text-neutral-500 mb-3">
          Expected amounts come straight from the quotation's payment terms.
          Record receipts here as they come in — depositing fully auto-advances
          the order to <b>Deposit received</b>.
        </p>

        {/* "Production can start" gating signal + override controls.
            Three states:
              1. Override active     → amber "running without deposit" banner + reason
              2. Deposit terms met   → emerald "can start" banner
              3. Awaiting deposit    → amber "gated" banner + (admin-only) override button
        */}
        {(order as any).deposit_override_at ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs mb-4 space-y-1">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="font-semibold text-amber-900">
                ⚠ Production launched WITHOUT deposit (manual exception)
              </span>
              <DepositOverrideBadge
                activatedAt={(order as any).deposit_override_at}
                reason={(order as any).deposit_override_reason}
              />
            </div>
            <div className="text-[11px] text-amber-800">
              Activated{" "}
              <span className="tabular-nums">
                {new Date(
                  (order as any).deposit_override_at
                ).toLocaleString()}
              </span>{" "}
              by{" "}
              <span className="font-mono">
                {userLabel((order as any).deposit_override_by)}
              </span>
              .
            </div>
            {(order as any).deposit_override_reason && (
              <div className="text-[11px] text-amber-900 italic">
                “{(order as any).deposit_override_reason}”
              </div>
            )}
            <div className="text-[11px] text-amber-800">
              Deposit may still arrive later — record it in the deposit
              block below as usual. The override is logged in the
              activity timeline.
            </div>
          </div>
        ) : productionCanStart ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800 px-3 py-2 text-xs mb-4">
            ✓ Deposit terms met — production can start.
          </div>
        ) : (
          <div className="rounded-md border border-amber-200 bg-amber-50 text-amber-800 px-3 py-2 text-xs mb-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                ⚠ Production is gated on the deposit. Required:{" "}
                <b>
                  {currency} {fmtMoney(expectedDeposit)}
                </b>
                . Received so far:{" "}
                <b>
                  {currency} {fmtMoney(depositReceived)}
                </b>
                .
              </div>
              {/* Admin-only override. Visible only when the order is
                  awaiting deposit, no override is yet active, and we
                  haven't progressed past the deposit gate. */}
              {canStartWithoutDeposit && status === "awaiting_deposit" && (
                <StartWithoutDepositButton orderId={order.id} />
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* DEPOSIT BLOCK */}
          <div className="rounded-md border border-neutral-200/80 bg-neutral-50/40 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-semibold uppercase tracking-widerx text-neutral-700">
                Deposit
              </div>
              {expectedDeposit > 0 ? (
                <ReceiptCoveragePill
                  received={depositReceived}
                  expected={expectedDeposit}
                />
              ) : (
                <span className="text-[10px] uppercase tracking-widerx text-neutral-500 font-semibold">
                  None expected
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <PaymentCell
                label="Expected"
                value={`${currency} ${fmtMoney(expectedDeposit)}`}
                muted
              />
              <PaymentCell
                label="Received"
                value={`${currency} ${fmtMoney(depositReceived)}`}
                success={depositReceived + 0.01 >= expectedDeposit && expectedDeposit > 0}
              />
            </div>
            <div className="text-[11px] text-neutral-500">
              Received on:{" "}
              <b className="font-mono text-neutral-700">
                {fmtDate(order.deposit_received_at)}
              </b>
            </div>
          </div>

          {/* BALANCE BLOCK */}
          <div className="rounded-md border border-neutral-200/80 bg-neutral-50/40 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-semibold uppercase tracking-widerx text-neutral-700">
                Balance
              </div>
              {expectedBalance > 0 ? (
                <ReceiptCoveragePill
                  received={balanceReceived}
                  expected={expectedBalance}
                />
              ) : (
                <span className="text-[10px] uppercase tracking-widerx text-neutral-500 font-semibold">
                  None expected
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <PaymentCell
                label="Expected"
                value={`${currency} ${fmtMoney(expectedBalance)}`}
                muted
              />
              <PaymentCell
                label="Received"
                value={`${currency} ${fmtMoney(balanceReceived)}`}
                success={
                  balanceReceived + 0.01 >= expectedBalance && expectedBalance > 0
                }
              />
            </div>
            <div className="text-[11px] text-neutral-500">
              Received on:{" "}
              <b className="font-mono text-neutral-700">
                {fmtDate(order.balance_received_at)}
              </b>
            </div>
          </div>
        </div>

        {/* Editor — TLM/admin only */}
        {technical && (
          <form
            action={updateProductionOrderPayments}
            className="border-t border-neutral-200 mt-4 pt-4 space-y-3"
          >
            <input type="hidden" name="id" value={order.id} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="block">
                <span className="label">Deposit received ({currency})</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  name="deposit_received_amount"
                  defaultValue={order.deposit_received_amount ?? 0}
                  className="input"
                />
              </label>
              <label className="block">
                <span className="label">Deposit received on</span>
                <input
                  type="date"
                  name="deposit_received_at"
                  defaultValue={order.deposit_received_at ?? undefined}
                  className="input"
                />
              </label>
              <label className="block">
                <span className="label">Balance received ({currency})</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  name="balance_received_amount"
                  defaultValue={order.balance_received_amount ?? 0}
                  className="input"
                />
              </label>
              <label className="block">
                <span className="label">Balance received on</span>
                <input
                  type="date"
                  name="balance_received_at"
                  defaultValue={order.balance_received_at ?? undefined}
                  className="input"
                />
              </label>
            </div>
            <label className="block">
              <span className="label">Payment notes</span>
              <input
                name="payment_notes"
                defaultValue={order.payment_notes ?? ""}
                placeholder="Bank reference, wire id, etc."
                className="input"
              />
            </label>
            <div className="flex items-center justify-end">
              <SubmitButton variant="primary" pendingLabel="Saving…">
                Save payments
              </SubmitButton>
            </div>
          </form>
        )}

        {/* Balance payment reminder (TLM/admin/ops). Sets a per-order
            threshold in DAYS BEFORE ETA. Once the threshold is reached
            and the balance still hasn't been received, "Balance due in
            Nd" pills + cockpit counters fire — proactive instead of
            reactive. NULL = no proactive reminder for this order
            (legacy "balance overdue" still fires after ETA passes). */}
        {technical && (
          <form
            action={updateBalanceReminderOffset}
            className="border-t border-neutral-200 mt-4 pt-4 flex items-end justify-between gap-3 flex-wrap"
          >
            <input type="hidden" name="id" value={order.id} />
            <div>
              <span className="label">Balance reminder offset</span>
              <p className="text-[11px] text-neutral-500 mt-0.5 max-w-md">
                Trigger a "Balance due in Nd" alert this many days
                before ETA. Operations + Sales gain time to push the
                client before shipment is blocked.
              </p>
            </div>
            <div className="flex items-end gap-2">
              <select
                name="balance_reminder_days_before_eta"
                defaultValue={
                  (order as any).balance_reminder_days_before_eta == null
                    ? "none"
                    : String((order as any).balance_reminder_days_before_eta)
                }
                className="input !w-auto"
              >
                <option value="none">No reminder</option>
                <option value="7">7 days before ETA</option>
                <option value="10">10 days before ETA</option>
                <option value="15">15 days before ETA</option>
                <option value="21">21 days before ETA</option>
                <option value="30">30 days before ETA</option>
              </select>
              <SubmitButton
                variant="secondary"
                size="sm"
                pendingLabel="Saving…"
              >
                Save
              </SubmitButton>
            </div>
          </form>
        )}
      </CollapsibleSection>

      {/* ---------- SHIPPING & LOGISTICS (BL summary + shipment) ---------- */}
      <CollapsibleSection
        title="Shipping & logistics"
        attention={status === "production_completed" && !order.shipment_booked}
        attentionLabel="Book shipment"
        badge={
          order.shipment_booked ? (
            <PremiumPill variant="pos">Booked</PremiumPill>
          ) : (
            <PremiumPill variant="line">Not booked</PremiumPill>
          )
        }
        summary={
          <SummaryRow>
            <SummaryStat
              label="Shipment"
              value={order.shipment_booked ? "Booked" : "Not booked"}
              tone={order.shipment_booked ? "success" : "muted"}
            />
            <SummaryStat label="ETD" value={fmtDate(order.etd)} />
            <SummaryStat label="ETA" value={fmtDate(order.eta)} />
            <SummaryStat label="BL number" value={ship.bl_number ?? "—"} />
            <SummaryStat label="Forwarder" value={ship.forwarder ?? "—"} />
            <SummaryStat
              label="Vessel / voyage"
              value={
                [ship.vessel, ship.voyage].filter(Boolean).join(" · ") || "—"
              }
            />
          </SummaryRow>
        }
      >
        {/* SHIP-1 — consignee / notify-party for the BL packet. */}
        <ClientBlSummary
          clientId={(order as any).client_id}
          rawProfile={(order.clients as any)?.bl_profile ?? null}
        />

        {/* --- Shipment --- */}
        <div className="mt-4">
        <p className="text-xs text-neutral-500 mb-3">
          Track booking, departure, arrival, and any logistics notes.
        </p>

        {technical ? (
          <form
            action={updateProductionOrderShipment}
            className="grid grid-cols-1 md:grid-cols-3 gap-3"
          >
            <input type="hidden" name="id" value={order.id} />
            <label className="block md:col-span-3 flex items-center gap-2 cursor-pointer select-none text-sm text-neutral-700">
              <input
                type="checkbox"
                name="shipment_booked"
                defaultChecked={order.shipment_booked}
                className="h-4 w-4 accent-solux"
              />
              Shipment booked
            </label>
            <label className="block">
              <span className="label">ETD (departure)</span>
              <input
                type="date"
                name="etd"
                defaultValue={order.etd ?? undefined}
                className="input"
              />
            </label>
            <label className="block">
              <span className="label">ETA (arrival)</span>
              <input
                type="date"
                name="eta"
                defaultValue={order.eta ?? undefined}
                className="input"
              />
            </label>

            {/* ---- Bill of Lading details (m070) ---- */}
            <div className="md:col-span-3 mt-1 pt-2 border-t border-neutral-100">
              <span className="text-[10px] font-semibold uppercase tracking-widerx text-neutral-500">
                Bill of Lading
              </span>
            </div>
            <label className="block">
              <span className="label">BL number</span>
              <input name="bl_number" defaultValue={ship.bl_number ?? ""} placeholder="e.g. MEDUXX123456" className="input" />
            </label>
            <label className="block">
              <span className="label">Forwarder</span>
              <input name="forwarder" defaultValue={ship.forwarder ?? ""} placeholder="Freight agent" className="input" />
            </label>
            <label className="block">
              <span className="label">HS code</span>
              <input name="hs_code" defaultValue={ship.hs_code ?? ""} placeholder="e.g. 9405.40" className="input" />
            </label>
            <label className="block">
              <span className="label">Vessel</span>
              <input name="vessel" defaultValue={ship.vessel ?? ""} placeholder="Vessel name" className="input" />
            </label>
            <label className="block">
              <span className="label">Voyage</span>
              <input name="voyage" defaultValue={ship.voyage ?? ""} placeholder="Voyage no." className="input" />
            </label>
            <label className="block">
              <span className="label">Packages</span>
              <input type="number" min="0" name="packages" defaultValue={ship.packages ?? ""} placeholder="cartons" className="input" />
            </label>
            <label className="block">
              <span className="label">Gross weight (kg)</span>
              <input type="number" min="0" step="0.01" name="gross_weight" defaultValue={ship.gross_weight ?? ""} className="input" />
            </label>
            <label className="block">
              <span className="label">Net weight (kg)</span>
              <input type="number" min="0" step="0.01" name="net_weight" defaultValue={ship.net_weight ?? ""} className="input" />
            </label>
            <label className="block">
              <span className="label">Volume (CBM)</span>
              <input type="number" min="0" step="0.001" name="cbm" defaultValue={ship.cbm ?? ""} className="input" />
            </label>

            <label className="block md:col-span-3">
              <span className="label">Logistics notes</span>
              <textarea
                name="shipping_notes"
                defaultValue={order.shipping_notes ?? ""}
                rows={2}
                placeholder="Container number, forwarder, milestones, etc."
                className="input"
              />
            </label>
            <div className="md:col-span-3 flex items-center justify-end">
              <SubmitButton variant="primary" pendingLabel="Saving…">
                Save shipment
              </SubmitButton>
            </div>
          </form>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <ReadOnlyField label="ETD (departure)" value={fmtDate(order.etd)} />
            <ReadOnlyField label="ETA (arrival)" value={fmtDate(order.eta)} />
            <ReadOnlyField label="BL number" value={ship.bl_number ?? "—"} />
            <ReadOnlyField label="Forwarder" value={ship.forwarder ?? "—"} />
            <ReadOnlyField
              label="Vessel / voyage"
              value={[ship.vessel, ship.voyage].filter(Boolean).join(" · ") || "—"}
            />
            <ReadOnlyField label="HS code" value={ship.hs_code ?? "—"} />
            <ReadOnlyField
              label="Packages"
              value={ship.packages != null ? String(ship.packages) : "—"}
            />
            <ReadOnlyField
              label="Gross / net (kg)"
              value={
                ship.gross_weight != null || ship.net_weight != null
                  ? `${ship.gross_weight ?? "—"} / ${ship.net_weight ?? "—"}`
                  : "—"
              }
            />
            <ReadOnlyField
              label="Volume (CBM)"
              value={ship.cbm != null ? String(ship.cbm) : "—"}
            />
            <ReadOnlyField
              label="Logistics notes"
              value={order.shipping_notes ?? "—"}
            />
          </div>
        )}
        </div>
      </CollapsibleSection>

      {/* ---------- ORDER DETAILS (value + configuration) ---------- */}
      <CollapsibleSection
        title="Order details"
        summary={
          <SummaryRow>
            <SummaryStat
              label="Quotation value"
              value={`${(order.documents as any)?.currency ?? "USD"} ${Number(
                (order.documents as any)?.total_price ?? 0
              ).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}`}
            />
            <SummaryStat
              label="Quotation"
              value={String((order.documents as any)?.status ?? "—").toUpperCase()}
            />
            <SummaryStat
              label="Task list"
              value={String((order.task_lists as any)?.status ?? "—")
                .replace(/_/g, " ")
                .toUpperCase()}
            />
            <SummaryStat label="Lines" value={configLines.length || "—"} />
          </SummaryRow>
        }
      >
        <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <KpiTile
          label="Quotation value"
          value={`${(order.documents as any)?.currency ?? "USD"} ${Number(
            (order.documents as any)?.total_price ?? 0
          ).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}`}
        />
        <KpiTile
          label="Quotation status"
          value={
            ((order.documents as any)?.status ?? "—")
              .toString()
              .toUpperCase()
          }
        />
        <KpiTile
          label="Task list status"
          value={
            ((order.task_lists as any)?.status ?? "—")
              .toString()
              .replace(/_/g, " ")
              .toUpperCase()
          }
        />
      </section>

      {/* ---------- ORDER CONFIGURATION SUMMARY ----------
          Read-only "what was ordered" card. Sales (and any tracker)
          can see CCT / optic / bracket / quantities at a glance
          without bouncing to the task-list editor. Hides itself
          when there are no lines to show. */}
      <OrderConfigSummary
        lines={configLines}
        taskListId={order.task_list_id}
        taskListNumber={(order.task_lists as any)?.number ?? null}
      />
      </CollapsibleSection>

      {/* ---------- ACTIVITY TIMELINE ---------- */}
      <CollapsibleSection
        title="Activity timeline"
        badge={
          <span className="inline-flex items-center rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[11px] font-medium text-neutral-600 tabular-nums">
            {events.length} event{events.length === 1 ? "" : "s"}
          </span>
        }
        summary={
          <SummaryRow>
            <SummaryStat label="Events" value={events.length} />
            <SummaryStat
              label="Last activity"
              value={
                events[0]?.created_at
                  ? new Date(events[0].created_at).toLocaleString()
                  : "—"
              }
            />
            <SummaryStat
              label="Last update"
              value={new Date(order.updated_at).toLocaleString()}
            />
          </SummaryRow>
        }
      >
        <p className="text-xs text-neutral-500 mb-4 max-w-2xl">
          Every status change, deadline shift, deposit receipt and shipment
          update — newest first. The actor + timestamp on each row makes
          operational changes auditable across teams.
        </p>
        <Timeline events={events} actorLabelByUser={labelByUser} />
      </CollapsibleSection>

        </div>
        {/* Sticky live-status sidebar — lg+ only. Mirrors the top strip
            data via the shared `liveStatus` derivation; pure presentation. */}
        <div className="hidden lg:block">
          <LiveStatusSidebar
            {...liveStatus}
            productionStage={productionStage}
          />
        </div>
      </div>

      {/* Conversation drawer — overlaid on top of this page when the
          URL carries ?event=<id>. Lets notifications land on PO
          context + conversation thread in one click. Safety check:
          the event must belong to this PO (expectedEntityId). */}
      <EventDiscussionPanel
        eventId={eventDiscussionId}
        expectedEntityId={order.id}
        currentUserId={currentUserId ?? null}
      />
      </>
      )}
    </div>
  );
}

/**
 * Map a production-order status to a disciplined premium pill variant
 * (brief §6): ink = needs attention, line = terminal/neutral, pos =
 * active/progressing/done. Purely presentational — the status value and
 * its label are unchanged.
 */
function poStatusPillVariant(
  status: ProductionOrderStatus
): "pos" | "ink" | "line" {
  switch (status) {
    case "production_delayed":
    case "awaiting_deposit":
      return "ink";
    case "cancelled":
      return "line";
    default:
      return "pos";
  }
}

function DeadlineCell({
  label,
  value,
  muted,
  warn,
  success,
}: {
  label: string;
  value: string | null;
  muted?: boolean;
  warn?: boolean;
  success?: boolean;
}) {
  const valueClass = warn
    ? "text-red-700"
    : success
    ? "text-emerald-700"
    : muted
    ? "text-neutral-600"
    : "text-neutral-900";
  return (
    <div className="rounded-md border border-neutral-200/80 bg-neutral-50/50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-widerx text-neutral-500 font-semibold">
        {label}
      </div>
      <div className={`mt-1 text-sm font-mono font-semibold ${valueClass}`}>
        {fmtDate(value)}
      </div>
    </div>
  );
}

function KpiTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel p-4">
      <div className="eyebrow">{label}</div>
      <div className="mt-1 text-lg font-bold tabular-nums tracking-tight text-neutral-900">
        {value}
      </div>
    </div>
  );
}

function ReadOnlyField({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-widerx text-neutral-500 font-semibold">
        {label}
      </div>
      <div className="mt-1 text-sm text-neutral-800">{value}</div>
    </div>
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

function fmtMoney(v: number): string {
  if (!Number.isFinite(v) || v === 0) return "0";
  return v.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function PaymentCell({
  label,
  value,
  muted,
  success,
}: {
  label: string;
  value: string;
  muted?: boolean;
  success?: boolean;
}) {
  const valueClass = success
    ? "text-emerald-700"
    : muted
    ? "text-neutral-700"
    : "text-neutral-900";
  return (
    <div className="rounded border border-neutral-200/80 bg-white px-3 py-2">
      <div className="text-[10px] uppercase tracking-widerx text-neutral-500 font-semibold">
        {label}
      </div>
      <div className={`mt-1 text-sm font-bold tabular-nums ${valueClass}`}>
        {value}
      </div>
    </div>
  );
}

/**
 * Final-delay summary for the completed phase. Renders a short
 * "on time" / "X day(s) late" / "X day(s) ahead" sentence based on
 * (actual_completion_date − initial_production_deadline). Used inside
 * the green completion banner.
 *
 * Pure render — same delta is computed (and persisted) in
 * `markProductionComplete`'s emitted event payload, so this is purely
 * a UI mirror.
 */
function CompletionDelaySummary({
  initial,
  actual,
}: {
  initial: string;
  actual: string;
}) {
  const initialMs = new Date(initial).getTime();
  const actualMs = new Date(actual).getTime();
  if (!Number.isFinite(initialMs) || !Number.isFinite(actualMs)) {
    return null;
  }
  const days = Math.round((actualMs - initialMs) / (1000 * 60 * 60 * 24));
  const label =
    days === 0
      ? "On time vs. baseline"
      : days > 0
      ? `${days} day${days === 1 ? "" : "s"} late vs. baseline`
      : `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ahead of baseline`;
  const tone =
    days <= 0
      ? "text-emerald-800"
      : days <= 7
      ? "text-amber-800"
      : "text-rose-800";
  return (
    <p className={`text-xs mt-1 font-medium ${tone}`}>
      {label}.{" "}
      <span className="font-normal text-neutral-600">
        Baseline {fmtDate(initial)} · Actual {fmtDate(actual)}.
      </span>
    </p>
  );
}

function ReceiptCoveragePill({
  received,
  expected,
}: {
  received: number;
  expected: number;
}) {
  if (expected <= 0) return null;
  const pct = Math.min(100, Math.round((received / expected) * 100));
  const tone =
    pct >= 100
      ? "bg-emerald-50 border-emerald-200 text-emerald-700"
      : pct > 0
      ? "bg-amber-50 border-amber-200 text-amber-800"
      : "bg-neutral-50 border-neutral-200 text-neutral-500";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold tabular-nums ${tone}`}
    >
      {pct}% received
    </span>
  );
}
