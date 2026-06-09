import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole } from "@/lib/auth";
import { MyRemindersPanel } from "@/components/reminders/MyRemindersPanel";
import { ForecastStrip } from "@/components/forecast/ForecastStrip";
import { ManagementForecastPanel } from "@/components/forecast/ManagementForecastPanel";
import {
  OperationsCockpit,
  type OperationsCockpitData,
} from "@/components/dashboard/OperationsCockpit";
import { SalesFilterBar } from "@/components/dashboard/SalesFilterBar";
import {
  parseSalesFilterParam,
  resolveEffectiveSalesScope,
  getSalesUsersForFilter,
  getDocIdsOwnedBySales,
} from "@/lib/sales-filter";
import KpiCard from "@/components/dashboard/KpiCard";
import { ActionCenter } from "@/components/action-center/ActionCenter";
import { ProjectActionsWidget } from "@/components/projects/ProjectActionsWidget";
import { getOperationsActions } from "@/lib/action-center";
import PipelineChart, {
  type MonthBucket,
} from "@/components/dashboard/PipelineChart";
import WinRateDonut from "@/components/dashboard/WinRateDonut";
import OrdersInFlight, {
  type OrderInFlight,
} from "@/components/dashboard/OrdersInFlight";
import ActivityFeed, {
  relativeTime,
  type ActivityEvent,
} from "@/components/dashboard/ActivityFeed";
import {
  isTechnicalRole,
  computeExpectedDeposit,
  computeExpectedBalance,
  computeProductionDelay,
  computeProductionPaymentState,
  type DocStatus,
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
import { OperationsAlertBadge } from "@/components/OperationsAlertBadge";
import {
  listRecentCriticalEvents,
  SEVERITY_PILL,
  eventTypeLabel,
} from "@/lib/events";
import { applyPOScope } from "@/lib/queries";
import { hasUiCapability } from "@/lib/permissions";
import {
  DashboardModeProvider,
  DashboardModeToggle,
  BusinessSlot,
  OperationsSlot,
} from "@/components/dashboard/DashboardModeShell";
// `OperationsFeed` was the v2 vertical feed component; the OperationsSlot
// now uses `OperationsCockpit` (4-card command center) instead. The full
// feed component itself lives on at /operations for users who want to
// drill down into the raw event log.
import {
  listOperationsFeed,
  getUnreadCommentCountsForUser,
} from "@/lib/events";

/**
 * Home dashboard — premium SaaS overview for the signed-in user.
 *
 * Sales: scoped to their own quotations.
 * Admin / TLM: company-wide.
 *
 * Server-rendered end-to-end; charts are inline SVG. No client JS beyond
 * the existing Nav switcher.
 */
export default async function HomeDashboardPage({
  searchParams,
}: {
  searchParams?: { sales?: string | string[] };
}) {
  const supabase = createClient();
  const { userId, effectiveRole } = await getEffectiveRole();
  const global = isTechnicalRole(effectiveRole);
  // Action Center — operational priorities derived live from current state.
  // Replaces the category-grouped cockpit (Critical/Production/Payments/
  // Quotations) with urgency- + role-aggregated actions. Visibility-scoped.
  const actionData = await getOperationsActions(userId, effectiveRole);
  const scopedToMe = !global;

  /* ---- Sales filter (m047 + sales-filter helpers) ----
     Only technical roles can request a sales filter. Sales users
     are already RLS-scoped to themselves; the filter has no meaning
     for them. The effective scope drives every doc / PO / event /
     reminder query below: when set, the page renders "view as data
     of <sales user>". */
  const requestedSalesFilter = global
    ? parseSalesFilterParam(searchParams?.sales)
    : null;
  const effectiveSalesScope = resolveEffectiveSalesScope({
    userId,
    scopedToMe,
    requestedSalesId: requestedSalesFilter,
  });
  // Doc IDs owned by the target sales — used to filter dependent
  // tables (production_orders, events, reminders) when a technical
  // user has picked a specific sales rep. NULL = no narrowing.
  const targetSalesDocIds = await getDocIdsOwnedBySales(
    requestedSalesFilter
  );
  // Hide "+ New quotation" button for roles that lack quotation.create.
  // Uses hasUiCapability so View-As correctly hides it in simulation.
  const canCreateQuotation = await hasUiCapability("quotation.create");
  // Management forecast block vs personal strip — matrix-managed +
  // View-As faithful (m053 forecast.view_global).
  const canViewGlobalForecast = await hasUiCapability("forecast.view_global");

  // ---- Auth header (greeting + name) ----
  const { data: { user } } = await supabase.auth.getUser();
  const greetingName = user?.email
    ? user.email
        .split("@")[0]
        .replace(/[._-]+/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
    : "there";

  // ---- Time windows ----
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(
    now.getFullYear(),
    now.getMonth(),
    0,
    23,
    59,
    59
  );
  const twelveMonthsAgo = new Date(
    now.getFullYear(),
    now.getMonth() - 11,
    1
  );

  // ---- SINGLE consolidated documents query (source of truth) ----
  //
  // History
  // -------
  // Previously the dashboard ran TWO queries against `documents`:
  //   1. `docs` — 12-month window WITH a `clients(...)` PostgREST embed
  //              for ordersInFlight metadata.
  //   2. `liveDocs` — no date filter, lean shape (no embed).
  //
  // In production, query #1 was returning ZERO rows silently — likely
  // because the embedded `clients(...)` resource failed (FK metadata
  // mismatch / PostgREST schema cache miss) and the whole query
  // got dropped with `data: null`. ALL the MTD KPIs, the 12-month
  // chart, the win-rate donut, and the quarterly stats derive from
  // `docs` and were therefore stuck at 0 even though the user had
  // 25 docs / $5.4M in the current month (confirmed by direct SQL).
  // Meanwhile query #2 worked, so the "Current state" cards we added
  // showed the real $5.41M. The asymmetry was the smoking gun.
  //
  // The fix is structural: ONE query, no embed. We pull every column
  // we need across the dashboard, then derive both the 12-month and
  // the live slices in memory. ordersInFlight gets its client names
  // via a separate small batched lookup below (max 5 rows, cheap).
  // Single read = no silent half-failures.
  //
  // We also log the error visibly so a future regression on this
  // table doesn't disappear into a 0-everywhere dashboard.
  // IMPORTANT: the `documents` table has NO `created_at` column. The
  // canonical "when was this doc created" timestamp is `date` (defaults
  // to now() in the table). Earlier versions of this page selected
  // `created_at` anyway — PostgREST rejects the whole query with
  // "column documents.created_at does not exist" and the dashboard
  // ends up showing 0 for every KPI. This was the silent regression
  // the new error banner finally surfaced.
  let allDocsQuery = supabase
    .from("documents")
    .select(
      "id, number, total_price, status, currency, date, created_by, client_id, archived_at, affair_name"
    )
    .order("date", { ascending: false });
  if (effectiveSalesScope) allDocsQuery = allDocsQuery.eq("created_by", effectiveSalesScope);
  const { data: allDocsRaw, error: allDocsErr } = await allDocsQuery;
  if (allDocsErr) {
    console.error("[dashboard] documents query failed:", allDocsErr.message);
  }
  // Defensive: drop archived_at column if it doesn't exist yet (older DB).
  let allDocs: any[] = allDocsRaw ?? [];
  if (allDocsErr && /archived_at/.test(allDocsErr.message ?? "")) {
    let retry = supabase
      .from("documents")
      .select(
        "id, number, total_price, status, currency, date, created_by, client_id, affair_name"
      )
      .order("date", { ascending: false });
    if (effectiveSalesScope) retry = retry.eq("created_by", effectiveSalesScope);
    const { data: r2 } = await retry;
    allDocs = (r2 ?? []).map((d: any) => ({ ...d, archived_at: null }));
  }

  // `liveDocs` = every non-archived doc (no date filter). Used by the
  // "Current state" KPI strip and any all-time aggregate.
  const liveDocs = allDocs.filter((d: any) => !d.archived_at);

  // `docs` = the 12-month subset, derived in memory. Used by the MTD
  // KPIs, the 12-month chart, the win-rate donut. Same shape as
  // before the refactor so downstream code keeps working unchanged.
  const docs = liveDocs.filter(
    (d: any) => new Date(d.date) >= twelveMonthsAgo
  );

  // 90-day window for recent revenue / avg deal — independent of the
  // calendar month so it doesn't snap to zero at every month rollover.
  const ninetyDaysAgo = new Date(now);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  // Pipeline value = active sales (sent + negotiating). NOT calendar
  // bounded — backdated quotes still count if they're still open.
  const livePipelineDocs = liveDocs.filter(
    (d: any) => d.status === "sent" || d.status === "negotiating"
  );
  const livePipelineCount = livePipelineDocs.length;
  const livePipelineValue = livePipelineDocs.reduce(
    (s: number, d: any) => s + Number(d.total_price || 0),
    0
  );

  // Won deals in the last 90 days. Uses `date` for now because that's
  // what we have — if/when we add a `won_at` column we'll switch.
  const liveWon90 = liveDocs.filter(
    (d: any) =>
      d.status === "won" && new Date(d.date) >= ninetyDaysAgo
  );
  const liveWon90Revenue = liveWon90.reduce(
    (s: number, d: any) => s + Number(d.total_price || 0),
    0
  );
  const liveWon90Count = liveWon90.length;
  const liveWon90AvgDeal = liveWon90Count > 0 ? liveWon90Revenue / liveWon90Count : 0;

  // Lifetime won value (all-time, irrespective of date). Lets the
  // user sanity-check the totals when test data spans years.
  const liveLifetimeWonValue = liveDocs
    .filter((d: any) => d.status === "won")
    .reduce((s: number, d: any) => s + Number(d.total_price || 0), 0);
  const liveLifetimeWonCount = liveDocs.filter((d: any) => d.status === "won").length;

  // ---- KPI math ----
  type Bucket = { count: number; won: number; revenue: number };
  const byMonth = new Map<string, Bucket>();
  for (const d of docs ?? []) {
    const date = new Date(d.date);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const b = byMonth.get(key) ?? { count: 0, won: 0, revenue: 0 };
    b.count++;
    if (d.status === "won") {
      b.won++;
      b.revenue += Number(d.total_price || 0);
    }
    byMonth.set(key, b);
  }
  // Fill the 12-month series
  const monthlyData: MonthBucket[] = [];
  const sparkSent: number[] = [];
  const sparkConv: number[] = [];
  const sparkRevenue: number[] = [];
  const sparkAvg: number[] = [];
  for (let i = 11; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const b = byMonth.get(key) ?? { count: 0, won: 0, revenue: 0 };
    monthlyData.push({
      label: date.toLocaleDateString("en", { month: "short" }),
      key,
      total: b.count,
      won: b.won,
    });
    sparkSent.push(b.count);
    sparkConv.push(b.count > 0 ? (b.won / b.count) * 100 : 0);
    sparkRevenue.push(b.revenue);
    sparkAvg.push(b.won > 0 ? b.revenue / b.won : 0);
  }

  // Period helpers
  const mtdDocs = (docs ?? []).filter((d) => new Date(d.date) >= monthStart);
  const lastMonthDocs = (docs ?? []).filter((d) => {
    const dt = new Date(d.date);
    return dt >= lastMonthStart && dt <= lastMonthEnd;
  });

  const mtdSent = mtdDocs.length;
  const lastSent = lastMonthDocs.length;
  const sentChange =
    lastSent > 0 ? ((mtdSent - lastSent) / lastSent) * 100 : null;

  const mtdWon = mtdDocs.filter((d) => d.status === "won").length;
  const mtdConv = mtdSent > 0 ? (mtdWon / mtdSent) * 100 : 0;
  const lastConv =
    lastSent > 0
      ? (lastMonthDocs.filter((d) => d.status === "won").length / lastSent) * 100
      : 0;
  const convChange = lastSent > 0 ? mtdConv - lastConv : null;

  const mtdRevenue = mtdDocs
    .filter((d) => d.status === "won")
    .reduce((s, d) => s + Number(d.total_price || 0), 0);
  const lastRevenue = lastMonthDocs
    .filter((d) => d.status === "won")
    .reduce((s, d) => s + Number(d.total_price || 0), 0);
  const revenueChange =
    lastRevenue > 0 ? ((mtdRevenue - lastRevenue) / lastRevenue) * 100 : null;

  const mtdAvgDeal = mtdWon > 0 ? mtdRevenue / mtdWon : 0;
  const lastWonCount = lastMonthDocs.filter((d) => d.status === "won").length;
  const lastAvgDeal = lastWonCount > 0 ? lastRevenue / lastWonCount : 0;
  const avgChange =
    lastAvgDeal > 0
      ? ((mtdAvgDeal - lastAvgDeal) / lastAvgDeal) * 100
      : null;

  // ---- 12-month totals (pipeline footer) ----
  const total12 = (docs ?? []).length;
  const won12 = (docs ?? []).filter((d) => d.status === "won").length;
  const winRate12 = total12 > 0 ? (won12 / total12) * 100 : 0;
  const totalValue12 = (docs ?? [])
    .filter((d) => d.status === "won")
    .reduce((s, d) => s + Number(d.total_price || 0), 0);

  // ---- Win rate (quarter-to-date) ----
  const quarterMonth = Math.floor(now.getMonth() / 3) * 3;
  const quarterStart = new Date(now.getFullYear(), quarterMonth, 1);
  const qDocs = (docs ?? []).filter(
    (d) => new Date(d.date) >= quarterStart
  );
  const qSent = qDocs.length;
  const qWon = qDocs.filter((d) => d.status === "won").length;
  const qLost = qDocs.filter((d) => d.status === "lost").length;
  const qWinRate =
    qSent > 0 ? (qWon / qSent) * 100 : 0;
  const qLabel = `Q${Math.floor(now.getMonth() / 3) + 1} ${now.getFullYear()}`;

  // ---- Orders in flight ----
  // Won documents with their (most recent) task list. Limit to 5 most-recent
  // so the section stays scannable.
  const wonDocs = (docs ?? []).filter((d) => d.status === "won").slice(0, 20);
  const wonDocIds = wonDocs.map((d) => d.id);
  let taskListByDoc = new Map<
    string,
    { id: string; status: any; number: string | null }
  >();
  if (wonDocIds.length > 0) {
    const { data: tls } = await supabase
      .from("production_task_lists")
      .select("id, quotation_id, status, number, date")
      .in("quotation_id", wonDocIds)
      .order("date", { ascending: false });
    for (const t of tls ?? []) {
      if (!taskListByDoc.has(t.quotation_id)) {
        taskListByDoc.set(t.quotation_id, {
          id: t.id,
          status: t.status,
          number: t.number,
        });
      }
    }
  }
  // Pull line summaries for the orders-in-flight rows
  const ordersForFlight = wonDocs
    .filter((d: any) => taskListByDoc.has(d.id))
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
  // Client metadata for ordersInFlight — fetched as a separate small
  // batched query instead of embedded in the main documents SELECT.
  // This avoids the PostgREST embed-failure mode that previously
  // dropped the whole `docs` query when the FK metadata was stale.
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
    const byId = new Map<string, any>(
      (cls ?? []).map((c: any) => [c.id, c])
    );
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
        ? "No products"
        : `${firstName}${
            lines.length > 1 ? ` +${lines.length - 1} more` : ""
          } · ${totalUnits} units`;
    const tl = taskListByDoc.get(d.id);
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

  // ---- Operational alerts + KPIs ---------------------------------------
  // Pull every non-terminal production order this user can see. RLS does
  // the scoping (sales → their docs only; technical → all).
  //
  // IMPORTANT: previously this query was unscoped AND the resulting
  // widget was hidden via `(totalAlertingCount > 0 || opsAlerts.length > 0)`
  // — when there were zero rows the entire section disappeared, giving
  // the impression the dashboard was "empty/disconnected". The widget
  // is now ALWAYS rendered (with an empty-state copy) so the user
  // sees what's happening even when nothing is alarming.
  //
  // Use `*` so the SELECT keeps working even if migration 021 columns
  // (production_validation_date / production_working_days) aren't
  // applied yet.
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
  // Dashboard shows the operational state of "live" production. We
  // route through applyPOScope("active") so the definition of "live"
  // matches /operations, /order-follow-up, /business — single source
  // of truth in lib/queries.ts.
  // When a technical user has picked a specific sales rep via ?sales=,
  // narrow the PO query to that rep's quotations. Sales users are
  // already RLS-scoped to their own data — no extra filter needed.
  let rawOpsBuilder: any = supabase
    .from("production_orders")
    .select(
      `
      *,
      documents:quotation_id(number, total_price, currency, payment_mode, payment_terms),
      clients:client_id(company_name)
      `
    )
    .order("updated_at", { ascending: false });
  if (requestedSalesFilter && targetSalesDocIds !== null) {
    if (targetSalesDocIds.length > 0) {
      rawOpsBuilder = rawOpsBuilder.in("quotation_id", targetSalesDocIds);
    } else {
      // Target sales has zero docs → force empty result.
      rawOpsBuilder = rawOpsBuilder.eq(
        "id",
        "00000000-0000-0000-0000-000000000000"
      );
    }
  }
  const { data: rawOps, error: opsErr } = await applyPOScope(
    rawOpsBuilder,
    "active"
  );
  if (opsErr) {
    // Don't crash the dashboard — log + show empty state. This is the
    // exact failure mode we silently shipped before; surfacing it makes
    // missing migrations / RLS bugs obvious.
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
  const alertingRows = opsAlerts
    .filter((r) => r.alert.level !== "ok")
    .sort((a, b) => alertPriorityDesc(a.alert, b.alert))
    .slice(0, 5);
  const totalAlertingCount = opsAlerts.filter((r) => r.alert.level !== "ok").length;

  // ---- Real operational KPIs (drive the new "Operations" KPI tile) -----
  const opsRevenueInProduction = opsAlerts.reduce(
    (s, r) => s + r.totalPrice,
    0
  );
  const opsActiveCount = opsAlerts.length;
  const opsAwaitingDepositCount = opsAlerts.filter(
    (r) => r.alert.level === "awaiting_deposit"
  ).length;
  const opsDelayedCount = opsAlerts.filter(
    (r) => r.alert.level === "delayed" || r.alert.level === "overdue"
  ).length;

  /* ---------------------------------------------------------------------------
     Enrich `ordersInFlight` with production_order metadata.
     ---------------------------------------------------------------------------
     `ordersInFlight` was built earlier from won documents, before
     rawOps was loaded. Now that we have rawOps, build a map keyed by
     quotation_id (= doc_id) and patch the matching rows in place.

     Why mutate vs. rebuild:
       - OrdersInFlight rows are independent objects; the type's new
         operational fields are all optional, so adding them after the
         fact is type-safe.
       - Rebuilding would mean another full loop over ordersForFlight
         duplicating the existing product_summary / client logic.
  --------------------------------------------------------------------------- */
  type PoMeta = {
    /** Production order id — surfaced so the row can route to the PO
     *  tracking page once production has materially started. */
    production_order_id: string | null;
    production_status: string | null;
    current_deadline: string | null;
    initial_deadline: string | null;
    actual_completion_date: string | null;
    shipment_booked: boolean | null;
    etd: string | null;
    eta: string | null;
    /** Pre-computed payment lifecycle state — drives the payment pill
     *  (Awaiting deposit / Balance overdue / Paid in full). Uses the
     *  canonical helper in lib/types.ts so the dashboard agrees with
     *  every other surface (PO detail page, operations table). */
    payment_state: ProductionPaymentState | null;
    /** Balance reminder offset (m048). NULL = no proactive reminder. */
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
      balance_reminder_days_before_eta:
        r.balance_reminder_days_before_eta ?? null,
    });
  }
  // Merge into each ordersInFlight row. delay_days + ending_in_days
  // are derived. The operational `pills` array is built from the full
  // merged state via computeOrderPills() — payment, production,
  // logistics, blocker chips all driven by one helper.
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
    // delay = current − initial (days). Null when either is missing.
    o.delay_days = computeProductionDelay({
      initial_production_deadline: meta.initial_deadline,
      current_production_deadline: meta.current_deadline,
    });
    // ending_in_days = days from today to current_deadline.
    if (meta.current_deadline) {
      const d = new Date(
        meta.current_deadline + "T00:00:00Z"
      ).getTime();
      const today = new Date(
        new Date().toISOString().slice(0, 10) + "T00:00:00Z"
      ).getTime();
      if (Number.isFinite(d) && Number.isFinite(today)) {
        o.ending_in_days = Math.round((d - today) / (1000 * 60 * 60 * 24));
      }
    }
    // Pills — single source of truth for operational state. Cap of 4
    // applied inside the helper so the row never overflows visually.
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
      // Factory validation status (drives the validation pill before
      // production materially starts — "Awaiting factory validation"
      // / "Validated" / "Production approved").
      task_list_status: o.task_list_status,
      // Balance reminder offset — drives the proactive "Balance due
      // in Nd" pill when ETA approaches and balance not received.
      balance_reminder_days_before_eta:
        meta.balance_reminder_days_before_eta,
    });
  }

  // ---- Recent critical events (Business mode banner feed) -------
  // Business view keeps its slim critical-only feed (last 14 days,
  // high+critical). Operations view uses the broader Operations Feed
  // below.
  const recentEvents = await listRecentCriticalEvents({
    daysBack: 14,
    limit: 12,
  });

  // ---- Operations Feed (Phase 2) ----
  // Broader query: all unresolved + recently-resolved events from the
  // last 30 days, sorted by severity → status priority → recency. The
  // server pre-fetches comments + actor labels so the drawer opens
  // instantly without a round-trip.
  // First we fetch the UNFILTERED events list — the SalesFilterBar
  // needs the global set to compute per-sales critical counts. After
  // that we apply the sales filter for the rest of the page.
  const opsFeedEventsAll = await listOperationsFeed({
    daysBack: 30,
    limit: 50,
    recentResolvedHours: 24,
  });

  // Build the sales pill list FIRST (uses unfiltered events for counts).
  // Soft-fails to empty list for sales users (RPC denies them) AND when
  // m047 isn't applied yet. The bar then doesn't render.
  const salesFilterUsers = global
    ? await getSalesUsersForFilter(opsFeedEventsAll)
    : [];
  // Total critical across all sales (drives the "All sales" pill badge).
  const salesFilterTotalCritical = salesFilterUsers.reduce(
    (s, u) => s + u.criticalCount,
    0
  );

  // Apply the sales filter to the events list used downstream. We
  // accept events where the entity belongs to the target sales:
  //   - document → entity_id in targetSalesDocIds
  //   - production_order → entity_id in (rawOps ids, already filtered)
  //   - task_list → entity_id in target sales' TL ids
  //   - client → too expensive to map; exclude in filtered mode
  // 'system' events are excluded under any filter (they're admin events).
  let opsFeedEvents = opsFeedEventsAll;
  if (requestedSalesFilter) {
    const docSet = new Set(targetSalesDocIds ?? []);
    const poSet = new Set(((rawOps ?? []) as any[]).map((r) => r.id));
    // One small query for TL ids tied to the target sales' docs.
    let tlSet = new Set<string>();
    if (targetSalesDocIds && targetSalesDocIds.length > 0) {
      const { data: tls } = await supabase
        .from("production_task_lists")
        .select("id")
        .in("quotation_id", targetSalesDocIds);
      tlSet = new Set(((tls ?? []) as any[]).map((t) => t.id as string));
    }
    opsFeedEvents = opsFeedEventsAll.filter((e) => {
      if (e.entity_type === "document") return docSet.has(e.entity_id);
      if (e.entity_type === "production_order") return poSet.has(e.entity_id);
      if (e.entity_type === "task_list") return tlSet.has(e.entity_id);
      return false; // client/system events: not in this scope
    });
  }
  // NOTE: comment-thread pre-loading + per-event-id comment maps were
  // removed when the OperationsSlot moved from the v2 vertical feed to
  // the cockpit. The cockpit doesn't open an inline drawer — clicking
  // an item routes the user to the entity's detail page where the
  // existing per-page timeline + comments live. /operations still
  // renders the full feed (with drawer + comments) for users who want
  // to drill in there.

  // Resolve actor labels — used by:
  //   - the Business mode's critical-events banner (recentEvents)
  //   - the OperationsFeed page (owner_id labels via actorMap)
  //   - the cockpit (currently no labels, but we union owner_ids
  //     anyway so future expansions are cheap)
  // Union actor_ids + owner_ids from both recentEvents AND opsFeedEvents.
  const eventActorIds = Array.from(
    new Set(
      [
        ...recentEvents.map((e) => e.actor_id),
        ...opsFeedEvents.map((e) => e.actor_id),
        ...opsFeedEvents.map((e) => (e as any).owner_id ?? null),
      ].filter(Boolean) as string[]
    )
  );
  const eventActorLabel = new Map<string, string>();
  if (eventActorIds.length > 0) {
    const { data: rolesRows } = await supabase
      .from("user_roles")
      .select("user_id, role")
      .in("user_id", eventActorIds);
    for (const r of rolesRows ?? []) {
      eventActorLabel.set(
        r.user_id,
        `${r.role}·${String(r.user_id).slice(0, 6)}`
      );
    }
  }
  /* ===========================================================================
     OPERATIONS COCKPIT DATA — v3 aggregate-counters design
     ==========================================================================
     The dashboard is a glanceable ENTRY POINT, not a workspace. Each
     cockpit card shows only:
       - a single big primary count (the headline number)
       - 2-3 aggregate summary rows (e.g. "2 delayed productions")
       - one View → footer link to the dedicated page

     ZERO entity rows on the dashboard. Users click through to
     /operations / /production/orders / /business / /documents/{id}
     to see actual orders / reminders / events and do real work.

     Each summary line is filtered out when count=0 (no "0 delayed
     orders" noise). Empty card → emptyMessage.                            */
  const todayCockpitIso = new Date().toISOString().slice(0, 10);
  const todayMs = new Date(todayCockpitIso + "T00:00:00Z").getTime();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
  const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
  const sevenDaysAgoMs = todayMs - sevenDaysMs;
  const fourteenDaysAgoMs = todayMs - fourteenDaysMs;
  const threeDaysAgoMs = todayMs - threeDaysMs;
  const sevenDaysAgoIso = new Date(sevenDaysAgoMs)
    .toISOString()
    .slice(0, 10);
  const threeDaysAgoIso = new Date(threeDaysAgoMs)
    .toISOString()
    .slice(0, 10);

  // --- PRODUCTION slices (used by Critical, Production, Payments) ---
  const delayedCount = opsAlerts.filter(
    (r) => r.alert.level === "delayed" || r.alert.level === "overdue"
  ).length;
  const balanceDueCount = opsAlerts.filter(
    (r) => r.alert.level === "balance_due"
  ).length;
  const awaitingDepositCount = opsAlerts.filter(
    (r) => r.alert.level === "awaiting_deposit"
  ).length;
  const completionApproachingCount = opsAlerts.filter(
    (r) => r.alert.level === "completion_approaching"
  ).length;
  const endingThisWeekCount = opsAlerts.filter((r) => {
    if (!r.deadline) return false;
    const d = new Date(r.deadline).getTime();
    return d >= todayMs && d <= todayMs + sevenDaysMs;
  }).length;
  // Ready for shipping = production_completed orders not yet shipped.
  const readyForShippingCount = opsAlerts.filter(
    (r) => r.status === "production_completed"
  ).length;

  /* Balance due soon (m048) — POs where the operator set a reminder
     offset (e.g. 15 days before ETA), the threshold is reached, and
     balance not yet received. Proactive companion to the existing
     balance_due alert which only fires AFTER ETA passes. Computed
     inline because operations-alerts.ts doesn't carry the offset. */
  const balanceDueSoonCount = ((rawOps ?? []) as any[]).filter((r: any) => {
    const offset = r.balance_reminder_days_before_eta;
    if (offset == null) return false;
    if (!r.eta) return false;
    // Skip if already paid in full / no balance expected.
    const totalPrice = Number(r.documents?.total_price ?? 0);
    const paymentMode = (r.documents?.payment_mode ?? null) as PaymentMode | null;
    const paymentTerms = (r.documents?.payment_terms ?? null) as PaymentTerms | null;
    const expectedBalance = computeExpectedBalance(
      totalPrice,
      paymentMode,
      paymentTerms
    );
    if (expectedBalance <= 0) return false;
    const balanceReceived = Number(r.balance_received_amount ?? 0);
    if (balanceReceived + 0.01 >= expectedBalance) return false;
    // Threshold check.
    const etaMs = new Date(r.eta + "T00:00:00Z").getTime();
    if (!Number.isFinite(etaMs)) return false;
    if (todayMs >= etaMs) return false; // already overdue (different counter)
    const reminderMs = etaMs - offset * 86_400_000;
    return todayMs >= reminderMs;
  }).length;

  // --- CRITICAL extras (raw production_order data, not via opsAlerts) ---
  // We read `rawOps` directly because we need fields opsAlerts dropped
  // (created_at, actual_completion_date, shipment_booked).
  // Missing deposit = awaiting_deposit AND created_at older than 14 days.
  // This is a STRONGER signal than plain "awaiting deposit" — the deal
  // closed but the money never came in. Belongs in Critical, not just
  // Payments.
  const missingDepositCount = (rawOps ?? []).filter((r: any) => {
    if (r.status !== "awaiting_deposit") return false;
    const ts = r.created_at ? new Date(r.created_at).getTime() : NaN;
    return Number.isFinite(ts) && ts <= fourteenDaysAgoMs;
  }).length;
  // Blocked shipment = production_completed AND no shipment booked
  // AND completed > 7 days ago. The factory is done but logistics
  // hasn't moved. Critical because the customer is waiting.
  const blockedShipmentCount = (rawOps ?? []).filter((r: any) => {
    if (r.status !== "production_completed") return false;
    if (r.shipment_booked) return false;
    const completion = r.actual_completion_date;
    if (!completion) return false;
    const ts = new Date(completion + "T00:00:00Z").getTime();
    return Number.isFinite(ts) && ts <= sevenDaysAgoMs;
  }).length;
  // Cancellations in the last 7 days — read from the events feed.
  const cancelledThisWeekCount = opsFeedEvents.filter(
    (e) =>
      e.event_type === "po.cancelled" &&
      new Date(e.created_at).getTime() >= sevenDaysAgoMs
  ).length;

  // --- QUOTATIONS slices ---
  // Reminders due — fetch top 20 rows for the cockpit Quotations card
  // (we display 3-4 + a "+N more" indicator). Defensive against m043
  // not applied. Joined to documents + clients so the row labels are
  // self-sufficient.
  let dueReminderRows: Array<{
    id: string;
    document_id: string;
    remind_at: string;
    note: string | null;
    documents: {
      number: string | null;
      clients: { company_name: string | null } | null;
    } | null;
  }> = [];
  // Whose reminders to surface in the cockpit Quotations card:
  //   - Sales: their own (effectiveSalesScope === userId via scopedToMe)
  //   - Technical with ?sales=X : target X's reminders
  //   - Technical without filter: their own
  const reminderUserId = effectiveSalesScope ?? userId;
  if (reminderUserId) {
    const { data: rData, error: rErr } = await supabase
      .from("quotation_reminders")
      .select(
        "id, document_id, remind_at, note, documents:document_id(number, clients(company_name))"
      )
      .eq("user_id", reminderUserId)
      .eq("status", "open")
      .lte("remind_at", todayCockpitIso)
      .order("remind_at", { ascending: true })
      .limit(20);
    if (!rErr) dueReminderRows = (rData ?? []) as any;
  }
  const remindersDueCount = dueReminderRows.length;
  const negotiatingCount = livePipelineDocs.filter(
    (d: any) => d.status === "negotiating"
  ).length;
  const sentStaleCount = livePipelineDocs.filter(
    (d: any) => d.status === "sent" && (d.date ?? "") < sevenDaysAgoIso
  ).length;
  // Recently revised — docs in active states with `date` within last
  // 3 days. Proxy for "deal had activity recently" since we don't
  // select updated_at on the docs query. Tightening this to a real
  // updated_at requires extending the select, deferred.
  const recentlyRevisedCount = livePipelineDocs.filter(
    (d: any) =>
      (d.status === "sent" || d.status === "negotiating") &&
      (d.date ?? "") >= threeDaysAgoIso
  ).length;

  // Helper: filter zero-count lines so we never display noise.
  function nz(
    lines: Array<{
      count: number;
      label: string;
      href?: string;
      tone?: "default" | "danger" | "warn" | "info";
    }>
  ) {
    return lines.filter((l) => l.count > 0);
  }
  // `nz` is kept around for the BusinessSlot critical-events feed but
  // no longer used by the cockpit (the cockpit shows entity rows, not
  // aggregate summary lines, since v4).
  void nz;

  /* -----------------------------------------------------------------------
     COCKPIT ENTITY ROWS — v4
     -----------------------------------------------------------------------
     Each card now lists real production_orders / documents / reminders
     (up to 4 visible + "+N more" overflow). We compute the rows here
     from `rawOps` (full PO data), `livePipelineDocs` (sent/negotiating
     docs), and `dueReminderRows` (reminders).

     Sorting priority: rows with the most urgent signal float to the
     top of each card. The +N overflow then routes to /operations or
     /business for the long list.                                          */

  // Pre-compute delay_days for each production_order so row labels
  // can carry "+Nd late" naturally. Keyed by PO id.
  const poDelayById = new Map<string, number | null>();
  for (const r of (rawOps ?? []) as any[]) {
    const d = computeProductionDelay({
      initial_production_deadline: r.initial_production_deadline ?? null,
      current_production_deadline: r.current_production_deadline ?? null,
    });
    poDelayById.set(r.id, d);
  }

  /* ---- Collaborative event status per entity (m044) ----
     Iterate opsFeedEvents and pick the most progressed collab status
     per entity_id, so the cockpit row can show "Working" / "Waiting
     supplier" / "Escalated" badges. Precedence (highest first):
       escalated > waiting > working > acknowledged
     'open' events get no badge — the row's metric already signals
     the underlying issue, no need to add visual noise. */
  type CollabStatus = {
    label: string;
    tone: "sky" | "sky-light" | "amber" | "purple" | "emerald";
    priority: number; // higher = more progressed
  };
  function collabStatusForEvent(e: typeof opsFeedEvents[number]): CollabStatus | null {
    const status = e.status ?? "open";
    if (status === "escalated") {
      return { label: "Escalated", tone: "purple", priority: 4 };
    }
    if (status === "waiting") {
      const wf = (e as any).waiting_for as string | null | undefined;
      const wfLabel =
        wf && wf !== "other"
          ? `Waiting ${wf}`
          : "Waiting";
      return { label: wfLabel, tone: "amber", priority: 3 };
    }
    if (status === "working") {
      return { label: "Working", tone: "sky", priority: 2 };
    }
    if (status === "acknowledged") {
      return { label: "Acknowledged", tone: "sky-light", priority: 1 };
    }
    return null;
  }
  const entityCollabStatusById = new Map<string, CollabStatus>();
  for (const e of opsFeedEvents) {
    if (!e.entity_id) continue;
    const cs = collabStatusForEvent(e);
    if (!cs) continue;
    const existing = entityCollabStatusById.get(e.entity_id);
    if (!existing || cs.priority > existing.priority) {
      entityCollabStatusById.set(e.entity_id, cs);
    }
  }
  // Helper used inside the cockpit row builders to attach the badge.
  function statusBadgeFor(entityId: string) {
    const cs = entityCollabStatusById.get(entityId);
    if (!cs) return undefined;
    return { label: cs.label, tone: cs.tone };
  }

  /* ---- Unread comment aggregation per entity (m045) ----
     Compute per-event unread counts for the current user, then SUM
     across all events tied to each entity. Drives the rose pulse dot
     on cockpit rows so the user sees at a glance which POs have new
     conversation context they haven't read yet. */
  const opsEventIds = opsFeedEvents.map((e) => e.id);
  const dashboardUnreadByEvent = await getUnreadCommentCountsForUser(
    userId ?? null,
    opsEventIds
  );
  const entityUnreadCountById = new Map<string, number>();
  for (const e of opsFeedEvents) {
    if (!e.entity_id) continue;
    const u = dashboardUnreadByEvent.get(e.id) ?? 0;
    if (u <= 0) continue;
    entityUnreadCountById.set(
      e.entity_id,
      (entityUnreadCountById.get(e.entity_id) ?? 0) + u
    );
  }
  function unreadCountFor(entityId: string): number {
    return entityUnreadCountById.get(entityId) ?? 0;
  }

  /* ---------- CockpitItem shape ----------
     primary    = "{po-number} · {client}"  (bold, dark, truncated)
     secondary  = short descriptive sentence (gray, smaller, truncated)
     tone       = colors the primary text — danger/warn/info/success
     statusBadge= optional collab status (working/waiting/escalated) */
  type CockpitRow = {
    id: string;
    primary: string;
    secondary: string;
    href: string;
    tone: "default" | "danger" | "warn" | "info" | "success";
    statusBadge?: { label: string; tone: "sky" | "sky-light" | "amber" | "purple" | "emerald" };
    sortKey: number; // lower = more urgent
  };

  function refClient(r: any): string {
    const ref = r.number ?? r.id.slice(0, 8);
    const client = r.clients?.company_name ?? "—";
    return `${ref} · ${client}`;
  }

  /* ---------- CRITICAL — top issues across all sources ----------
     Iterate over `opsAlerts` (which has the canonical `alert.level`
     already computed via computeOperationsAlert) and pull every row
     whose level qualifies as a critical issue:
       - delayed / overdue → "+Nd late vs baseline"
       - balance_due       → "Balance overdue · production done"
     Then add stale deposits + blocked shipments from rawOps (those
     need raw fields like created_at / actual_completion_date that
     opsAlerts dropped).
     We dedup by id at the end so the same PO doesn't appear twice
     even if it qualifies under multiple criteria.                          */
  const rawOpsById = new Map<string, any>();
  for (const r of (rawOps ?? []) as any[]) rawOpsById.set(r.id, r);

  const criticalRows: CockpitRow[] = [];

  // 1. From opsAlerts — level-based critical bucket
  for (const a of opsAlerts) {
    const raw = rawOpsById.get(a.id);
    const href = `/production/orders/${a.id}`;
    const primary = `${a.number ?? a.id.slice(0, 8)} · ${a.clientName}`;
    const delay = poDelayById.get(a.id);
    if (a.alert.level === "delayed" || a.alert.level === "overdue") {
      criticalRows.push({
        id: `crit-${a.id}`,
        primary,
        secondary:
          delay != null && delay > 0
            ? `Production delayed +${delay}d vs baseline`
            : a.alert.message,
        href,
        tone: "danger",
        sortKey: -1000 - (delay ?? 0),
      });
    } else if (a.alert.level === "balance_due") {
      criticalRows.push({
        id: `crit-${a.id}`,
        primary,
        secondary: "Balance overdue · production done",
        href,
        tone: "danger",
        sortKey: -800,
      });
    } else if (raw && a.alert.level === "awaiting_deposit") {
      // Stale deposit check (uses raw.created_at).
      const created = raw.created_at
        ? new Date(raw.created_at).getTime()
        : NaN;
      if (Number.isFinite(created) && created <= fourteenDaysAgoMs) {
        const dayCount = Math.round(
          (todayMs - created) / (1000 * 60 * 60 * 24)
        );
        criticalRows.push({
          id: `crit-${a.id}`,
          primary,
          secondary: `Awaiting deposit for ${dayCount}d`,
          href,
          tone: "danger",
          sortKey: -300 - dayCount,
        });
      }
    }
  }

  // 2. From rawOps — blocked shipments (production_completed, no
  //    shipment, > 7 days). Independent of alert level.
  for (const r of (rawOps ?? []) as any[]) {
    if (r.status !== "production_completed") continue;
    if (r.shipment_booked) continue;
    if (!r.actual_completion_date) continue;
    const completedMs = new Date(
      r.actual_completion_date + "T00:00:00Z"
    ).getTime();
    if (!Number.isFinite(completedMs) || completedMs > sevenDaysAgoMs) {
      continue;
    }
    const dayCount = Math.round(
      (todayMs - completedMs) / (1000 * 60 * 60 * 24)
    );
    criticalRows.push({
      id: `crit-${r.id}`, // same id pattern as opsAlerts loop for dedup
      primary: refClient(r),
      secondary: `Shipping not booked · ${dayCount}d since completion`,
      href: `/production/orders/${r.id}`,
      tone: "warn",
      sortKey: -500 - dayCount,
    });
  }

  // Dedup by id (keep first occurrence, which is the most severe one
  // since we ordered by signal strength above).
  const criticalSeen = new Set<string>();
  const criticalDedup = criticalRows.filter((r) => {
    if (criticalSeen.has(r.id)) return false;
    criticalSeen.add(r.id);
    return true;
  });
  criticalDedup.sort((a, b) => a.sortKey - b.sortKey);
  const criticalItems = criticalDedup.map(
    ({ sortKey: _sk, ...rest }) => rest
  );

  /* ---------- PRODUCTION — alerting active orders ---------- */
  const productionRows: CockpitRow[] = alertingRows
    .filter((r) => r.alert.level !== "awaiting_deposit")
    .map((r) => {
      const href = `/production/orders/${r.id}`;
      // Reconstruct a row that looks like rawOps for the helper.
      const fauxRow = {
        number: r.number,
        id: r.id,
        clients: { company_name: r.clientName },
      };
      const delay = poDelayById.get(r.id);
      let secondary: string;
      let tone: CockpitRow["tone"];
      let sortKey: number;
      if (delay != null && delay > 0) {
        secondary = `Production delayed +${delay}d vs baseline`;
        tone = "danger";
        sortKey = -1000 - delay;
      } else if (
        r.alert.level === "completion_approaching" &&
        r.deadline
      ) {
        const remainMs =
          new Date(r.deadline + "T00:00:00Z").getTime() - todayMs;
        const days = Math.round(remainMs / (1000 * 60 * 60 * 24));
        if (days >= 0 && days <= 7) {
          secondary = `Production completes in ${days}d`;
          tone = "warn";
          sortKey = -500 + days;
        } else {
          secondary = `Completion approaching`;
          tone = "warn";
          sortKey = -200;
        }
      } else if (r.status === "production_completed") {
        secondary = "Production complete · awaiting shipment";
        tone = "info";
        sortKey = -300;
      } else {
        secondary = r.alert.message ?? r.alert.label;
        tone = "default";
        sortKey = 0;
      }
      return {
        id: `prod-${r.id}`,
        primary: refClient(fauxRow),
        secondary,
        href,
        tone,
        sortKey,
      };
    });
  productionRows.sort((a, b) => a.sortKey - b.sortKey);
  const productionItems = productionRows.map(
    ({ sortKey: _sk, ...rest }) => rest
  );

  /* ---------- PAYMENTS — driven by alert.level (not raw status) ----
     Source = opsAlerts so we follow the canonical alert logic
     instead of guessing from r.status. Two buckets:
       - awaiting_deposit  → "Deposit pending" / "Deposit unpaid Nd"
       - balance_due       → "Balance overdue · production done"                   */
  const paymentRows: CockpitRow[] = [];
  for (const a of opsAlerts) {
    if (
      a.alert.level !== "awaiting_deposit" &&
      a.alert.level !== "balance_due"
    ) {
      continue;
    }
    const raw = rawOpsById.get(a.id);
    const href = `/production/orders/${a.id}`;
    const primary = `${a.number ?? a.id.slice(0, 8)} · ${a.clientName}`;
    if (a.alert.level === "awaiting_deposit") {
      const created = raw?.created_at
        ? new Date(raw.created_at).getTime()
        : NaN;
      const isStale =
        Number.isFinite(created) && created <= fourteenDaysAgoMs;
      if (isStale) {
        const dayCount = Math.round(
          (todayMs - created) / (1000 * 60 * 60 * 24)
        );
        paymentRows.push({
          id: `pay-${a.id}`,
          primary,
          secondary: `Deposit unpaid · ${dayCount}d since order`,
          href,
          tone: "danger",
          sortKey: -100 - dayCount,
        });
      } else {
        paymentRows.push({
          id: `pay-${a.id}`,
          primary,
          secondary: "Deposit pending · awaiting wire",
          href,
          tone: "warn",
          sortKey: 10,
        });
      }
    } else {
      // balance_due
      paymentRows.push({
        id: `pay-${a.id}`,
        primary,
        secondary: "Balance overdue · production done",
        href,
        tone: "danger",
        sortKey: -50,
      });
    }
  }
  paymentRows.sort((a, b) => a.sortKey - b.sortKey);
  const paymentItems = paymentRows.map(
    ({ sortKey: _sk, ...rest }) => rest
  );

  /* ---------- QUOTATIONS — reminders + sent stale + negotiating ---------- */
  const quotationItems: Array<{
    id: string;
    primary: string;
    secondary: string;
    href: string;
    tone: "default" | "danger" | "warn" | "info" | "success";
  }> = [];
  // Reminders due first (most urgent).
  for (const r of dueReminderRows) {
    const overdue = r.remind_at < todayCockpitIso;
    const days = overdue
      ? Math.round(
          (todayMs - new Date(r.remind_at + "T00:00:00Z").getTime()) /
            (1000 * 60 * 60 * 24)
        )
      : 0;
    const noteSnippet = r.note
      ? ` · ${r.note.slice(0, 36)}${r.note.length > 36 ? "…" : ""}`
      : "";
    quotationItems.push({
      id: `qr-${r.id}`,
      primary: `${r.documents?.number ?? "—"} · ${
        r.documents?.clients?.company_name ?? "—"
      }`,
      secondary: overdue
        ? `Reminder overdue ${days}d${noteSnippet}`
        : `Reminder due today${noteSnippet}`,
      href: `/documents/${r.document_id}`,
      tone: overdue ? "danger" : "warn",
    });
  }
  // Sent stale.
  const sentStaleDocs = livePipelineDocs.filter(
    (d: any) => d.status === "sent" && (d.date ?? "") < sevenDaysAgoIso
  );
  for (const d of sentStaleDocs as any[]) {
    if (quotationItems.length >= 12) break;
    const daysAgo = Math.round(
      (todayMs - new Date((d.date ?? todayCockpitIso) + "T00:00:00Z").getTime()) /
        (1000 * 60 * 60 * 24)
    );
    quotationItems.push({
      id: `qs-${d.id}`,
      primary: `${d.number ?? "—"} · ${
        clientByDoc.get(d.id)?.company_name ?? "—"
      }`,
      secondary: `Sent ${daysAgo}d ago · awaiting reply`,
      href: `/documents/${d.id}`,
      tone: "default",
    });
  }
  // Negotiating (sales engaged).
  for (const d of livePipelineDocs.filter(
    (x: any) => x.status === "negotiating"
  ) as any[]) {
    if (quotationItems.length >= 12) break;
    quotationItems.push({
      id: `qn-${d.id}`,
      primary: `${d.number ?? "—"} · ${
        clientByDoc.get(d.id)?.company_name ?? "—"
      }`,
      secondary: "Negotiation in progress",
      href: `/documents/${d.id}`,
      tone: "info",
    });
  }
  // Recently revised — docs in sent/negotiating with date in last 3
  // days. Dedup against docs already pushed under the other categories
  // (a negotiating doc dated yesterday is both "negotiating" and
  // "recently revised" — show it once under negotiating).
  const alreadyPushedDocIds = new Set(
    quotationItems
      .map((q) => {
        // Item ids are prefixed (qr-/qs-/qn-/qrev-) — strip to get doc id.
        const m = q.id.match(/^q[a-z]+-(.+)$/);
        return m ? m[1] : null;
      })
      .filter(Boolean) as string[]
  );
  const recentlyRevisedDocs = livePipelineDocs.filter(
    (d: any) =>
      (d.status === "sent" || d.status === "negotiating") &&
      (d.date ?? "") >= threeDaysAgoIso &&
      !alreadyPushedDocIds.has(d.id)
  );
  for (const d of recentlyRevisedDocs as any[]) {
    if (quotationItems.length >= 12) break;
    quotationItems.push({
      id: `qrev-${d.id}`,
      primary: `${d.number ?? "—"} · ${
        clientByDoc.get(d.id)?.company_name ?? "—"
      }`,
      secondary: "Quote revised recently",
      href: `/documents/${d.id}`,
      tone: "info",
    });
  }

  /* ---- Merge collab status badges into every cockpit item ----
     Each row's id is "crit-{poId}" / "prod-{poId}" / "pay-{poId}" /
     "qr-{reminderId}" / "qs-{docId}" / "qn-{docId}" / "qrev-{docId}".
     We strip the prefix to recover the entity id, then look up the
     collab status from entityCollabStatusById. Reminders/docs go via
     document_id which we can derive from the underlying source.
     For simplicity, we only attach the badge to PO-derived items
     here — quotation items would need a separate map per document
     (deferred — quotations rarely have non-trivial collab status). */
  function mergeBadgesForPOs<
    T extends { id: string; statusBadge?: any; unreadCount?: number }
  >(items: T[]): T[] {
    return items.map((item) => {
      // Extract PO id from any "{prefix}-{poId}" id pattern.
      const m = item.id.match(/^[a-z]+-(.+)$/);
      const poId = m ? m[1] : null;
      if (!poId) return item;
      const badge = statusBadgeFor(poId);
      const unread = unreadCountFor(poId);
      let next: T = item;
      if (badge) next = { ...next, statusBadge: badge };
      if (unread > 0) next = { ...next, unreadCount: unread };
      return next;
    });
  }
  const criticalItemsWithBadges = mergeBadgesForPOs(criticalItems);
  const productionItemsWithBadges = mergeBadgesForPOs(productionItems);
  const paymentItemsWithBadges = mergeBadgesForPOs(paymentItems);

  // Assemble cockpit data — primaryCount stays as the AGGREGATE total
  // (so users see "4 open issues" even when only top 4 rows render).
  // Metrics pills surface the core operational dials (always shown,
  // even when count=0 — they're gauges, not "things wrong").
  const cockpitData: OperationsCockpitData = {
    critical: {
      primaryCount:
        delayedCount +
        balanceDueCount +
        missingDepositCount +
        blockedShipmentCount +
        cancelledThisWeekCount,
      primaryLabel: "open issues",
      metrics: [
        {
          label: "delayed",
          value: delayedCount,
          tone: delayedCount > 0 ? "danger" : "default",
        },
        {
          label: "balance overdue",
          value: balanceDueCount,
          tone: balanceDueCount > 0 ? "warn" : "default",
        },
      ],
      items: criticalItemsWithBadges,
      totalCount: criticalDedup.length,
      emptyMessage: "No critical issues. Operations stable.",
      viewAllHref: "/operations",
      viewAllLabel: "Open operations →",
    },
    production: {
      primaryCount: opsActiveCount,
      primaryLabel:
        opsActiveCount === 1 ? "active order" : "active orders",
      metrics: [
        {
          label: "delayed",
          value: delayedCount,
          tone: delayedCount > 0 ? "danger" : "default",
        },
        {
          label: "ending ≤7d",
          value: endingThisWeekCount,
          tone: endingThisWeekCount > 0 ? "warn" : "default",
        },
      ],
      items: productionItemsWithBadges,
      totalCount:
        opsAlerts.filter((r) => r.alert.level !== "awaiting_deposit").length,
      emptyMessage:
        opsActiveCount === 0
          ? "No active orders."
          : "All active orders are on track.",
      viewAllHref: "/operations",
      viewAllLabel: "All production →",
    },
    payments: {
      // primaryCount includes the proactive "balance due soon" count
      // (m048) — Ops gets a single number that captures both reactive
      // blockers AND upcoming pressure that needs a chase NOW.
      primaryCount:
        awaitingDepositCount + balanceDueCount + balanceDueSoonCount,
      primaryLabel:
        awaitingDepositCount + balanceDueCount + balanceDueSoonCount === 1
          ? "needs attention"
          : "need attention",
      metrics: [
        {
          label: "deposits pending",
          value: awaitingDepositCount,
          tone: awaitingDepositCount > 0 ? "warn" : "default",
        },
        {
          label: "balance overdue",
          value: balanceDueCount,
          tone: balanceDueCount > 0 ? "danger" : "default",
        },
        {
          label: "balance due soon",
          value: balanceDueSoonCount,
          tone: balanceDueSoonCount > 0 ? "warn" : "default",
        },
      ],
      items: paymentItemsWithBadges,
      totalCount: paymentItems.length,
      emptyMessage: "Cash flow clear. No payment blockers.",
      viewAllHref: "/operations",
      viewAllLabel: "View payments →",
    },
    quotations: {
      primaryCount:
        remindersDueCount +
        negotiatingCount +
        sentStaleCount +
        recentlyRevisedCount,
      primaryLabel: "follow-ups",
      metrics: [
        {
          label: "reminders due",
          value: remindersDueCount,
          tone: remindersDueCount > 0 ? "warn" : "default",
        },
        {
          label: "negotiating",
          value: negotiatingCount,
          tone: negotiatingCount > 0 ? "info" : "default",
        },
      ],
      items: quotationItems,
      totalCount: quotationItems.length,
      emptyMessage: "No follow-ups due. Sales pipeline clean.",
      viewAllHref: "/business",
      viewAllLabel: "View pipeline →",
    },
  };

  // (Plain-object `eventActorLabelObj` previously serialised the actor
  // Map for the v2 OperationsFeed client component. The cockpit doesn't
  // need it — the BusinessSlot's critical-events banner consumes the
  // Map directly via `eventActorLabel.get(...)`.)

  // ---- Activity feed ----
  // Compose from creation timestamps across multiple tables. Without a
  // real audit log we can only show "created" events — which is fine for
  // a daily team feed.
  const events: ActivityEvent[] = [];

  // Activity feed needs company_name for each doc / task list event.
  // Build a batched client lookup once instead of relying on PostgREST
  // embeds (which silently dropped the whole `docs` query in earlier
  // sessions). Covers up to ~15 client_ids across all activity rows.
  const activityClientIds = Array.from(
    new Set(
      (docs ?? [])
        .slice(0, 6)
        .map((d: any) => d.client_id)
        .filter((x: string | null) => !!x)
    )
  ) as string[];
  const clientNameById = new Map<string, string>();
  if (activityClientIds.length > 0) {
    const { data: cls } = await supabase
      .from("clients")
      .select("id, company_name")
      .in("id", activityClientIds);
    for (const c of cls ?? []) {
      clientNameById.set(c.id, c.company_name);
    }
  }
  // Recent documents
  const recentDocs = [...(docs ?? [])]
    .sort((a, b) => {
      const aT = new Date(a.created_at || a.date).getTime();
      const bT = new Date(b.created_at || b.date).getTime();
      return bT - aT;
    })
    .slice(0, 6);
  for (const d of recentDocs) {
    const verb = d.status === "won" ? "won" : "created";
    const tone = d.status === "won" ? "sales" : "sales";
    const companyName = clientNameById.get(d.client_id ?? "") ?? "—";
    events.push({
      id: `doc-${d.id}`,
      description: `${verb === "won" ? "Won" : "New"} quotation ${d.number ?? "—"} · ${companyName}`,
      detail: `${(d.currency as string) ?? "USD"} ${Number(
        d.total_price || 0
      ).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
      href: `/documents/${d.id}`,
      relativeTime: relativeTime(d.created_at || d.date),
      tone,
    });
  }
  // Recent task lists — same anti-embed treatment as the docs query.
  // We pull the TL rows lean, then batch-fetch their client names.
  {
    let tlsQuery = supabase
      .from("production_task_lists")
      .select("id, number, status, date, quotation_id, client_id")
      .order("date", { ascending: false })
      .limit(5);
    if (effectiveSalesScope) {
      // Sales scope (sales user OR technical user with ?sales=X): tasks
      // tied to docs owned by that sales rep.
      if (wonDocIds.length > 0) {
        tlsQuery = tlsQuery.in("quotation_id", wonDocIds);
      } else {
        tlsQuery = tlsQuery.eq("id", "00000000-0000-0000-0000-000000000000");
      }
    }
    const { data: tls } = await tlsQuery;

    // Resolve any client_ids we haven't already looked up for the doc
    // activity feed — reuse `clientNameById` so we don't double-fetch.
    const missingClientIds = Array.from(
      new Set(
        (tls ?? [])
          .map((t: any) => t.client_id)
          .filter(
            (id: string | null) => !!id && !clientNameById.has(id)
          )
      )
    ) as string[];
    if (missingClientIds.length > 0) {
      const { data: cls } = await supabase
        .from("clients")
        .select("id, company_name")
        .in("id", missingClientIds);
      for (const c of cls ?? []) {
        clientNameById.set(c.id, c.company_name);
      }
    }

    for (const t of tls ?? []) {
      const companyName = clientNameById.get(t.client_id ?? "") ?? "—";
      events.push({
        id: `tl-${t.id}`,
        description: `Production task list ${t.number ?? "—"} · ${companyName}`,
        detail: `Status: ${t.status.replace(/_/g, " ")}`,
        href: `/task-lists/${t.id}`,
        relativeTime: relativeTime(t.date),
        tone: "production",
      });
    }
  }
  // Recent clients (global only — sales already sees their own deals)
  if (global) {
    const { data: clients } = await supabase
      .from("clients")
      .select("id, company_name, client_code, created_at")
      .order("created_at", { ascending: false })
      .limit(3);
    for (const c of clients ?? []) {
      events.push({
        id: `client-${c.id}`,
        description: `New client added · ${c.company_name}${c.client_code ? ` (${c.client_code})` : ""}`,
        href: `/clients/${c.id}`,
        relativeTime: relativeTime((c as any).created_at),
        tone: "admin",
      });
    }
  }
  // Sort all events by recency. We approximate via parsing relativeTime
  // ordering by stable timestamp from the original data: we already added
  // in roughly chronological order per table. To be safe, sort by parsing
  // the iso the producer used: docs use created_at|date, tls use date.
  // Simpler: keep insertion order, cap at 10.
  events.splice(10);

  // ---- Subtitle text ----
  const activeForFollowUp = (docs ?? []).filter(
    (d) =>
      d.status === "sent" || d.status === "negotiating"
  ).length;
  const inProductionCount = ordersInFlight.length;
  const subtitleParts: string[] = [];
  if (activeForFollowUp > 0)
    subtitleParts.push(
      `${activeForFollowUp} quotation${activeForFollowUp === 1 ? "" : "s"} awaiting follow-up`
    );
  if (inProductionCount > 0)
    subtitleParts.push(
      `${inProductionCount} order${inProductionCount === 1 ? "" : "s"} in production`
    );
  const subtitle =
    subtitleParts.length > 0 ? subtitleParts.join(" · ") + "." : "Nothing pressing today — quiet day on the line.";

  return (
    <div className="po-premium mx-auto max-w-screen-2xl px-6 py-8 space-y-6">
      <DashboardModeProvider>
      {/* ---------- HEADER GREETING + MODE TOGGLE ----------
          Three-column header: greeting on the left, mode toggle in the
          centre (the visible affordance for switching views), and the
          action buttons on the right. The center toggle is the visual
          anchor for the new dashboard duality. */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-start gap-4">
        <div>
          <div className="eyebrow">
            {now
              .toLocaleDateString("en", {
                month: "long",
                day: "numeric",
                year: "numeric",
                weekday: "long",
              })
              .toUpperCase()}
          </div>
          <h1 className="doc-title mt-1.5">Bonjour, {greetingName}.</h1>
          <p className="text-sm text-neutral-500 mt-1.5">{subtitle}</p>
        </div>
        <div className="flex justify-center pt-1">
          <DashboardModeToggle />
        </div>
        <div className="flex items-start justify-end gap-2">
          <Link href="/clients" className="btn-secondary">
            All clients
          </Link>
          {canCreateQuotation && (
            <Link href="/documents/new" className="btn-primary">
              + New quotation
            </Link>
          )}
        </div>
      </div>

      {/* Action required — Projects. Role-aware, clickable, renders null when
          nothing needs the user. Surfaces what requires attention on the
          landing page, not just in notifications. */}
      <ProjectActionsWidget />

      {/* SALES FILTER BAR — technical roles only.
          Lets admin / TLM / operations / super narrow every operational
          surface on the page to a single sales rep's data. Sales users
          never see this (it's hidden for non-technical roles). Empty
          list (no sales users yet, or m047 missing) also hides. */}
      {global && salesFilterUsers.length > 0 && (
        <SalesFilterBar
          sales={salesFilterUsers}
          totalCriticalCount={salesFilterTotalCritical}
        />
      )}

      {/* Query failure banner — if the documents query errored entirely,
          surface it instead of silently showing a 0-everywhere dashboard
          (that's how the previous regression hid for so long). */}
      {allDocsErr && (
        <div className="rounded-md border border-rose-300 bg-rose-50/60 px-3 py-3 text-xs text-rose-900">
          <div className="font-semibold mb-1">
            Documents query failed — KPIs may be inaccurate
          </div>
          <p className="text-rose-800 font-mono break-all">
            {allDocsErr.message}
          </p>
          <p className="text-rose-700 mt-1">
            Check the dev server log. Likely causes: stale PostgREST schema
            cache (run <code>notify pgrst, &apos;reload schema&apos;</code>{" "}
            in Supabase), missing column, or broken RLS policy.
          </p>
        </div>
      )}

      {/* ==================== BUSINESS MODE ====================
          Current layout: KPIs and pipeline first, operations live
          + critical events + activity below. Optimised for momentum
          tracking and commercial reporting. */}
      <BusinessSlot>
      <div className="space-y-6">

      {/* ---------- FORECAST — forward-looking pipeline ----------
          Management (admin / super-admin) get the executive panel:
          company-wide weighted pipeline, commit, closing-this-quarter,
          stale + breakdowns by rep / country / family. A sales filter,
          if active, narrows it to that rep.

          Everyone else (sales, and operationally TLM / operations) get
          the compact strip scoped to their own deals. Both self-load
          and render nothing when there are no forecasted deals, so the
          surface stays quiet on a fresh book. */}
      {canViewGlobalForecast ? (
        <ManagementForecastPanel scopedUserId={effectiveSalesScope} />
      ) : (
        <ForecastStrip scopedUserId={effectiveSalesScope ?? userId ?? null} />
      )}

      {/* ---------- KPI STRIP — Month-to-date (commercial momentum) ---------- */}
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-widerx text-neutral-500 mb-1.5">
          This month vs. last month
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label="Quotations sent · MTD"
            value={String(mtdSent)}
            change={sentChange}
            sparkline={sparkSent}
          />
          <KpiCard
            label="Conversion rate · MTD"
            value={`${mtdConv.toFixed(1)}%`}
            change={convChange}
            changeUnit=" pts"
            sparkline={sparkConv}
          />
          <KpiCard
            label="Revenue · MTD"
            value={formatMoney(mtdRevenue)}
            change={revenueChange}
            sparkline={sparkRevenue}
            featured
          />
          <KpiCard
            label="Avg. deal size · MTD"
            value={formatMoney(mtdAvgDeal)}
            change={avgChange}
            sparkline={sparkAvg}
          />
        </div>
      </div>

      {/* ---------- LIVE KPI STRIP — Current state (not bound to month) ----------
          The MTD strip above answers "what happened this month" — useful for
          momentum tracking but goes to zero at every month rollover and ignores
          backdated documents. This strip answers "what's true RIGHT NOW".
          - Active pipeline value: sum of sent + negotiating, all-time
          - Active deals count: same population
          - Revenue · 90d: rolling 90-day window, smoother than calendar MTD
          - Lifetime won value: sanity-check anchor for test data that spans years */}
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-widerx text-neutral-500 mb-1.5">
          Current state · all-time, not month-bound
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label="Active pipeline value"
            value={formatMoney(livePipelineValue)}
          />
          <KpiCard
            label="Active deals"
            value={String(livePipelineCount)}
          />
          <KpiCard
            label="Revenue · last 90 days"
            value={formatMoney(liveWon90Revenue)}
          />
          <KpiCard
            label="Lifetime won"
            value={formatMoney(liveLifetimeWonValue)}
          />
        </div>
        <p className="text-[10px] text-neutral-400 italic mt-1.5">
          Pipeline = sent + negotiating. Lifetime = all won deals, no date
          filter — useful sanity check when test data is older than 12 months.
        </p>
      </div>

      {/* ---------- PIPELINE + WIN RATE ---------- */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-3">
        {/* Pipeline chart */}
        <div className="rounded-xl border border-neutral-200/80 bg-white shadow-soft p-5">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-widerx text-neutral-500">
                Pipeline · last 12 months
              </div>
              <div className="text-xs text-neutral-500 mt-0.5">
                Quotations issued by month
              </div>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-neutral-500">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-neutral-900" />
                Sent
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-solux" />
                Won
              </span>
            </div>
          </div>
          <PipelineChart data={monthlyData} />
          <div className="mt-5 pt-4 border-t border-neutral-100 grid grid-cols-4 gap-4">
            <Stat label="Total sent · 12mo" value={String(total12)} />
            <Stat label="Won" value={String(won12)} />
            <Stat label="Win rate" value={`${winRate12.toFixed(1)}%`} />
            <Stat label="Total value" value={formatMoney(totalValue12)} />
          </div>
        </div>

        {/* Win rate donut */}
        <div className="rounded-xl border border-neutral-200/80 bg-white shadow-soft p-5 flex flex-col">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-widerx text-neutral-500">
              Win rate
            </div>
            <div className="text-xs text-neutral-500 mt-0.5">
              Quarter to date
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center py-4">
            <div className="text-center">
              <WinRateDonut percentage={qWinRate} size={140} stroke={10} />
              <div className="text-[11px] text-neutral-500 mt-1">{qLabel}</div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 pt-3 border-t border-neutral-100">
            <Stat label="Sent" value={String(qSent)} small />
            <Stat label="Won" value={String(qWon)} small />
            <Stat label="Lost" value={String(qLost)} small />
          </div>
        </div>
      </div>

      {/* ---------- OPERATIONS KPI STRIP (real data from production_orders) ---------- */}
      {/* Always visible — was previously gated behind the alert count
          conditional, which made the dashboard look empty when nothing
          was wrong. */}
      <div className="rounded-xl border border-neutral-200/80 bg-white shadow-soft p-5 space-y-4">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-widerx text-neutral-500">
              Operations · live
            </div>
            <div className="text-xs text-neutral-500 mt-0.5">
              {opsActiveCount === 0
                ? "No active production orders."
                : `${opsActiveCount} active order${opsActiveCount === 1 ? "" : "s"}${
                    totalAlertingCount > 0
                      ? ` · ${totalAlertingCount} need${totalAlertingCount === 1 ? "s" : ""} attention`
                      : " · all on track"
                  }.`}
            </div>
          </div>
          <Link
            href="/operations"
            className="text-sm text-neutral-600 hover:text-neutral-900"
          >
            Open operations →
          </Link>
        </div>

        {/* Mini-KPI strip — concrete numbers, not just alerts. */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <MiniOpsStat
            label="Revenue in production"
            value={formatMoney(opsRevenueInProduction)}
          />
          <MiniOpsStat
            label="Active orders"
            value={String(opsActiveCount)}
          />
          <MiniOpsStat
            label="Awaiting deposit"
            value={String(opsAwaitingDepositCount)}
            tone={opsAwaitingDepositCount > 0 ? "warn" : "muted"}
          />
          <MiniOpsStat
            label="Delayed / overdue"
            value={String(opsDelayedCount)}
            tone={opsDelayedCount > 0 ? "danger" : "muted"}
          />
        </div>

        {/* Top alerts list */}
        {opsAlerts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50/50 px-4 py-6 text-center">
            <p className="text-sm font-semibold text-neutral-700">
              No active production orders yet.
            </p>
            <p className="text-xs text-neutral-500 mt-1 max-w-md mx-auto">
              Production orders are created automatically when a task
              list is validated. If you expect orders here, check the
              orange banner on{" "}
              <Link href="/operations" className="underline">
                Operations
              </Link>{" "}
              for orphan task lists.
            </p>
          </div>
        ) : alertingRows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-emerald-200 bg-emerald-50/40 px-4 py-5 text-center">
            <p className="text-sm font-semibold text-emerald-800">
              All on track.
            </p>
            <p className="text-xs text-emerald-700 mt-1">
              No order needs attention right now.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-neutral-100 border border-neutral-200/80 rounded-lg overflow-hidden">
            {alertingRows.map((r) => (
              <li
                key={r.id}
                className="px-3 py-2.5 hover:bg-neutral-50 transition-colors"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        href={`/production/orders/${r.id}`}
                        className="text-sm font-semibold text-neutral-900 hover:text-solux"
                      >
                        {r.number ?? "—"}
                      </Link>
                      <span className="text-[11px] text-neutral-500 truncate">
                        {r.clientName}
                      </span>
                      {r.docNumber && (
                        <span className="text-[10px] text-neutral-400 font-mono">
                          {r.docNumber}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-neutral-500 mt-0.5">
                      {r.alert.message}
                    </div>
                  </div>
                  <div className="shrink-0">
                    <OperationsAlertBadge alert={r.alert} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ---------- RECENT CRITICAL EVENTS (audit feed) ---------- */}
      {recentEvents.length > 0 && (
        <div className="rounded-xl border border-neutral-200/80 bg-white shadow-soft p-5">
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-widerx text-neutral-500">
                Recent critical events
              </div>
              <div className="text-xs text-neutral-500 mt-0.5">
                Last 14 days · cancellations, deadline shifts, deletions
                — everything sales + management should know about.
              </div>
            </div>
          </div>
          <ul className="divide-y divide-neutral-100 border border-neutral-200/80 rounded-lg overflow-hidden">
            {recentEvents.map((e) => {
              const actor = e.actor_id
                ? eventActorLabel.get(e.actor_id) ??
                  `user·${e.actor_id.slice(0, 6)}`
                : "system";
              const targetHref =
                e.entity_type === "production_order"
                  ? `/production/orders/${e.entity_id}`
                  : e.entity_type === "task_list"
                    ? `/task-lists/${e.entity_id}`
                    : e.entity_type === "document"
                      ? `/documents/${e.entity_id}`
                      : e.entity_type === "client"
                        ? `/clients/${e.entity_id}`
                        : null;
              return (
                <li
                  key={e.id}
                  className="px-3 py-2.5 hover:bg-neutral-50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${SEVERITY_PILL[e.severity]}`}
                        >
                          {eventTypeLabel(e.event_type as any)}
                        </span>
                        <span className="text-[10px] text-neutral-400 font-mono">
                          {actor}
                        </span>
                      </div>
                      <p className="text-xs text-neutral-700 mt-1 leading-snug">
                        {e.message}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[10px] text-neutral-400 tabular-nums whitespace-nowrap">
                        {relativeTime(e.created_at)}
                      </div>
                      {targetHref && (
                        <Link
                          href={targetHref}
                          className="text-[11px] text-neutral-600 hover:text-neutral-900 whitespace-nowrap"
                        >
                          Open →
                        </Link>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ---------- MY REMINDERS (Phase 3) ----------
          Personal sales tickler. Lists due + upcoming reminders for
          the current user across all quotations. Empty state renders
          a friendly nudge to use the picker on a doc detail page.
          RLS scopes to the user; soft-fails if m043 isn't applied. */}
      <MyRemindersPanel mode="full" currentUserId={userId} />

      {/* ---------- ORDERS IN FLIGHT + ACTIVITY ---------- */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-3">
        <OrdersInFlight orders={ordersInFlight} />
        <ActivityFeed events={events} />
      </div>
      </div>
      </BusinessSlot>

      {/* ==================== OPERATIONS MODE ====================
          Live operational cockpit. Same data as Business mode, but
          re-prioritised: ops cards on top, Operations Feed in the
          middle, KPI summary compact at the bottom. Phase 1 reuses
          existing components — Phase 2 will add status/comments,
          Phase 3 reminders, Phase 4 polish. */}
      <OperationsSlot>
        <div className="space-y-6">
          {/* TOP STRIP — operational KPI cards, the 4 numbers an ops
              manager needs to see first thing each morning. */}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widerx text-neutral-500 mb-1.5">
              Key numbers
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <KpiCard
                label="Revenue in production"
                value={formatMoney(opsRevenueInProduction)}
                featured
              />
              <KpiCard label="Active orders" value={String(opsActiveCount)} />
              <KpiCard
                label="Awaiting deposit"
                value={String(opsAwaitingDepositCount)}
              />
              <KpiCard
                label="Delayed / overdue"
                value={String(opsDelayedCount)}
              />
            </div>
          </div>

          {/* ==================== ACTION CENTER ====================
              Replaces the 4-card category cockpit (Critical / Production /
              Payments / Quotations). Instead of grouping by SYSTEM CATEGORY
              — which forced the eye to scan multiple zones — priorities now
              aggregate by URGENCY + ROLE into a single calm, scannable list.
              Each item is an imperative action that self-clears when handled.
              (cockpitData is still computed above but no longer rendered;
              left in place so this swap stays trivially reversible.)
              =========================================================== */}
          <ActionCenter data={actionData} />

          {/* ORDERS IN FLIGHT — rendered standalone (no outer wrapper).
              OrdersInFlight already provides its own header strip
              + View All link + bordered card chrome, so the previous
              "Orders in production" section just doubled the
              hierarchy. Removing it gives the list more breathing
              room and removes redundant chrome. */}
          <OrdersInFlight orders={ordersInFlight} />

          {/* COMPACT KPI SUMMARY — Business KPIs visible but
              de-prioritised. The ops user can glance at them without
              losing the operational focus. */}
          <section className="rounded-xl border border-neutral-200/80 bg-neutral-50/30 p-4 space-y-3">
            <div className="text-[10px] font-semibold uppercase tracking-widerx text-neutral-500">
              Business snapshot
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiCard
                label="Active pipeline"
                value={formatMoney(livePipelineValue)}
              />
              <KpiCard
                label="Active deals"
                value={String(livePipelineCount)}
              />
              <KpiCard
                label="Revenue · 90d"
                value={formatMoney(liveWon90Revenue)}
              />
              <KpiCard
                label="Lifetime won"
                value={formatMoney(liveLifetimeWonValue)}
              />
            </div>
            <Link
              href="#"
              onClick={undefined}
              className="text-[10px] text-neutral-400 italic block"
            >
              Switch to Business mode for full KPI chart and conversion
              trends.
            </Link>
          </section>
        </div>
      </OperationsSlot>
      </DashboardModeProvider>
    </div>
  );
}

/** Small stat block — used in the pipeline / win-rate cards' footers. */
function Stat({
  label,
  value,
  small,
}: {
  label: string;
  value: string;
  small?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widerx text-neutral-500 font-semibold">
        {label}
      </div>
      <div
        className={`tabular-nums font-bold text-neutral-900 mt-0.5 ${
          small ? "text-base" : "text-lg"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

/** Mini operational stat — used inside the Operations · live panel. */
function MiniOpsStat({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: string;
  tone?: "muted" | "warn" | "danger";
}) {
  const toneClass = {
    muted: "text-neutral-900",
    warn: "text-amber-700",
    danger: "text-rose-700",
  }[tone];
  return (
    <div className="rounded-lg border border-neutral-200/80 bg-neutral-50/50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-widerx text-neutral-500 font-semibold">
        {label}
      </div>
      <div className={`text-lg font-bold tabular-nums tracking-tight mt-0.5 ${toneClass}`}>
        {value}
      </div>
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
