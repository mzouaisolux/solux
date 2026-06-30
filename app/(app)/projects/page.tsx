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

/** A dashboard bucket: count + label, links to a filtered view. `act` adds the
 *  amber attention bar (mockup `.bucket.act`). */
function Bucket({
  label,
  count,
  href,
  act,
}: {
  label: string;
  count: number;
  href: string;
  act?: boolean;
}) {
  return (
    <Link href={href} className={`sx-bucket ${act ? "act" : ""}`}>
      <span className="bl">{label}</span>
      <span className="bn sx-tnum">{count}</span>
    </Link>
  );
}

export default async function ProjectsDashboardPage({
  searchParams,
}: {
  searchParams: { scope?: string; status?: string; mine?: string; page?: string };
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

  // ---- filtered-list params (drive the SQL list query below) ----
  const scope: ListScope = parseListScope(searchParams?.scope);
  const statusFilter = searchParams?.status;
  const statusSet = statusFilter ? new Set(BUCKET_STATUSES[statusFilter] ?? [statusFilter]) : null;
  const mine = searchParams?.mine === "1";
  const PAGE_SIZE = 50;
  const page = Math.max(1, Number(searchParams?.page) || 1);

  // ---- dashboard status counts via a grouped SQL aggregate (RPC m127) —
  //      correct & cheap at any volume. Defensive: if the RPC isn't applied
  //      yet, fall back to the legacy fetch-all + JS summarize.
  let summary: ReturnType<typeof summarizeProjects>;
  {
    const { data: cnts, error } = await supabase.rpc("project_request_status_counts");
    if (!error && cnts) {
      const byStatus: Record<string, number> = {};
      const mineByStatus: Record<string, number> = {};
      let total = 0;
      for (const r of cnts as any[]) {
        const t = Number(r.total) || 0;
        const m = Number(r.mine) || 0;
        byStatus[r.status] = t;
        total += t;
        if (m) mineByStatus[r.status] = m;
      }
      summary = { byStatus, mineByStatus, total };
    } else {
      const { data: legacy } = await supabase
        .from("project_requests")
        .select("status, owner_id, archived_at");
      summary = summarizeProjects((legacy ?? []) as any[], userId);
    }
  }

  // ---- scope-tab counts (active / all / archived) via SQL counts ----
  const [allRes, archRes] = await Promise.all([
    supabase.from("project_requests").select("id", { count: "exact", head: true }),
    supabase.from("project_requests").select("id", { count: "exact", head: true }).not("archived_at", "is", null),
  ]);
  const allCount = allRes.count ?? 0;
  const archivedCount = archRes.count ?? 0;
  const counts = { active: allCount - archivedCount, all: allCount, archived: archivedCount };

  // ---- the list: server-side filtered + paginated. One query returns the
  //      page rows AND the exact filtered total (count:"exact"). ----
  let listQ = supabase
    .from("project_requests")
    .select(
      "id, name, status, country, quantity, opportunity_value, owner_id, archived_at, clients:client_id(company_name)",
      { count: "exact" }
    )
    .order("created_at", { ascending: false });
  if (scope === "active") listQ = listQ.is("archived_at", null);
  else if (scope === "archived") listQ = listQ.not("archived_at", "is", null);
  if (mine && userId) listQ = listQ.eq("owner_id", userId);
  if (statusSet) listQ = listQ.in("status", Array.from(statusSet));
  const { data: listedRaw, count: listTotal } = await listQ.range(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE - 1
  );
  const listed = (listedRaw ?? []) as any[];
  const totalPages = Math.max(1, Math.ceil((listTotal ?? 0) / PAGE_SIZE));

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

  // Owner labels only for the rows actually on this page (bounded).
  const ownerIds = Array.from(new Set(listed.map((r) => r.owner_id).filter(Boolean))) as string[];
  const ownerLabels = await resolveUserLabelStrings(ownerIds);
  const money = (n: number | null) => (n == null ? "—" : `$${Number(n).toLocaleString()}`);
  const my = (sts: string[]) => countBuckets(summary.mineByStatus, sts);
  const all = (sts: string[]) => countBuckets(summary.byStatus, sts);

  // Left-border accent for a list row (mockup `.lb` tones) — mirrors the
  // status badge palette: amber for director review, green for commercial
  // outcomes, ink for in-flight, neutral line otherwise.
  const lbTone = (status: string, archived: string | null) =>
    projectStatusColors(status as ProjectRequestStatus, Boolean(archived)).leftBorder;

  // Status filter row (mockup `.stabs`). Each chip deep-links the list below
  // via ?status=<key>; counts come from the active-only `byStatus` summary.
  const statusTabs: { key: string | null; label: string; dot?: string; statuses: string[] }[] = [
    { key: null, label: "All", statuses: [] },
    { key: "drafts", label: "Draft", dot: "sx-d-neutral", statuses: ["draft"] },
    { key: "submitted", label: "Submitted", dot: "sx-d-ink", statuses: ["submitted"] },
    { key: "waiting_approval", label: "Waiting director review", dot: "sx-d-amber", statuses: ["waiting_director_approval"] },
    { key: "waiting_costing", label: "Operations in progress", dot: "sx-d-ink", statuses: BUCKET_STATUSES.waiting_costing },
    { key: "ready_for_pricing", label: "Ready for pricing", dot: "sx-d-ink", statuses: ["ready_for_pricing"] },
    { key: "priced", label: "Priced", dot: "sx-d-ink", statuses: ["priced"] },
    { key: "quotation_ready", label: "Quotation generated", dot: "sx-d-green", statuses: ["quotation_generated"] },
    { key: "won", label: "Won", dot: "sx-d-green", statuses: ["won"] },
    { key: "lost", label: "Lost", dot: "sx-d-neutral", statuses: ["lost"] },
    { key: "cancelled", label: "Cancelled", dot: "sx-d-neutral", statuses: ["cancelled"] },
  ];
  const tabHref = (key: string | null) => {
    const qs = new URLSearchParams();
    if (key) qs.set("status", key);
    if (mine) qs.set("mine", "1");
    const s = qs.toString();
    return s ? `/projects?${s}` : "/projects";
  };
  // Pagination links preserve the current scope / status / mine filters.
  const pageHref = (p: number) => {
    const qs = new URLSearchParams();
    if (scope !== "active") qs.set("scope", scope);
    if (statusFilter) qs.set("status", statusFilter);
    if (mine) qs.set("mine", "1");
    if (p > 1) qs.set("page", String(p));
    const s = qs.toString();
    return s ? `/projects?${s}` : "/projects";
  };

  return (
    <div className="solux-pro sx-page">
      <div className="sx-wrap">
        {/* HEADER */}
        <div className="sx-head">
          <div>
            <div className="sx-eyebrow">{summary.total} active service requests</div>
            <h1 className="sx-h1">Service requests</h1>
            <p className="sx-sub">
              Custom &amp; tender opportunities moving through approval, factory costing,
              logistics and pricing — from draft to a generated quotation.
            </p>
          </div>
          {canCreate && (
            <Link href="/projects/new" className="sx-btn sx-btn-go">
              <span>+</span> New service request
            </Link>
          )}
        </div>

        {/* STATUS TABS — deep-link the list below by status */}
        <div className="sx-stabs">
          {statusTabs.map((tab) => {
            const active = (tab.key ?? null) === (statusFilter ?? null);
            const count = tab.key === null ? summary.total : all(tab.statuses);
            return (
              <Link key={tab.label} href={tabHref(tab.key)} className={`sx-stab ${active ? "active" : ""}`}>
                {tab.dot && <span className={`dot ${tab.dot}`} />}
                {tab.label} <span className="n">{count}</span>
              </Link>
            );
          })}
        </div>

        {/* ACTION REQUIRED — leads with what needs the user now */}
        <ProjectActionsWidget />

        {/* MY WORK (Sales) */}
        {canCreate && (
          <>
            <div className="sx-sectitle">
              <h2>My work</h2>
              <div className="rhs"><span className="sx-micro">Sales</span></div>
            </div>
            <div className="sx-bgrid c8">
              <Bucket label="Drafts" count={my(["draft"])} href="/projects?mine=1&status=drafts" />
              <Bucket label="Waiting review" count={my(["waiting_director_approval"])} href="/projects?mine=1&status=waiting_approval" act />
              <Bucket label="Operations" count={my(BUCKET_STATUSES.waiting_costing)} href="/projects?mine=1&status=waiting_costing" />
              <Bucket label="Ready for pricing" count={my(["ready_for_pricing"])} href="/projects?mine=1&status=ready_for_pricing" />
              <Bucket label="Priced" count={my(["priced"])} href="/projects?mine=1&status=priced" />
              <Bucket label="Quotation ready" count={my(["quotation_generated"])} href="/projects?mine=1&status=quotation_ready" />
              <Bucket label="Won" count={my(["won"])} href="/projects?mine=1&status=won" />
              <Bucket label="Lost" count={my(["lost"])} href="/projects?mine=1&status=lost" />
            </div>
          </>
        )}

        {/* APPROVALS & PRICING (Director) */}
        {canApprove && (
          <>
            <div className="sx-sectitle">
              <h2>Approvals &amp; pricing</h2>
              <div className="rhs"><span className="sx-micro">Director</span></div>
            </div>
            <div className="sx-bgrid c4">
              <Bucket label="Waiting review" count={all(["waiting_director_approval"])} href="/projects/approvals" act />
              <Bucket label="Operations in progress" count={all(BUCKET_STATUSES.waiting_costing)} href="/projects?status=waiting_costing" />
              <Bucket label="Ready for pricing" count={all(["ready_for_pricing"])} href="/projects?status=ready_for_pricing" act />
              <Bucket label="Priced" count={all(["priced"])} href="/projects?status=priced" />
            </div>
            {recent.length > 0 && (
              <div className="sx-recent">
                <div className="sx-micro">Recent activity</div>
                {recent.map((e) => (
                  <div key={e.id} className="r">
                    <Link href={`/projects/${e.entity_id}`}>
                      <b>{eventTypeLabel(e.event_type)}</b>
                      {e.message ? ` — ${e.message}` : ""}
                    </Link>
                    <span className="t">{e.created_at ? new Date(e.created_at).toLocaleDateString() : ""}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* OPERATIONAL QUEUE (Ops / TLM / Finance) */}
        {isOps && (
          <>
            <div className="sx-sectitle">
              <h2>Operational queue</h2>
              <div className="rhs"><span className="sx-micro">Ops · TLM · Finance</span></div>
            </div>
            <div className="sx-bgrid c3">
              <Bucket label="Pending factory costs" count={costPending} href="/projects/cost-requests" act />
              <Bucket label="Pending packing" count={packPending} href="/projects/logistics-requests" act />
              <Bucket label="Pending freight" count={freightPending} href="/projects/logistics-requests" act />
            </div>
          </>
        )}

        {/* LIST */}
        <div className="sx-sectitle">
          <h2>
            {mine ? "My service requests" : "All service requests"}
            {statusFilter ? ` · ${PROJECT_REQUEST_STATUS_LABEL[(BUCKET_STATUSES[statusFilter]?.[0] ?? statusFilter) as ProjectRequestStatus] ?? statusFilter}` : ""}
          </h2>
          <div className="rhs">
            {(statusFilter || mine) && (
              <Link href="/projects" className="sx-clear">
                Clear filter
              </Link>
            )}
            <ScopeTabs scope={scope} basePath="/projects" counts={counts} preserveParams={{ status: statusFilter, mine: mine ? "1" : undefined }} />
          </div>
        </div>
        <div className="sx-panel">
          <table className="sx-list">
            <thead>
              <tr>
                <th>Service request</th>
                <th>Client</th>
                <th>Country</th>
                <th className="r">Qty</th>
                <th className="r">Opportunity</th>
                <th>Owner</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {listed.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <div className="sx-empty">
                      Nothing here right now.
                      {canCreate && (
                        <>
                          {" "}
                          <Link href="/projects/new">Create a service request →</Link>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                listed.map((r) => (
                  <ClickableRow key={r.id} href={`/projects/${r.id}`}>
                    <td className={`border-l-[3px] ${lbTone(r.status, r.archived_at)}`}>
                      <Link href={`/projects/${r.id}`} className="pname">
                        {r.name}
                      </Link>
                    </td>
                    <td>{r.clients?.company_name ?? "—"}</td>
                    <td>{r.country ?? "—"}</td>
                    <td className="r sx-tnum">{r.quantity ?? "—"}</td>
                    <td className="r sx-tnum">{money(r.opportunity_value)}</td>
                    <td>{r.owner_id ? ownerLabels.get(r.owner_id) ?? "—" : "—"}</td>
                    <td>
                      <ProjectStatusBadge status={r.status} archived={!!r.archived_at} />
                    </td>
                    <td className="r">
                      <span className="open">Open →</span>
                    </td>
                  </ClickableRow>
                ))
              )}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div
            className="sx-pager"
            style={{ display: "flex", gap: 12, justifyContent: "center", alignItems: "center", marginTop: 12, fontSize: 13 }}
          >
            {page > 1 ? (
              <Link href={pageHref(page - 1)} className="sx-clear">← Prev</Link>
            ) : (
              <span />
            )}
            <span className="sx-micro">Page {page} / {totalPages}</span>
            {page < totalPages ? (
              <Link href={pageHref(page + 1)} className="sx-clear">Next →</Link>
            ) : (
              <span />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
