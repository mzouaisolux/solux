import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole } from "@/lib/auth";
import {
  isTechnicalRole,
  computeExpectedDeposit,
  computeExpectedBalance,
  computeProductionDelay,
  PRODUCTION_ORDER_STATUS_LABEL,
  type ProductionOrder,
  type ProductionOrderStatus,
  type PaymentMode,
  type PaymentTerms,
} from "@/lib/types";
import {
  computeOperationsAlert,
  alertPriorityDesc,
  type OperationsAlert,
} from "@/lib/operations-alerts";
import {
  OperationsAlertBadge,
  DelayBadge,
} from "@/components/OperationsAlertBadge";
import { OrderStageBadge } from "@/components/OrderStageBadge";
import { poStatusColors } from "@/lib/status-colors";
import { syncOrphanProductionOrdersAction } from "@/app/(app)/task-lists/[id]/actions";
import { DepositOverrideBadge } from "@/components/StartWithoutDepositButton";
import { hasUiCapability } from "@/lib/permissions";
import { SubmitButton } from "@/components/SubmitButton";
import {
  parseListScope,
  type ListScope,
  type ScopeCounts,
} from "@/lib/queries";
import { ScopeTabs } from "@/components/ScopeTabs";
import { PO_TERMINAL_STATUSES } from "@/lib/lifecycle";
import { CompactOperationalEvents } from "@/components/dashboard/CompactOperationalEvents";
import {
  listOperationsFeed,
  getCommentCountsForEvents,
  getUnreadCommentCountsForUser,
} from "@/lib/events";
import { SalesFilterBar } from "@/components/dashboard/SalesFilterBar";
import {
  parseSalesFilterParam,
  getSalesUsersForFilter,
  getDocIdsOwnedBySales,
} from "@/lib/sales-filter";
import { RoleContextBanner } from "@/components/RoleContextBanner";
import { getVisibilityScope, canSeeRecord } from "@/lib/visibility";

/**
 * Operations — unified operational workspace.
 *
 * One page that consolidates what used to live on /operations AND
 * /order-follow-up. The split created visual duplication (two KPI
 * strips, two summaries) and operationally fragmented the same data.
 *
 * Layout (top to bottom, dense)
 * ------------------------------
 *  1. Header — title + role context + view-filter pills
 *  2. KPI strip — compact inline stats (no oversized cards)
 *  3. Orphan banner — only if there are validated task lists with no PO
 *  4. Action queue — top 5 alerts that need attention (collapsible look)
 *  5. Main table — every order in the current view, color-accented
 *
 * Design goals: compact, scannable, Linear-style. Colors only on the
 * left-border accent + status pill; row backgrounds stay white (except
 * for production_delayed which gets a whisper-faint tint).
 *
 * View filtering — unified across the app via ?scope=… URL param.
 * See lib/queries.ts (parseListScope) for the canonical semantics:
 *  - ?scope=active   (default) → not cancelled, not delivered, not archived
 *  - ?scope=all                → every row
 *  - ?scope=archived           → only archived rows
 *
 * KPIs in the header are always computed off the FULL data set so the
 * pipeline numbers stay honest regardless of which tab is selected.
 */

