import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole } from "@/lib/auth";
import { resolveUserLabelStrings } from "@/lib/user-display";
import { getVisibilityScope, canSeeRecord } from "@/lib/visibility";
import { TaskListStatusBadge } from "@/components/TaskListWorkflow";
import { SalesFilter, type SalesOption } from "@/components/task-lists/SalesFilter";
import {
  TASK_LIST_STATUSES,
  TASK_LIST_STATUS_LABEL,
  TASK_LIST_TLM_QUEUE,
  isTechnicalRole,
  type ProductionTaskListStatus,
} from "@/lib/types";

export default async function TaskListsPage({
  searchParams,
}: {
  searchParams: { status?: string; sales?: string };
}) {
  const supabase = createClient();
  const { userId, effectiveRole: role } = await getEffectiveRole();
  const technical = isTechnicalRole(role);
  // Visibility scope (m067): narrows the rows a granted user may see.
  // No grants → legacy (technical = all, sales = own), so nothing changes
  // for ungranted users.
  const scope = await getVisibilityScope(userId, role);
  // Selected sales owners (quotation creators) to filter by. Multi-select
  // lives in the URL as a comma-separated list of user ids.
  const selectedSales = (searchParams.sales ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  let query = supabase
    .from("production_task_lists")
    .select(
      "id, number, status, date, shipping_method, quotation_id, submitted_at, clients(company_name, country), documents:quotation_id(number, affair_name, total_price, currency, created_by)"
    )
    .order("date", { ascending: false })
    .limit(200);

  if (
    searchParams.status &&
    TASK_LIST_STATUSES.includes(
      searchParams.status as ProductionTaskListStatus
    )
  ) {
    query = query.eq("status", searchParams.status);
  }

  const { data: listsRaw } = await query;

  // ---- Sales (owner) options + workload ----
  // The owner of a task list = the SALES who created the linked quotation.
  // We load a lightweight, status-aware set of ALL visible task lists (RLS
  // already scopes: a sales sees only their own; TLM/admin see the team)
  // to build the sales filter + per-sales workload counters.
  const { data: salesSrc } = await supabase
    .from("production_task_lists")
    .select("status, submitted_at, quotation_id, documents:quotation_id(created_by)")
    .limit(2000);

  // Effective owner = assigned sales_owner_id (m066) on the linked
  // quotation when set, else its creator. Override fetched defensively so a
  // missing m066 column just falls back to the creator (no breakage).
  const ownerOverrideByDoc = new Map<string, string>();
  {
    const qids = Array.from(
      new Set(
        [
          ...((salesSrc ?? []) as any[]).map((r) => r.quotation_id),
          ...((listsRaw ?? []) as any[]).map((r) => r.quotation_id),
        ].filter(Boolean)
      )
    );
    if (qids.length > 0) {
      const { data: ov } = await supabase
        .from("documents")
        .select("id, sales_owner_id")
        .in("id", qids);
      for (const r of (ov ?? []) as any[]) {
        if (r.sales_owner_id) ownerOverrideByDoc.set(r.id, r.sales_owner_id);
      }
    }
  }
  const ownerOf = (
    quotationId: string | null | undefined,
    createdBy: string | null | undefined
  ): string | null =>
    (quotationId ? ownerOverrideByDoc.get(quotationId) ?? null : null) ??
    (createdBy ?? null);

  // A task list awaiting validation longer than this is "overdue" — the
  // loud signal for a TLM ("who's been waiting too long on me?").
  const VALIDATION_OVERDUE_DAYS = 3;
  const overdueCutoff =
    Date.now() - VALIDATION_OVERDUE_DAYS * 24 * 60 * 60 * 1000;

  const ownerIds = new Set<string>();
  const perSales = new Map<
    string,
    { total: number; pending: number; overdue: number }
  >();
  for (const r of (salesSrc ?? []) as any[]) {
    const owner = ownerOf(r.quotation_id, r.documents?.created_by);
    if (!owner) continue;
    if (
      !canSeeRecord(scope, {
        ownerId: owner,
        kind: "task_list",
        status: r.status,
      })
    )
      continue;
    ownerIds.add(owner);
    const e = perSales.get(owner) ?? { total: 0, pending: 0, overdue: 0 };
    e.total++;
    // "Pending" = the TLM's review queue (awaiting validation). "Overdue"
    // = pending AND submitted more than N days ago.
    if (r.status === "under_validation") {
      e.pending++;
      const submitted = r.submitted_at ? new Date(r.submitted_at).getTime() : 0;
      if (submitted && submitted < overdueCutoff) e.overdue++;
    }
    perSales.set(owner, e);
  }
  for (const r of (listsRaw ?? []) as any[]) {
    const owner = ownerOf(r.quotation_id, r.documents?.created_by);
    if (
      owner &&
      canSeeRecord(scope, {
        ownerId: owner,
        kind: "task_list",
        status: r.status,
      })
    )
      ownerIds.add(owner);
  }

  // Canonical Display Names (Admin → User roles, via user_profiles m052).
  // Resolved fresh each render, so a name change propagates app-wide.
  const ownerLabels = await resolveUserLabelStrings([...ownerIds]);

  const salesOptions: SalesOption[] = [...ownerIds]
    .map((id) => ({
      id,
      name: ownerLabels.get(id) ?? `user·${id.slice(0, 6)}`,
      total: perSales.get(id)?.total ?? 0,
      pending: perSales.get(id)?.pending ?? 0,
      overdue: perSales.get(id)?.overdue ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Displayed rows: first the visibility scope (what this user is allowed
  // to see), then the manual Sales filter on top.
  const lists = (listsRaw ?? []).filter((t: any) => {
    const owner = ownerOf(t.quotation_id, t.documents?.created_by);
    if (
      !canSeeRecord(scope, {
        ownerId: owner,
        kind: "task_list",
        status: t.status,
      })
    )
      return false;
    if (selectedSales.length > 0) return selectedSales.includes(owner ?? "");
    return true;
  });

  // This page is now the SINGLE operational inbox (the separate Review queue
  // is gone): items awaiting the Task List Manager's review (under_validation)
  // float to the top, oldest submitted first (most overdue on top).
  const needsReviewStatus = (s: string) => s === "under_validation";
  const sortedLists = [...lists].sort((a: any, b: any) => {
    const ar = needsReviewStatus(a.status) ? 0 : 1;
    const br = needsReviewStatus(b.status) ? 0 : 1;
    if (ar !== br) return ar - br;
    if (ar === 0) {
      const at = new Date(a.submitted_at ?? a.date).getTime();
      const bt = new Date(b.submitted_at ?? b.date).getTime();
      return at - bt; // oldest awaiting-review first
    }
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });
  const needsReviewCount = lists.filter((t: any) =>
    needsReviewStatus(t.status)
  ).length;

  // Per-status counts so the tabs stay accurate while filtering.
  const { data: counts } = await supabase
    .from("production_task_lists")
    .select("status");
  const statusCounts: Record<ProductionTaskListStatus | "all", number> = {
    all: counts?.length ?? 0,
    draft: 0,
    under_validation: 0,
    needs_revision: 0,
    validated: 0,
    production_ready: 0,
    cancelled: 0,
  };
  for (const d of counts ?? []) {
    const k = d.status as ProductionTaskListStatus;
    if (k in statusCounts) statusCounts[k]++;
  }
  const tlmQueueCount = TASK_LIST_TLM_QUEUE.reduce(
    (n, s) => n + (statusCounts[s] ?? 0),
    0
  );

  function tabHref(s?: ProductionTaskListStatus) {
    return s ? `/task-lists?status=${s}` : `/task-lists`;
  }

  return (
    <div className="po-premium mx-auto max-w-screen-2xl px-6 py-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="eyebrow">Production</div>
          <h1 className="doc-title mt-1">Task lists</h1>
          <p className="text-xs text-neutral-500 mt-2 max-w-xl">
            Multi-stage workflow: sales drafts a task list and submits it for
            production validation. The production team validates, enriches
            with technical references, then releases the factory PDF.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1 text-sm border-b border-neutral-200">
        {[
          { key: "all" as const, label: "All" },
          ...TASK_LIST_STATUSES.map((s) => ({
            key: s,
            label: TASK_LIST_STATUS_LABEL[s],
          })),
        ].map((tab) => {
          const active =
            tab.key === "all"
              ? !searchParams.status
              : searchParams.status === tab.key;
          const count =
            tab.key === "all" ? statusCounts.all : statusCounts[tab.key];
          return (
            <Link
              key={tab.key}
              href={tabHref(
                tab.key === "all"
                  ? undefined
                  : (tab.key as ProductionTaskListStatus)
              )}
              className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 ${
                active
                  ? "border-neutral-900 text-neutral-900 font-semibold"
                  : "border-transparent text-neutral-500 hover:text-neutral-900"
              }`}
            >
              {tab.label}
              <span className="text-[11px] text-neutral-500 tabular-nums">
                {count}
              </span>
            </Link>
          );
        })}
      </div>

      {/* Needs-action banner — the consolidated "review queue" signal. Pulses
          so a TLM lands on what's awaiting them without a second page. */}
      {technical && needsReviewCount > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50/70 px-4 py-2.5 flex items-center gap-2.5">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
          </span>
          <span className="text-sm font-semibold text-amber-900">
            {needsReviewCount} task list{needsReviewCount === 1 ? "" : "s"}{" "}
            awaiting your review
          </span>
          <span className="text-[11px] text-amber-700 hidden sm:inline">
            — highlighted below, oldest first.
          </span>
        </div>
      )}

      {/* Sales (owner) filter — for the TLM/admin who supervise the team.
          Always shown for technical roles (the SalesFilter renders nothing
          when there are zero owners). Chips carry workload counters. */}
      {technical && (
        <SalesFilter options={salesOptions} selected={selectedSales} />
      )}

      <div className="panel overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-solux-accent text-left">
              <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-widerx text-neutral-700">
                Project
              </th>
              <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-widerx text-neutral-700">
                Client
              </th>
              <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-widerx text-neutral-700">
                Sales
              </th>
              <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-widerx text-neutral-700">
                Country
              </th>
              <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-widerx text-neutral-700 text-right">
                Amount
              </th>
              <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-widerx text-neutral-700">
                Date
              </th>
              <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-widerx text-neutral-700">
                Status
              </th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {sortedLists.map((t: any) => {
              const affair = t.documents?.affair_name as string | null;
              const total = Number(t.documents?.total_price ?? 0);
              const currency = (t.documents?.currency ?? "USD") as string;
              const ownerId = ownerOf(t.quotation_id, t.documents?.created_by);
              const salesName = ownerId
                ? ownerLabels.get(ownerId) ?? `user·${ownerId.slice(0, 6)}`
                : "—";
              const needsAction = t.status === "under_validation";
              return (
                <tr
                  key={t.id}
                  className={`border-t border-neutral-100 hover:bg-neutral-50/70 ${
                    needsAction ? "bg-amber-50/50" : ""
                  }`}
                >
                  {/* Project — lead with the affair name (what the team
                      actually remembers); codes are the secondary line. */}
                  <td className="px-4 py-3">
                    <Link
                      href={`/task-lists/${t.id}`}
                      className="block group"
                    >
                      {affair ? (
                        <span className="block text-[13px] font-semibold text-neutral-900 group-hover:underline">
                          {affair}
                        </span>
                      ) : (
                        <span className="block font-mono text-[13px] text-neutral-900 group-hover:underline">
                          {t.number}
                        </span>
                      )}
                      <span className="block font-mono text-[11px] text-neutral-400">
                        {t.number}
                        {t.documents?.number ? ` · ${t.documents.number}` : ""}
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-medium">
                    {t.clients?.company_name ?? "—"}
                  </td>
                  {/* Sales owner — canonical Display Name (Admin → User
                      roles). Mandatory column for team supervision. */}
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 text-[13px] text-neutral-800">
                      <span
                        className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-neutral-200 text-[9px] font-semibold uppercase text-neutral-600"
                        aria-hidden
                      >
                        {salesName !== "—" ? salesName.slice(0, 2) : "·"}
                      </span>
                      {salesName}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs uppercase text-neutral-500">
                    {t.clients?.country ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-neutral-800 whitespace-nowrap">
                    {total > 0 ? `${currency} ${total.toLocaleString()}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-neutral-600 whitespace-nowrap">
                    {new Date(t.date).toLocaleDateString("en-GB", {
                      month: "short",
                      day: "2-digit",
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <TaskListStatusBadge
                        status={t.status as ProductionTaskListStatus}
                      />
                      {needsAction && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800 whitespace-nowrap">
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-70" />
                            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-500" />
                          </span>
                          Needs review
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/task-lists/${t.id}`}
                      className={
                        needsAction
                          ? "inline-flex items-center rounded-md bg-amber-500 text-white px-3 py-1.5 text-xs font-semibold hover:bg-amber-600 whitespace-nowrap"
                          : "row-link"
                      }
                    >
                      {needsAction ? "Review →" : "Open →"}
                    </Link>
                  </td>
                </tr>
              );
            })}
            {(!lists || lists.length === 0) && (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-12 text-center text-neutral-500 text-sm"
                >
                  No production task lists yet. Mark a quotation as <b>Won</b>{" "}
                  and click <b>+ Task list</b> on its page.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
