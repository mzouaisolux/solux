import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole } from "@/lib/auth";
import { resolveUserLabelStrings } from "@/lib/user-display";
import { TaskListStatusBadge } from "@/components/TaskListWorkflow";
import {
  PRODUCTION_ACTIVE_STATUSES,
  PRODUCTION_SHIPPING_STATUSES,
  PRODUCTION_TERMINAL_STATUSES,
  TASK_LIST_STATUS_LABEL,
  computeProductionDelay,
  isTechnicalRole,
  type ProductionOrderStatus,
  type ProductionTaskListStatus,
} from "@/lib/types";

/**
 * Business overview — executive / operational dashboard.
 *
 * Scope:
 *  - admin + task_list_manager → global company view
 *  - sales                     → personal view (only their own quotations)
 *
 * Revenue definition: `documents.status = 'won'` only. Drafts / sent /
 * lost are intentionally excluded — this is "confirmed business", not
 * pipeline forecasting.
 *
 * All aggregation happens server-side from existing tables. No migrations.
 */
export default async function BusinessDashboardPage() {
  const supabase = createClient();
  // UI uses the effective role so a super-admin "viewing as sales" sees
  // the personal view. The data scoping below relies on the EFFECTIVE
  // role too — that's what simulation is for. Backend permissions remain
  // unchanged (we never bypass them; we just narrow our query).
  const { userId, effectiveRole: role } = await getEffectiveRole();
  // Global view for admin + TLM, personal view for sales (or unknown role).
  const global = isTechnicalRole(role);
  const scopedToMe = !global;

  // ---------- Pull won quotations (the basis for "confirmed revenue") ----------
  // Archived docs are excluded — once a deal is filed away, it shouldn't
  // count in the live business KPIs. Status filter stays explicit at
  // "won" because /business is by definition the "confirmed" page.
  let docsQuery = supabase
    .from("documents")
    .select(
      "id, number, total_price, currency, created_by, client_id, status, date, clients(company_name, country)"
    )
    .eq("status", "won")
    .is("archived_at", null);
  if (scopedToMe && userId) docsQuery = docsQuery.eq("created_by", userId);
  const { data: wonDocs } = await docsQuery;

  // ---------- Pull task lists for pipeline + "in production" tracking ----------
  // The same scoping rules apply, but the task list is per-quotation so we
  // filter through the quotation owner via the quotation_id later instead
  // of putting created_by on the task list directly (TLM may have created
  // the task list, but the sales user owns the deal).
  let tasksQuery = supabase
    .from("production_task_lists")
    .select(
      "id, number, status, quotation_id, date, submitted_at, validated_at"
    );
  // For sales: only task lists tied to their own quotations. We resolve
  // that via the IN clause on quotation_id once we have wonDocs.
  if (scopedToMe) {
    const docIds = (wonDocs ?? []).map((d) => d.id);
    if (docIds.length === 0) {
      tasksQuery = tasksQuery.eq("id", "00000000-0000-0000-0000-000000000000");
    } else {
      tasksQuery = tasksQuery.in("quotation_id", docIds);
    }
  }
  const { data: tasks } = await tasksQuery;

  // ---------- Pull production orders for the operational KPIs ----------
  // Scope is the same as the documents query — sales sees orders linked to
  // their quotations only, admin/TLM sees everything. Archived orders
  // are excluded to align with the live-business semantic; cancelled /
  // delivered are KEPT because the KPI breakdown (in production /
  // completed / shipping) needs them to compute the buckets correctly.
  let ordersQuery = supabase
    .from("production_orders")
    .select(
      "id, status, initial_production_deadline, current_production_deadline, quotation_id, documents:quotation_id(total_price, currency)"
    )
    .is("archived_at", null);
  if (scopedToMe) {
    const docIds = (wonDocs ?? []).map((d) => d.id);
    if (docIds.length === 0) {
      ordersQuery = ordersQuery.eq(
        "id",
        "00000000-0000-0000-0000-000000000000"
      );
    } else {
      ordersQuery = ordersQuery.in("quotation_id", docIds);
    }
  }
  const { data: productionOrders } = await ordersQuery;

  // ---------- Resolve sales-user labels (admin view) ----------
  // Prefers the admin-set display name (m052), falling back to
  // "role · uuid8". Same resolver as forecast + conversations so a
  // rep reads identically everywhere.
  const allOwnerIds = Array.from(
    new Set((wonDocs ?? []).map((d) => d.created_by).filter(Boolean) as string[])
  );
  const labelByUser = await resolveUserLabelStrings(allOwnerIds);

  // ---------- Index helpers ----------
  const docById = new Map<string, any>();
  for (const d of wonDocs ?? []) docById.set(d.id, d);

  // ---------- KPI aggregations ----------
  // We bucket revenue by currency so mixed-currency books don't fudge totals.
  const revenueByCurrency = new Map<string, number>();
  const inProductionByCurrency = new Map<string, number>();
  const awaitingValidationByCurrency = new Map<string, number>();

  for (const d of wonDocs ?? []) {
    const cur = (d.currency ?? "USD") as string;
    revenueByCurrency.set(
      cur,
      (revenueByCurrency.get(cur) ?? 0) + Number(d.total_price || 0)
    );
  }

  // Map each won doc → its (most recent) task list status.
  const taskByDoc = new Map<string, ProductionTaskListStatus>();
  for (const t of tasks ?? []) {
    if (!t.quotation_id) continue;
    // Prefer the latest by submitted_at, else first.
    const existing = taskByDoc.get(t.quotation_id);
    if (!existing) taskByDoc.set(t.quotation_id, t.status);
  }

  for (const d of wonDocs ?? []) {
    const cur = (d.currency ?? "USD") as string;
    const ts = taskByDoc.get(d.id);
    if (!ts || ts === "cancelled") continue;
    if (ts === "validated" || ts === "production_ready") {
      inProductionByCurrency.set(
        cur,
        (inProductionByCurrency.get(cur) ?? 0) +
          Number(d.total_price || 0)
      );
    } else if (
      ts === "under_validation" ||
      ts === "needs_revision" ||
      ts === "draft"
    ) {
      awaitingValidationByCurrency.set(
        cur,
        (awaitingValidationByCurrency.get(cur) ?? 0) +
          Number(d.total_price || 0)
      );
    }
  }

  // Pipeline counts by status (only non-cancelled).
  const pipelineCounts: Record<ProductionTaskListStatus, number> = {
    draft: 0,
    under_validation: 0,
    needs_revision: 0,
    validated: 0,
    production_ready: 0,
    cancelled: 0,
  };
  for (const t of tasks ?? []) {
    const k = t.status as ProductionTaskListStatus;
    if (k in pipelineCounts) pipelineCounts[k]++;
  }
  const ordersInProgress =
    pipelineCounts.draft +
    pipelineCounts.under_validation +
    pipelineCounts.needs_revision +
    pipelineCounts.validated;
  const pendingShipments = pipelineCounts.production_ready;
  const totalActiveOrders = ordersInProgress + pendingShipments;

  // Won-without-task-list — useful "bottleneck" indicator.
  const wonWithoutTaskList = (wonDocs ?? []).filter(
    (d) => !taskByDoc.has(d.id)
  ).length;

  // ---------- Production operations KPIs ----------
  let productionActive = 0;
  let productionDelayed = 0;
  let upcomingShipments = 0;
  let awaitingDeposit = 0;
  const revenueInProductionOps = new Map<string, number>();
  for (const o of (productionOrders ?? []) as any[]) {
    const status = o.status as ProductionOrderStatus;
    const isActive = PRODUCTION_ACTIVE_STATUSES.includes(status);
    const isShipping = PRODUCTION_SHIPPING_STATUSES.includes(status);
    const isTerminal = PRODUCTION_TERMINAL_STATUSES.includes(status);
    if (isActive) productionActive++;
    if (status === "awaiting_deposit") awaitingDeposit++;
    if (status === "production_delayed") productionDelayed++;
    if (isShipping) upcomingShipments++;
    if (!isTerminal) {
      const cur = o.documents?.currency ?? "USD";
      revenueInProductionOps.set(
        cur,
        (revenueInProductionOps.get(cur) ?? 0) +
          Number(o.documents?.total_price ?? 0)
      );
    }
    // Also count delays even if not in "production_delayed" state — e.g.
    // current deadline is past initial but still labeled "in_production".
    if (status !== "production_delayed") {
      const delay = computeProductionDelay({
        initial_production_deadline: o.initial_production_deadline,
        current_production_deadline: o.current_production_deadline,
      });
      if (delay !== null && delay > 0 && !isTerminal) productionDelayed++;
    }
  }

  // ---------- Sales performance per user (admin only) ----------
  type SalesRow = {
    user_id: string;
    label: string;
    won: number;
    active: number;
    revenue_by_currency: Map<string, number>;
  };
  const salesRows: SalesRow[] = [];
  if (global) {
    const byUser = new Map<string, SalesRow>();
    for (const d of wonDocs ?? []) {
      const uid = d.created_by;
      if (!uid) continue;
      let row = byUser.get(uid);
      if (!row) {
        row = {
          user_id: uid,
          label: labelByUser.get(uid) ?? uid.slice(0, 8) + "…",
          won: 0,
          active: 0,
          revenue_by_currency: new Map(),
        };
        byUser.set(uid, row);
      }
      row.won++;
      const cur = (d.currency ?? "USD") as string;
      row.revenue_by_currency.set(
        cur,
        (row.revenue_by_currency.get(cur) ?? 0) + Number(d.total_price || 0)
      );
    }
    // Count active orders per user (task list status not cancelled).
    for (const t of tasks ?? []) {
      if (t.status === "cancelled") continue;
      const doc = docById.get(t.quotation_id);
      if (!doc?.created_by) continue;
      const row = byUser.get(doc.created_by);
      if (row) row.active++;
    }
    salesRows.push(...byUser.values());
    // Sort by primary-currency revenue (USD if present, else first currency).
    salesRows.sort((a, b) => {
      const av =
        a.revenue_by_currency.get("USD") ??
        Array.from(a.revenue_by_currency.values())[0] ??
        0;
      const bv =
        b.revenue_by_currency.get("USD") ??
        Array.from(b.revenue_by_currency.values())[0] ??
        0;
      return bv - av;
    });
  }
  const totalUsdRevenue = revenueByCurrency.get("USD") ?? 0;

  // ---------- RENDER ----------
  return (
    <div className="mx-auto max-w-screen-2xl px-6 py-8 space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="eyebrow">Business overview</div>
          <h1 className="doc-title mt-1">
            {global ? "Company performance" : "My performance"}
          </h1>
          <p className="text-xs text-neutral-500 mt-2 max-w-xl">
            Confirmed revenue and operational pipeline at a glance. Revenue
            comes from <b>won quotations only</b> — drafts, sent, and lost
            quotations are excluded.
          </p>
        </div>
        <div className="text-right">
          <div className="eyebrow">View</div>
          <div
            className={`mt-1 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
              global
                ? "border-neutral-900 bg-neutral-900 text-white"
                : "border-sky-300 bg-sky-50 text-sky-800"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                global ? "bg-emerald-400" : "bg-sky-400"
              }`}
            />
            {global ? "Global · company-wide" : "Personal · my deals only"}
          </div>
        </div>
      </div>

      {/* ---------- KPI strip ---------- */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <KpiCard
          label="Confirmed revenue"
          primary={formatMoneyMap(revenueByCurrency)}
          hint={`From ${wonDocs?.length ?? 0} won quotation${
            (wonDocs?.length ?? 0) === 1 ? "" : "s"
          }`}
          accent="emerald"
        />
        <KpiCard
          label="Revenue in production"
          primary={formatMoneyMap(inProductionByCurrency)}
          hint="Won deals with validated or production-ready task lists"
        />
        <KpiCard
          label="Revenue awaiting validation"
          primary={formatMoneyMap(awaitingValidationByCurrency)}
          hint="Won deals whose task list is still being prepared / reviewed"
          accent="amber"
        />
        <KpiCard
          label="Orders in progress"
          primary={String(ordersInProgress)}
          hint="Task lists in draft / under validation / needs revision / validated"
        />
        <KpiCard
          label="Pending shipments"
          primary={String(pendingShipments)}
          hint="Task lists marked production-ready, awaiting factory release"
          accent="emerald"
        />
        <KpiCard
          label="Total active orders"
          primary={String(totalActiveOrders)}
          hint="All non-cancelled task lists"
        />
      </div>

      {/* ---------- Production operations KPIs (live) ---------- */}
      <section className="space-y-3">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-lg font-semibold">
              Production operations
            </h2>
            <p className="text-xs text-neutral-500">
              Live state of the factory floor — deposit, deadlines, delays,
              and shipments. Auto-updates as the production team works.
            </p>
          </div>
          <Link
            href="/production/orders"
            className="text-xs text-neutral-500 hover:text-neutral-900 hover:underline"
          >
            All production orders →
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <KpiCard
            label="Awaiting deposit"
            primary={String(awaitingDeposit)}
            hint="Production gated until deposit clears"
            accent={awaitingDeposit > 0 ? "amber" : undefined}
          />
          <KpiCard
            label="Active production"
            primary={String(productionActive)}
            hint="Deposit-received through in-production"
          />
          <KpiCard
            label="Delayed orders"
            primary={String(productionDelayed)}
            hint="Marked delayed or running past initial deadline"
            accent={productionDelayed > 0 ? "amber" : undefined}
          />
          <KpiCard
            label="Upcoming shipments"
            primary={String(upcomingShipments)}
            hint="Production complete or booked, awaiting departure"
            accent="emerald"
          />
          <KpiCard
            label="Revenue in production"
            primary={formatMoneyMap(revenueInProductionOps)}
            hint="Non-terminal production orders, by currency"
          />
        </div>
      </section>

      {/* ---------- Operational pipeline ---------- */}
      <section className="space-y-3">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-lg font-semibold">Operational pipeline</h2>
            <p className="text-xs text-neutral-500">
              Where every active order sits right now — spot bottlenecks at a
              glance.
            </p>
          </div>
          <Link
            href="/task-lists"
            className="text-xs text-neutral-500 hover:text-neutral-900 hover:underline"
          >
            All task lists →
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {(
            [
              "draft",
              "under_validation",
              "needs_revision",
              "validated",
              "production_ready",
            ] as ProductionTaskListStatus[]
          ).map((status) => (
            <Link
              key={status}
              href={`/task-lists?status=${status}`}
              className="panel p-4 hover:bg-neutral-50 transition group"
            >
              <TaskListStatusBadge status={status} />
              <div className="mt-3 text-2xl font-semibold tabular-nums">
                {pipelineCounts[status]}
              </div>
              <div className="text-[11px] text-neutral-500 mt-0.5">
                {status === "production_ready"
                  ? "Ready for factory release"
                  : status === "validated"
                  ? "Technical enrichment"
                  : status === "needs_revision"
                  ? "Bounced back to sales"
                  : status === "under_validation"
                  ? "Awaiting review"
                  : "Sales still preparing"}
              </div>
            </Link>
          ))}
        </div>
        {wonWithoutTaskList > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-800">
            <b>{wonWithoutTaskList}</b> won quotation
            {wonWithoutTaskList === 1 ? "" : "s"} ha
            {wonWithoutTaskList === 1 ? "s" : "ve"} no task list yet — sales
            still needs to generate the production handoff.
          </div>
        )}
      </section>

      {/* ---------- Sales performance (admin/TLM only) ---------- */}
      {global && (
        <section className="space-y-3">
          <div className="flex items-end justify-between">
            <div>
              <h2 className="text-lg font-semibold">Sales performance</h2>
              <p className="text-xs text-neutral-500">
                Ranked by USD-equivalent confirmed revenue (won quotations
                only). Mixed currencies shown separately.
              </p>
            </div>
          </div>
          {salesRows.length === 0 ? (
            <div className="panel p-10 text-center text-sm text-neutral-500">
              No won quotations yet. Once sales mark deals as won, they'll
              appear here.
            </div>
          ) : (
            <div className="panel overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-solux-accent text-left">
                    <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-widerx text-neutral-700 w-10">
                      #
                    </th>
                    <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-widerx text-neutral-700">
                      Sales user
                    </th>
                    <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-widerx text-neutral-700 text-right">
                      Won
                    </th>
                    <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-widerx text-neutral-700 text-right">
                      Active
                    </th>
                    <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-widerx text-neutral-700 text-right">
                      Confirmed revenue
                    </th>
                    <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-widerx text-neutral-700 text-right w-32">
                      % of total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {salesRows.map((r, i) => {
                    const userUsd =
                      r.revenue_by_currency.get("USD") ??
                      Array.from(r.revenue_by_currency.values())[0] ??
                      0;
                    const pct =
                      totalUsdRevenue > 0
                        ? (userUsd / totalUsdRevenue) * 100
                        : 0;
                    return (
                      <tr
                        key={r.user_id}
                        className="border-t border-neutral-100 hover:bg-neutral-50/70"
                      >
                        <td className="px-4 py-3 text-neutral-400 tabular-nums">
                          {i + 1}
                        </td>
                        <td className="px-4 py-3 capitalize font-medium">
                          {r.label}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {r.won}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {r.active}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums">
                          {formatMoneyMap(r.revenue_by_currency)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 h-1.5 bg-neutral-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-solux"
                                style={{
                                  width: `${Math.min(100, pct).toFixed(1)}%`,
                                }}
                              />
                            </div>
                            <span className="tabular-nums text-xs text-neutral-700 w-10 text-right">
                              {pct.toFixed(0)}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/** Compact KPI card. Primary value can be a string with multiple lines. */
function KpiCard({
  label,
  primary,
  hint,
  accent,
}: {
  label: string;
  primary: string;
  hint?: string;
  accent?: "emerald" | "amber";
}) {
  const accentClass =
    accent === "emerald"
      ? "text-emerald-700"
      : accent === "amber"
      ? "text-amber-700"
      : "text-neutral-900";
  return (
    <div className="panel p-4">
      <div className="eyebrow">{label}</div>
      <div
        className={`mt-2 text-2xl font-semibold tabular-nums leading-tight whitespace-pre-line ${accentClass}`}
      >
        {primary}
      </div>
      {hint && (
        <div className="text-[11px] text-neutral-500 mt-1.5">{hint}</div>
      )}
    </div>
  );
}

/** Format a (currency → amount) map into a multi-line string. */
function formatMoneyMap(m: Map<string, number>): string {
  if (m.size === 0) return "$0";
  // USD first, then others alphabetical.
  const keys = Array.from(m.keys()).sort((a, b) => {
    if (a === "USD") return -1;
    if (b === "USD") return 1;
    return a.localeCompare(b);
  });
  return keys
    .map((k) => {
      const v = m.get(k) ?? 0;
      const formatted = v.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      });
      return `${k} ${formatted}`;
    })
    .join("\n");
}
