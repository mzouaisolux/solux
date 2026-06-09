import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole } from "@/lib/auth";
import { hasUiCapability } from "@/lib/permissions";
import { resolveUserLabelStrings } from "@/lib/user-display";
import { eventTypeLabel } from "@/lib/events";
import {
  PROJECT_REQUEST_STATUS_LABEL,
  type ProjectRequestStatus,
} from "@/lib/types";
import { projectStatusColors } from "@/lib/project-status-colors";
import { ProjectStatusBadge } from "@/components/projects/ProjectStatusBadge";
import { ClickableRow } from "@/components/projects/ClickableRow";
import { ScopeTabs } from "@/components/ScopeTabs";
import { parseListScope, type ListScope } from "@/lib/queries";
import { summarizeProjects, countBuckets, BUCKET_STATUSES } from "@/lib/project-dashboard";
import { ProjectActionsWidget } from "@/components/projects/ProjectActionsWidget";

export const dynamic = "force-dynamic";

/** A dashboard bucket: count + label, links to a filtered view. */
function Bucket({
  label,
  count,
  href,
  tone,
}: {
  label: string;
  count: number;
  href: string;
  tone?: string;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center justify-between gap-3 rounded-lg border bg-white px-3.5 py-3 transition-colors hover:bg-neutral-50 ${
        tone ?? "border-neutral-200"
      }`}
    >
      <span className="text-[12px] font-medium text-neutral-600">{label}</span>
      <span className="text-lg font-semibold tabular-nums text-neutral-900">{count}</span>
    </Link>
  );
}

export default async function ProjectsDashboardPage({
  searchParams,
}: {
  searchParams: { scope?: string; status?: string; mine?: string };
}) {
  const supabase = createClient();
  const { userId } = await getEffectiveRole();
  const [canCreate, canApprove, canCost, canLogistics] = await Promise.all([
    hasUiCapability("project.create"),
    hasUiCapability("project.approve"),
    hasUiCapability("project.enter_cost"),
    hasUiCapability("project.enter_logistics"),
  ]);
  const isOps = canCost || canLogistics;

  const { data: rowsRaw } = await supabase
    .from("project_requests")
    .select("id, name, status, country, quantity, opportunity_value, owner_id, archived_at, created_at, clients:client_id(company_name)")
    .order("created_at", { ascending: false });
  const rows = (rowsRaw ?? []) as any[];
  const summary = summarizeProjects(rows, userId);

  // Ops pending counts (RLS-scoped) — only when the user works the queue.
  let costPending = 0;
  let packPending = 0;
  let freightPending = 0;
  if (isOps) {
    const [c, pk, fr] = await Promise.all([
      supabase.from("factory_cost_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("packing_list_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("freight_cost_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
    ]);
    costPending = c.count ?? 0;
    packPending = pk.count ?? 0;
    freightPending = fr.count ?? 0;
  }

  // Recent activity (director) — RLS-scoped project events.
  let recent: any[] = [];
  if (canApprove) {
    const { data } = await supabase
      .from("events")
      .select("id, event_type, message, created_at, entity_id")
      .eq("entity_type", "project_request")
      .order("created_at", { ascending: false })
      .limit(8);
    recent = data ?? [];
  }

  // ---- filtered list below the dashboard ----
  const scope: ListScope = parseListScope(searchParams?.scope);
  const statusFilter = searchParams?.status;
  const statusSet = statusFilter ? new Set(BUCKET_STATUSES[statusFilter] ?? [statusFilter]) : null;
  const mine = searchParams?.mine === "1";

  let listed = rows.filter((r) => {
    if (scope === "active" && r.archived_at) return false;
    if (scope === "archived" && !r.archived_at) return false;
    if (mine && r.owner_id !== userId) return false;
    if (statusSet && !statusSet.has(r.status)) return false;
    return true;
  });
  const activeCount = rows.filter((r) => !r.archived_at).length;
  const counts = { active: activeCount, all: rows.length, archived: rows.length - activeCount };

  const ownerIds = Array.from(new Set(rows.map((r) => r.owner_id).filter(Boolean))) as string[];
  const ownerLabels = await resolveUserLabelStrings(ownerIds);
  const money = (n: number | null) => (n == null ? "—" : `$${Number(n).toLocaleString()}`);
  const my = (sts: string[]) => countBuckets(summary.mineByStatus, sts);
  const all = (sts: string[]) => countBuckets(summary.byStatus, sts);

  return (
    <div className="po-premium mx-auto max-w-screen-2xl px-6 py-8 space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="eyebrow">{summary.total} active project requests</div>
          <h1 className="doc-title mt-1">Projects</h1>
        </div>
        {canCreate && (
          <Link href="/projects/new" className="btn-primary shrink-0">
            + New project
          </Link>
        )}
      </div>

      {/* ACTION REQUIRED — leads the page with what needs the user now */}
      <ProjectActionsWidget />

      {/* MY WORK (Sales) */}
      {canCreate && (
        <section className="space-y-2">
          <div className="eyebrow">My work</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            <Bucket label="Drafts" count={my(["draft"])} href="/projects?mine=1&status=drafts" />
            <Bucket label="Waiting review" count={my(["waiting_director_approval"])} href="/projects?mine=1&status=waiting_approval" />
            <Bucket label="Operations in progress" count={my(BUCKET_STATUSES.waiting_costing)} href="/projects?mine=1&status=waiting_costing" />
            <Bucket label="Ready for pricing" count={my(["ready_for_pricing"])} href="/projects?mine=1&status=ready_for_pricing" />
            <Bucket label="Priced" count={my(["priced"])} href="/projects?mine=1&status=priced" />
            <Bucket label="Quotation ready" count={my(["quotation_generated"])} href="/projects?mine=1&status=quotation_ready" />
            <Bucket label="Won" count={my(["won"])} href="/projects?mine=1&status=won" />
            <Bucket label="Lost" count={my(["lost"])} href="/projects?mine=1&status=lost" />
          </div>
        </section>
      )}

      {/* APPROVALS & PRICING (Director) */}
      {canApprove && (
        <section className="space-y-2">
          <div className="eyebrow">Approvals &amp; pricing</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Bucket label="Waiting review" count={all(["waiting_director_approval"])} href="/projects/approvals" tone="border-amber-200" />
            <Bucket label="Operations in progress" count={all(BUCKET_STATUSES.waiting_costing)} href="/projects?status=waiting_costing" tone="border-indigo-200" />
            <Bucket label="Ready for pricing" count={all(["ready_for_pricing"])} href="/projects?status=ready_for_pricing" tone="border-violet-200" />
            <Bucket label="Priced" count={all(["priced"])} href="/projects?status=priced" />
          </div>
          {recent.length > 0 && (
            <div className="rounded-lg border border-neutral-200 bg-white p-3">
              <div className="text-[10px] uppercase tracking-wide text-neutral-400">Recent activity</div>
              <ul className="mt-1 space-y-1">
                {recent.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 text-[12px]">
                    <Link href={`/projects/${e.entity_id}`} className="truncate text-neutral-700 hover:underline">
                      <span className="font-medium">{eventTypeLabel(e.event_type)}</span>
                      {e.message ? ` — ${e.message}` : ""}
                    </Link>
                    <span className="shrink-0 text-neutral-400">{e.created_at ? new Date(e.created_at).toLocaleDateString() : ""}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* OPERATIONAL QUEUE (Ops / TLM / Finance) */}
      {isOps && (
        <section className="space-y-2">
          <div className="eyebrow">Operational queue</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Bucket label="Pending factory costs" count={costPending} href="/projects/cost-requests" tone="border-indigo-200" />
            <Bucket label="Pending packing" count={packPending} href="/projects/logistics-requests" tone="border-teal-200" />
            <Bucket label="Pending freight" count={freightPending} href="/projects/logistics-requests" tone="border-teal-200" />
          </div>
        </section>
      )}

      {/* LIST */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="eyebrow">
            {mine ? "My projects" : "All projects"}
            {statusFilter ? ` · ${PROJECT_REQUEST_STATUS_LABEL[(BUCKET_STATUSES[statusFilter]?.[0] ?? statusFilter) as ProjectRequestStatus] ?? statusFilter}` : ""}
          </div>
          <div className="flex items-center gap-3">
            {(statusFilter || mine) && (
              <Link href="/projects" className="text-[12px] text-neutral-500 hover:underline">
                Clear filter
              </Link>
            )}
            <ScopeTabs scope={scope} basePath="/projects" counts={counts} preserveParams={{ status: statusFilter, mine: mine ? "1" : undefined }} />
          </div>
        </div>
        <div className="panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-solux-accent text-left">
                <th className="px-3 py-2 text-xs font-semibold text-neutral-700">Project</th>
                <th className="px-3 py-2 text-xs font-semibold text-neutral-700">Client</th>
                <th className="px-3 py-2 text-xs font-semibold text-neutral-700">Country</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-neutral-700">Qty</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-neutral-700">Opportunity</th>
                <th className="px-3 py-2 text-xs font-semibold text-neutral-700">Owner</th>
                <th className="px-3 py-2 text-xs font-semibold text-neutral-700">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {listed.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-10 text-center text-neutral-500">
                    Nothing here right now.
                    {canCreate && (
                      <>
                        {" "}
                        <Link href="/projects/new" className="row-link">
                          Create a project →
                        </Link>
                      </>
                    )}
                  </td>
                </tr>
              ) : (
                listed.map((r) => (
                  <ClickableRow key={r.id} href={`/projects/${r.id}`} className="group cursor-pointer border-t border-neutral-100 hover:bg-neutral-50">
                    <td className={`border-l-2 px-3 py-2 ${projectStatusColors(r.status, r.archived_at).leftBorder}`}>
                      <Link href={`/projects/${r.id}`} className="font-medium text-neutral-900 hover:underline">
                        {r.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-neutral-700">{r.clients?.company_name ?? "—"}</td>
                    <td className="px-3 py-2 text-neutral-600">{r.country ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.quantity ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(r.opportunity_value)}</td>
                    <td className="px-3 py-2 text-neutral-600">{r.owner_id ? ownerLabels.get(r.owner_id) ?? "—" : "—"}</td>
                    <td className="px-3 py-2">
                      <ProjectStatusBadge status={r.status} archived={!!r.archived_at} />
                    </td>
                    <td className="px-3 py-2 text-right text-[12px] font-medium text-neutral-400 opacity-0 transition-opacity group-hover:opacity-100 whitespace-nowrap">
                      Open →
                    </td>
                  </ClickableRow>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