export default async function OperationsPage({
  searchParams,
}: {
  searchParams: {
    scope?: string;
    q?: string;
    sales?: string | string[];
    status?: string;
  };
}) {
  const scope: ListScope = parseListScope(searchParams?.scope);
  // Optional status-group deep link from the Orders submenu (m099):
  // in_production / shipping / delivered. When set it OVERRIDES the scope
  // filter (so e.g. "delivered" shows even though the default "active" scope
  // hides terminal statuses). "archived" is handled by scope, not here.
  const statusGroup = (searchParams?.status ?? "").trim();
  const STATUS_GROUP_LABEL: Record<string, string> = {
    in_production: "In production",
    shipping: "Shipping",
    delivered: "Delivered",
  };
  // Free-text filter — searches order number, quotation number, task
  // list number, client name/code/country. Composes with the scope.
  const searchQuery = (searchParams?.q ?? "").trim().toLowerCase();
  // NOTE: ?event=<id> on /operations used to auto-open the inline
  // drawer. That drawer is gone (we now route notification clicks to
  // entity pages where the drawer overlays the full context — better
  // UX, more consistent). The compact events strip below the table
  // is just a summary; clicking a row navigates to the entity.

  const { userId, effectiveRole } = await getEffectiveRole();
  const technical = isTechnicalRole(effectiveRole);
  // Sales filter — only technical roles can request one. Falls through
  // to null (= no filter) for sales / non-technical roles.
  const requestedSalesFilter = technical
    ? parseSalesFilterParam(searchParams?.sales)
    : null;
  const targetSalesDocIds = await getDocIdsOwnedBySales(
    requestedSalesFilter
  );
  // Capability-driven UI gating — replaces hardcoded role checks for
  // destructive / sensitive buttons. Backend still enforces via
  // requireCapability() so the gate isn't bypassable.
  const canSyncOrphans = await hasUiCapability("task_list.sync_orphans");

  const supabase = createClient();

  // Pull every production order + its joined doc/client/task_list.
  // We don't filter at the DB layer for scope/archive — we want the
  // unfiltered universe so the filter pills can switch without
  // re-fetching. But we DO narrow by sales when a sales filter is
  // active (technical-role-only feature).
  let ordersBuilder: any = supabase
    .from("production_orders")
    .select(
      `
      *,
      task_lists:task_list_id(number, validated_at, validated_by),
      documents:quotation_id(
        id, number, affair_name, total_price, currency, payment_mode, payment_terms,
        incoterm, created_by, clients:client_id(id, company_name, country, client_code)
      )
      `
    )
    .order("production_validation_date", {
      ascending: false,
      nullsFirst: false,
    });
  if (requestedSalesFilter && targetSalesDocIds !== null) {
    if (targetSalesDocIds.length > 0) {
      ordersBuilder = ordersBuilder.in("quotation_id", targetSalesDocIds);
    } else {
      ordersBuilder = ordersBuilder.eq(
        "id",
        "00000000-0000-0000-0000-000000000000"
      );
    }
  }
  const { data: rawOrders, error: ordersErr } = await ordersBuilder;

  // Orphan detection — task lists at validated/production_ready with no PO.
  const { data: candidateTaskLists } = await supabase
    .from("production_task_lists")
    .select(
      `
      id, number, status, validated_at,
      documents:quotation_id(number, clients:client_id(company_name))
      `
    )
    .in("status", ["validated", "production_ready"])
    .order("validated_at", { ascending: false, nullsFirst: false });

  const linkedTaskListIds = new Set(
    (rawOrders ?? []).map((o: any) => o.task_list_id)
  );
  const orphans = (candidateTaskLists ?? []).filter(
    (tl: any) => !linkedTaskListIds.has(tl.id)
  );

  if (ordersErr) {
    return (
      <div className="mx-auto max-w-3xl p-5">
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4">
          <h1 className="text-base font-semibold text-rose-900">
            Could not load production orders.
          </h1>
          <p className="text-sm text-rose-800 mt-1">{ordersErr.message}</p>
        </div>
      </div>
    );
  }

  // ---- Visibility scope (m067) ----
  // Narrows which orders a GRANTED user may see (e.g. a TLM scoped to one
  // team sees only that team's orders). No grants → legacy behavior
  // (technical sees all, sales see own), so nothing changes for ungranted
  // users. Owner of an order = the linked quotation's sales_owner_id (m066)
  // when set, else its creator. Override fetched defensively so a missing
  // m066 column just falls back to the creator (no breakage).
  const visScope = await getVisibilityScope(userId, effectiveRole);
  const orderOwnerOverride = new Map<string, string>();
  {
    const qids = Array.from(
      new Set(
        ((rawOrders ?? []) as any[]).map((o) => o.quotation_id).filter(Boolean)
      )
    );
    if (qids.length > 0) {
      const { data: ov } = await supabase
        .from("documents")
        .select("id, sales_owner_id")
        .in("id", qids);
      for (const r of (ov ?? []) as any[]) {
        if (r.sales_owner_id) orderOwnerOverride.set(r.id, r.sales_owner_id);
      }
    }
  }
  const orderOwner = (o: any): string | null =>
    (o?.quotation_id ? orderOwnerOverride.get(o.quotation_id) ?? null : null) ??
    (o?.documents?.created_by ?? null);

  const orders = ((rawOrders ?? []) as Array<
    ProductionOrder & { task_lists: any; documents: any }
  >).filter((o) =>
    canSeeRecord(visScope, { ownerId: orderOwner(o), kind: "order" })
  );

  type EnrichedRow = {
    order: ProductionOrder;
    docNumber: string | null;
    affairName: string | null;
    docId: string | null;
    clientName: string;
    clientId: string | null;
    clientCode: string | null;
    incoterm: string | null;
    currency: string;
    totalPrice: number;
    paymentMode: PaymentMode | null;
    paymentTerms: PaymentTerms | null;
    expectedDeposit: number;
    expectedBalance: number;
    balanceRemaining: number;
    delay: number | null;
    alert: OperationsAlert;
    archived: boolean;
  };

  const enriched: EnrichedRow[] = orders.map((row) => {
    const doc = row.documents ?? {};
    const client = doc.clients ?? {};
    const totalPrice = Number(doc.total_price ?? 0);
    const paymentMode = (doc.payment_mode ?? null) as PaymentMode | null;
    const paymentTerms = (doc.payment_terms ?? null) as PaymentTerms | null;
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
    return {
      order: row as ProductionOrder,
      docNumber: doc.number ?? null,
      affairName: (doc as any).affair_name ?? null,
      docId: doc.id ?? null,
      clientName: client.company_name ?? "—",
      clientId: client.id ?? null,
      clientCode: client.client_code ?? null,
      incoterm: doc.incoterm ?? null,
      currency: doc.currency ?? "USD",
      totalPrice,
      paymentMode,
      paymentTerms,
      expectedDeposit,
      expectedBalance,
      balanceRemaining: Math.max(
        0,
        expectedBalance - row.balance_received_amount
      ),
      delay: computeProductionDelay(row as ProductionOrder),
      alert: computeOperationsAlert({
        order: row as ProductionOrder,
        totalPrice,
        paymentMode,
        paymentTerms,
      }),
      archived: !!(row as any).archived_at,
    };
  });

  // KPI numbers — computed off the FULL set (not the filtered view) so
  // the header always reflects reality even when the table is filtered.
  const activeRows = enriched.filter(
    (e) =>
      !e.archived &&
      e.order.status !== "cancelled" &&
      e.order.status !== "delivered"
  );
  const closedRows = enriched.filter(
    (e) =>
      !e.archived &&
      (e.order.status === "cancelled" || e.order.status === "delivered")
  );
  const archivedCount = enriched.filter((e) => e.archived).length;
  const alertingCount = enriched.filter(
    (e) => !e.archived && e.alert.level !== "ok"
  ).length;
  const revenueInPipeline = activeRows.reduce(
    (s, e) => s + e.totalPrice,
    0
  );
  const balanceDueTotal = activeRows.reduce(
    (s, e) => s + e.balanceRemaining,
    0
  );

  // Apply the unified scope filter. Semantics mirror lib/queries.ts
  // applyPOScope() so the in-memory and DB-level paths agree.
  function inScope(e: EnrichedRow, s: ListScope): boolean {
    if (s === "archived") return e.archived;
    if (s === "all") return true;
    // active = not archived AND status not in (cancelled, delivered)
    return (
      !e.archived &&
      !PO_TERMINAL_STATUSES.includes(e.order.status)
    );
  }

  // Text search — composes ON TOP of the scope filter. Searches the
  // PO number, quotation number, task-list number, client name/code/
  // country so the operator can fish by any of those identifiers.
  function matchesSearch(e: EnrichedRow): boolean {
    if (!searchQuery) return true;
    const haystack = [
      e.order.number,
      e.docNumber,
      e.affairName,
      e.clientName,
      e.clientCode,
      // task list number lives one join away — peek into raw row
      (e.order as any).task_lists?.number,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(searchQuery);
  }

  // Status-group predicate (Orders submenu). Overrides scope when present.
  function inStatusGroup(e: EnrichedRow, g: string): boolean {
    const s = e.order.status;
    switch (g) {
      case "in_production":
        return (
          !e.archived &&
          ["awaiting_deposit", "deposit_received", "production_scheduled", "in_production", "production_delayed", "production_completed"].includes(s)
        );
      case "shipping":
        return !e.archived && ["shipment_booked", "shipped"].includes(s);
      case "delivered":
        return s === "delivered";
      default:
        return inScope(e, scope);
    }
  }

  const filtered = enriched
    .filter((e) => inStatusGroup(e, statusGroup))
    .filter(matchesSearch);

  // Counts feed the [Active] [All] [Archived] tabs. Computed off the
  // unfiltered set so the tab labels never disagree with reality.
  // We DON'T apply the search filter to counts — the tabs always
  // report the real per-scope totals, search refines within.
  const scopeCounts: ScopeCounts = {
    active: enriched.filter((e) => inScope(e, "active")).length,
    all: enriched.length,
    archived: enriched.filter((e) => e.archived).length,
  };

  // Bottleneck signals — migrated from /production/orders. Surfaces
  // the 3 most common operational problems above the table.
  //  - Awaiting deposit for > 7 days
  //  - Active order with no production deadline set
  //  - Past-due (deadline < today and not yet completed/shipping)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const awaitingDepositOver7d = enriched.filter((e) => {
    if (e.archived) return false;
    if (e.order.status !== "awaiting_deposit") return false;
    return new Date(e.order.created_at) <= sevenDaysAgo;
  });
  const missingDeadline = enriched.filter((e) => {
    if (e.archived) return false;
    if (PO_TERMINAL_STATUSES.includes(e.order.status)) return false;
    return !e.order.current_production_deadline;
  });
  const pastDueRunning = enriched.filter((e) => {
    if (e.archived) return false;
    if (PO_TERMINAL_STATUSES.includes(e.order.status)) return false;
    if (e.order.status === "production_completed") return false;
    if (!e.order.current_production_deadline) return false;
    return new Date(e.order.current_production_deadline) < today;
  });
  const hasBottlenecks =
    awaitingDepositOver7d.length +
      missingDeadline.length +
      pastDueRunning.length >
    0;

  // Sort: high-priority alerts first, then by validation date.
  const sorted = [...filtered].sort((a, b) => {
    const p = alertPriorityDesc(a.alert, b.alert);
    if (p !== 0) return p;
    const aDate = a.order.production_validation_date ?? a.order.created_at;
    const bDate = b.order.production_validation_date ?? b.order.created_at;
    return new Date(bDate).getTime() - new Date(aDate).getTime();
  });

  // Top alerts — used for the compact action queue.
  const topAlerts = enriched
    .filter((e) => !e.archived && e.alert.level !== "ok")
    .sort((a, b) => alertPriorityDesc(a.alert, b.alert))
    .slice(0, 5);

  // Sales user labels for the table.
  const salesUserIds = Array.from(
    new Set(
      orders
        .map((o: any) => o.documents?.created_by)
        .filter(Boolean) as string[]
    )
  );
  const salesUserLabel = new Map<string, string>();
  if (salesUserIds.length > 0) {
    const { data: rolesRows } = await supabase
      .from("user_roles")
      .select("user_id, role")
      .in("user_id", salesUserIds);
    for (const r of rolesRows ?? []) {
      // Compact role label for the inline owner chip — keeps the
      // ops list readable when 4-5 owners stack up.
      const shortRole = r.role
        .replace("task_list_manager", "tlm")
        .replace("operations", "ops");
      salesUserLabel.set(
        r.user_id,
        `${shortRole}·${String(r.user_id).slice(0, 6)}`
      );
    }
  }

  /* ---------------------------------------------------------------------------
     Operational events feed — collaborative ticket section.
     ---------------------------------------------------------------------------
     This is where the cockpit cards' "View →" links route. The dashboard
     dropped the vertical feed when it switched to the compact cockpit
     (4 cards + summary counters), so this page is now the home of the
     full event list with drawer + comments + workflow actions (m044).
  --------------------------------------------------------------------------- */
  // Fetch the UNFILTERED set first — needed by the sales filter pill
  // bar to count critical events per sales rep. After that, narrow to
  // the target sales' events when ?sales=X is requested.
  const opsFeedEventsAll = await listOperationsFeed({
    daysBack: 30,
    limit: 80,
    recentResolvedHours: 24,
  });

  // Compute sales pill list (technical roles only). Soft-fails to
  // empty list for sales / non-technical / when m047 not applied.
  const salesFilterUsers = technical
    ? await getSalesUsersForFilter(opsFeedEventsAll)
    : [];
  const salesFilterTotalCritical = salesFilterUsers.reduce(
    (s, u) => s + u.criticalCount,
    0
  );

  // Apply the sales filter to the events list used downstream. Same
  // logic as /dashboard — accept events whose entity belongs to the
  // target sales (document / production_order / task_list).
  let opsFeedEvents = opsFeedEventsAll;
  if (requestedSalesFilter) {
    const docSet = new Set(targetSalesDocIds ?? []);
    const poSet = new Set(((rawOrders ?? []) as any[]).map((r) => r.id));
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
      return false;
    });
  }
  /* ---- Conversation-aware aggregates (m045) ----
     Comment + unread counts per event drive the "💬 N" badges and
     the subtle rose dot on the compact 3-column events strip below
     the PO table. Comment THREADS are NOT pre-fetched here anymore
     — the compact strip routes clicks to entity pages where the
     drawer mounts with its own thread fetch. Saves one big query
     on every /operations render. */
  const { userId: opsUserId } = await getEffectiveRole();
  const opsEventIds = opsFeedEvents.map((e) => e.id);
  const opsCommentCountMap = await getCommentCountsForEvents(opsEventIds);
  const opsUnreadCountMap = await getUnreadCommentCountsForUser(
    opsUserId ?? null,
    opsEventIds
  );
  const opsCommentCountObj: Record<string, number> = {};
  opsCommentCountMap.forEach((v, k) => (opsCommentCountObj[k] = v));
  const opsUnreadCountObj: Record<string, number> = {};
  opsUnreadCountMap.forEach((v, k) => (opsUnreadCountObj[k] = v));

  return (
    <div className="po-premium mx-auto max-w-screen-2xl px-6 py-8 space-y-4">
      {/* ============ HEADER ============ */}
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-widerx text-neutral-500">
            Operations
          </div>
          <h1 className="text-xl font-bold tracking-tight text-neutral-900 mt-0.5">
            Production workspace
          </h1>
          <p className="text-xs text-neutral-500 mt-0.5">
            {activeRows.length} active · {closedRows.length} closed
            {archivedCount > 0 ? ` · ${archivedCount} archived` : ""}
            {alertingCount > 0 ? ` · ${alertingCount} need attention` : " · all on track"}
            {` · ${technical ? "technical view" : "sales view (read-only)"}`}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/dashboard" className="btn-secondary !py-1 !text-xs">
            Dashboard
          </Link>
        </div>
      </div>

      {/* ============ ROLE CONTEXT BANNER ============
           Diagnostic: shows green strip for technical (you can edit
           here), amber Reset-View-As banner when super-admin is
           simulating, or neutral read-only notice for sales. Prevents
           the "edit UI disappeared" confusion. */}
      <RoleContextBanner premium />

      {/* ============ SALES FILTER BAR ============
           Technical roles only — narrow every operational surface on
           this page to a single sales rep's data. Sales users never
           see this control. */}
      {technical && salesFilterUsers.length > 0 && (
        <SalesFilterBar
          sales={salesFilterUsers}
          totalCriticalCount={salesFilterTotalCritical}
        />
      )}

      {/* ============ KPI STRIP — compact ============ */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <KpiTile
          label="Revenue in pipeline"
          value={formatMoney(revenueInPipeline)}
          hint={`${activeRows.length} active order${activeRows.length === 1 ? "" : "s"}`}
        />
        <KpiTile
          label="Balance outstanding"
          value={formatMoney(balanceDueTotal)}
          tone={balanceDueTotal > 0 ? "warn" : "muted"}
        />
        <KpiTile
          label="Alerts"
          value={String(alertingCount)}
          tone={alertingCount > 0 ? "danger" : "muted"}
          hint={alertingCount === 0 ? "All on track" : "Need action"}
        />
        <KpiTile
          label="Closed / archived"
          value={`${closedRows.length} / ${archivedCount}`}
          tone="muted"
        />
      </div>

      {/* Operational events feed used to sit here, taking ~40% of
          the viewport before the PO table. It now lives at the
          BOTTOM of the page as a compact 3-column summary
          (Critical / Production / Quotations). Production workspace
          puts the table first. */}

      {/* ============ ORPHAN BANNER (only when relevant) ============ */}
      {orphans.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-amber-900">
              {orphans.length} validated task list
              {orphans.length === 1 ? "" : "s"} not yet linked to a production order.
            </p>
            <p className="text-[11px] text-amber-800 mt-0.5 max-w-2xl">
              The auto-create hook didn&apos;t produce orders for these.{" "}
              {canSyncOrphans
                ? "Click sync to repair."
                : "Ask an admin to run sync from this page."}
            </p>
          </div>
          {canSyncOrphans && (
            <form action={syncOrphanProductionOrdersAction}>
              <SubmitButton
                variant="amber"
                size="md"
                pendingLabel="Syncing…"
                className="whitespace-nowrap"
              >
                Sync {orphans.length}
              </SubmitButton>
            </form>
          )}
        </div>
      )}

      {/* ============ ACTION QUEUE — only when there are alerts ============ */}
      {topAlerts.length > 0 && (
        <div className="rounded-lg border border-neutral-200 bg-white">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-neutral-100">
            <span className="text-[10px] font-semibold uppercase tracking-widerx text-neutral-600">
              Action queue · top {topAlerts.length}
            </span>
            {alertingCount > topAlerts.length && (
              <span className="text-[11px] text-neutral-500">
                +{alertingCount - topAlerts.length} more in the table below
              </span>
            )}
          </div>
          <ul className="divide-y divide-neutral-100">
            {topAlerts.map((e) => {
              const colors = poStatusColors(e.order.status, e.archived);
              return (
                <li key={e.order.id} className="px-3 py-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`inline-block h-3.5 w-1 rounded-sm ${colors.dot}`}
                        aria-hidden
                      />
                      <Link
                        href={`/production/orders/${e.order.id}`}
                        className="text-[12px] font-semibold text-neutral-900 hover:text-solux truncate"
                      >
                        {e.order.number ?? "—"}
                      </Link>
                      <span className="text-[11px] text-neutral-500 truncate">
                        · {e.clientName}
                      </span>
                      <span className="text-[10px] text-neutral-400 truncate">
                        {e.alert.message}
                      </span>
                    </div>
                    <OperationsAlertBadge alert={e.alert} size="xs" />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ============ SCOPE TABS + SEARCH ============ */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* preserveParams keeps `q` alive across scope changes so
            switching tab doesn't reset the user's search. */}
        <ScopeTabs
          scope={scope}
          basePath="/operations"
          counts={scopeCounts}
          preserveParams={{ q: searchQuery }}
        />
        {/* Status-group filter indicator (from the Orders submenu). */}
        {statusGroup && STATUS_GROUP_LABEL[statusGroup] && (
          <div className="flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs text-sky-800">
            <span>
              Filtered to <b>{STATUS_GROUP_LABEL[statusGroup]}</b> — {filtered.length} order{filtered.length === 1 ? "" : "s"}
            </span>
            <a href="/operations" className="font-medium underline hover:no-underline">
              Show all
            </a>
          </div>
        )}
        {/* GET form — preserves the scope param in a hidden field so
            search doesn't reset you to the default scope. */}
        <form method="GET" className="flex items-end gap-2">
          {scope !== "active" && (
            <input type="hidden" name="scope" value={scope} />
          )}
          <input
            name="q"
            defaultValue={searchQuery}
            placeholder="Search PO, quotation, client…"
            className="rounded-md border border-neutral-200 bg-white px-2.5 py-1 text-[11px] w-60 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-md border border-neutral-200 bg-white px-2.5 py-1 text-[11px] font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Apply
          </button>
          {searchQuery && (
            <Link
              href={
                scope === "active"
                  ? "/operations"
                  : `/operations?scope=${scope}`
              }
              className="text-[11px] text-neutral-500 hover:text-neutral-900 px-1"
            >
              Clear
            </Link>
          )}
        </form>
      </div>

      {/* ============ BOTTLENECKS BANNER ============ */}
      {hasBottlenecks && (
        <div className="rounded-lg border border-amber-300 bg-amber-50/60 p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-amber-700">⚠</span>
            <span className="text-xs font-semibold text-amber-900">
              Production bottlenecks
            </span>
          </div>
          <ul className="text-[11px] text-amber-900 space-y-0.5 pl-5 list-disc">
            {awaitingDepositOver7d.length > 0 && (
              <li>
                <b>{awaitingDepositOver7d.length}</b> order
                {awaitingDepositOver7d.length === 1 ? "" : "s"} awaiting
                deposit for over 7 days
              </li>
            )}
            {missingDeadline.length > 0 && (
              <li>
                <b>{missingDeadline.length}</b> active order
                {missingDeadline.length === 1 ? "" : "s"} with no
                production deadline set
              </li>
            )}
            {pastDueRunning.length > 0 && (
              <li>
                <b>{pastDueRunning.length}</b> order
                {pastDueRunning.length === 1 ? "" : "s"} running past
                their current deadline
              </li>
            )}
          </ul>
        </div>
      )}

      {/* ============ MAIN TABLE ============ */}
      <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
        {sorted.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm font-semibold text-neutral-700">
              {searchQuery
                ? `No matches for "${searchQuery}"`
                : "No orders in this view."}
            </p>
            <p className="text-[11px] text-neutral-500 mt-1">
              {searchQuery
                ? "Try clearing the search or switching to All / Archived."
                : scope === "active"
                  ? "No active production orders right now."
                  : scope === "archived"
                    ? "Nothing has been archived yet."
                    : "No orders exist yet."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="bg-neutral-50 text-left">
                  <Th>Order</Th>
                  <Th>Client</Th>
                  <Th>Sales</Th>
                  <Th>Status</Th>
                  <Th align="right">Total</Th>
                  <Th align="right">Deposit</Th>
                  <Th align="right">Balance</Th>
                  <Th>Validated</Th>
                  <Th>Est. completion</Th>
                  <Th>Delay</Th>
                  <Th>Alert</Th>
                  <Th align="right">—</Th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((e) => (
                  <CompactRow
                    key={e.order.id}
                    e={e}
                    salesLabel={
                      (e.order as any).documents?.created_by
                        ? salesUserLabel.get(
                            (e.order as any).documents.created_by
                          ) ?? null
                        : null
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-[10px] text-neutral-400">
        Orders auto-created when a task list is validated. Production team
        updates (deadlines, deposits, shipment) propagate in real-time.
        {technical
          ? " Click any row to open the detail page and edit."
          : " Contact production coordinator to update operational data."}
      </p>

      {/* ============ COMPACT OPERATIONAL EVENTS (3 cols, bottom) ============
           Awareness layer. The PO table above is the workspace; this
           strip just surfaces the open operational tickets without
           dominating the page. Click any row to land on its entity
           page with the conversation drawer overlay. */}
      <CompactOperationalEvents
        events={opsFeedEvents}
        commentCountByEvent={opsCommentCountObj}
        unreadCountByEvent={opsUnreadCountObj}
      />
    </div>
  );
}

/* ===========================================================================
   Subcomponents
   =========================================================================== */

function KpiTile({
  label,
  value,
  hint,
  tone = "muted",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "muted" | "info" | "warn" | "danger";
}) {
  const valueClass = {
    muted: "text-neutral-900",
    info: "text-sky-700",
    warn: "text-amber-700",
    danger: "text-rose-700",
  }[tone];
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-widerx text-neutral-500">
        {label}
      </div>
      <div
        className={`text-base font-bold tabular-nums tracking-tight mt-0.5 leading-tight ${valueClass}`}
      >
        {value}
      </div>
      {hint && <div className="text-[10px] text-neutral-400 mt-0.5">{hint}</div>}
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widerx text-neutral-500 border-b border-neutral-200 ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function CompactRow({
  e,
  salesLabel,
}: {
  e: {
    order: ProductionOrder;
    docNumber: string | null;
    affairName: string | null;
    clientName: string;
    clientId: string | null;
    clientCode: string | null;
    incoterm: string | null;
    currency: string;
    totalPrice: number;
    expectedDeposit: number;
    balanceRemaining: number;
    delay: number | null;
    alert: OperationsAlert;
    archived: boolean;
  };
  salesLabel: string | null;
}) {
  const o = e.order;
  const colors = poStatusColors(o.status, e.archived);
  const depositCovered =
    e.expectedDeposit > 0
      ? o.deposit_received_amount + 0.01 >= e.expectedDeposit
      : null;
  const showBalance = e.balanceRemaining > 0;
  const original = o.initial_production_deadline;
  const estCompletion = o.current_production_deadline;

  return (
    <tr
      className={`border-b border-neutral-100 last:border-b-0 transition-colors hover:bg-neutral-50/70 ${
        e.archived ? "opacity-60" : ""
      } ${colors.rowBg}`}
    >
      <td className={`px-3 py-2 border-l-[3px] ${colors.leftBorder}`}>
        {/* Lead with the project/affair name — that's how ops/factory/sales
            recognize an order. PO + quotation numbers are the technical
            reference underneath. */}
        <Link
          href={`/production/orders/${o.id}`}
          className="font-semibold text-neutral-900 hover:text-solux"
        >
          {e.affairName || o.number || "—"}
        </Link>
        <div className="text-[10px] text-neutral-400 font-mono">
          {o.number ?? "—"}
          {e.docNumber ? ` · ${e.docNumber}` : ""}
        </div>
      </td>
      <td className="px-3 py-2">
        {e.clientId ? (
          <Link
            href={`/clients/${e.clientId}`}
            className="text-neutral-900 hover:text-solux"
          >
            {e.clientName}
          </Link>
        ) : (
          <span className="text-neutral-900">{e.clientName}</span>
        )}
        <div className="text-[10px] text-neutral-500 flex items-center gap-1.5 mt-0.5">
          {e.clientCode && <span className="font-mono">{e.clientCode}</span>}
          {e.incoterm && (
            <span className="rounded bg-neutral-100 px-1 py-px font-mono text-[9px]">
              {e.incoterm}
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-2">
        <span className="text-[10px] text-neutral-500 font-mono">
          {salesLabel ?? "—"}
        </span>
      </td>
      <td className="px-3 py-2">
        <div className="flex items-start gap-1 flex-wrap">
          {/* Real operational lifecycle stage — same source of truth as the
              dashboard Orders-in-Flight strip. Context shown inline. */}
          <OrderStageBadge
            input={{
              production_status: o.status,
              shipment_booked: (o as any).shipment_booked ?? null,
              etd: (o as any).etd ?? null,
              eta: (o as any).eta ?? null,
              delay_days: e.delay,
            }}
            showContext
          />
          {(o as any).deposit_override_at && (
            <DepositOverrideBadge
              activatedAt={(o as any).deposit_override_at}
              reason={(o as any).deposit_override_reason}
              size="xs"
            />
          )}
        </div>
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        <span className="text-neutral-900 font-medium">
          {e.currency} {fmt(e.totalPrice)}
        </span>
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {e.expectedDeposit > 0 ? (
          <>
            <div className="text-neutral-900">
              {fmt(o.deposit_received_amount)} / {fmt(e.expectedDeposit)}
            </div>
            <div
              className={`text-[10px] ${
                depositCovered ? "text-emerald-700" : "text-amber-700"
              }`}
            >
              {depositCovered ? "✓" : "Awaiting"}
            </div>
          </>
        ) : (
          <span className="text-[10px] text-neutral-400">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {showBalance ? (
          <span className="text-rose-700 font-medium">
            {fmt(e.balanceRemaining)}
          </span>
        ) : (
          <span className="text-[10px] text-neutral-400">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-[11px] text-neutral-700 tabular-nums whitespace-nowrap">
        {formatDate(o.production_validation_date)}
      </td>
      <td className="px-3 py-2">
        <div className="text-[11px] text-neutral-900 tabular-nums whitespace-nowrap">
          {formatDate(estCompletion)}
        </div>
        {original && original !== estCompletion && (
          <div
            className="text-[10px] text-neutral-400 tabular-nums line-through whitespace-nowrap"
            title={`Original: ${formatDate(original)}`}
          >
            {formatDate(original)}
          </div>
        )}
      </td>
      <td className="px-3 py-2">
        <DelayBadge delay={e.delay} />
      </td>
      <td className="px-3 py-2">
        <OperationsAlertBadge alert={e.alert} size="xs" />
      </td>
      <td className="px-3 py-2 text-right">
        <Link
          href={`/production/orders/${o.id}`}
          className="text-[11px] font-medium text-neutral-700 hover:text-solux whitespace-nowrap"
        >
          Open →
        </Link>
      </td>
    </tr>
  );
}

/* ---- helpers ---- */

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    year: "2-digit",
  });
}

function fmt(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

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
