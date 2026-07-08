import { createClient } from "@/lib/supabase/server";
import { canAccessOrAdmin, hasUiCapability } from "@/lib/permissions";
import { resolveUserLabelStrings } from "@/lib/user-display";
import AccessDenied from "@/components/AccessDenied";
import { loadAffairProfitability } from "@/lib/profitability-server";
import { OverviewTable, type OverviewRow } from "./OverviewTable";

export const dynamic = "force-dynamic";

/**
 * SERVICE REQUEST OVERVIEW — /projects/overview
 *
 * Read-only central list of EVERY service request in the system, for the
 * supervision roles (sales_director, operations, admins). Sales directors
 * only met requests one-by-one in the approval queue; this page gives them
 * (and Operations) the global picture — who owns what, where it stands,
 * when it last moved. Zero workflow change: clicking a row opens the
 * EXISTING request page; nothing here mutates anything.
 *
 * Access = capability `project.view_overview` (m148 grants it to
 * sales_director + operations; admin/super_admin pass via the
 * canAccessOrAdmin anti-lockout floor). Data visibility is unchanged:
 * the query runs under the caller's RLS, and those roles already have
 * org-wide SELECT on project_requests (m090/m132).
 */

// Fetch-all bound. Explicit (not PostgREST's silent row cap) so growth past
// it degrades VISIBLY: the table shows "showing X of Y". Filtering/sorting
// is client-side, which is right at current volumes (tens of rows).
const FETCH_CAP = 2000;

export default async function ServiceRequestOverviewPage() {
  const allowed = await canAccessOrAdmin(["project.view_overview"]);
  if (!allowed) return <AccessDenied capability="project.view_overview" />;

  const supabase = createClient();
  const { data, count } = await supabase
    .from("project_requests")
    .select(
      "id, name, status, opportunity_value, created_at, updated_at, archived_at, owner_id, affair_id, clients:client_id(company_name)",
      { count: "exact" }
    )
    .order("updated_at", { ascending: false })
    .limit(FETCH_CAP);
  const raw = (data ?? []) as any[];

  const ownerIds = Array.from(
    new Set(raw.map((r) => r.owner_id).filter(Boolean))
  ) as string[];
  const ownerLabels = await resolveUserLabelStrings(ownerIds);

  // m152 — Overall-margin column, management only. Bounded on purpose (perf):
  // only priced/quoted/won rows can have a margin, newest-first, hard cap —
  // rows beyond it show a dash. The loader batches everything; the column is
  // entirely absent for non-holders (no greyed placeholder).
  const MARGIN_ROW_CAP = 300;
  const showMargin = await hasUiCapability("project.view_profitability");
  const marginByAffair = new Map<
    string,
    { pct: number | null; health: "green" | "yellow" | "red" | null; partial: boolean }
  >();
  if (showMargin) {
    const eligible = raw
      .filter(
        (r) =>
          !r.archived_at &&
          r.affair_id &&
          ["priced", "quotation_generated", "won"].includes(r.status)
      )
      .slice(0, MARGIN_ROW_CAP);
    const profitMap = await loadAffairProfitability(
      supabase,
      eligible.map((r) => r.affair_id)
    );
    for (const [affairId, res] of profitMap) {
      if (res.ok) {
        marginByAffair.set(affairId, {
          pct: res.overallPct,
          health: res.overallHealth,
          partial: res.partial,
        });
      }
    }
  }

  const rows: OverviewRow[] = raw.map((r) => ({
    id: r.id,
    name: r.name ?? "—",
    status: r.status,
    archived: Boolean(r.archived_at),
    client: r.clients?.company_name ?? "—",
    amount: r.opportunity_value == null ? null : Number(r.opportunity_value),
    owner: r.owner_id ? ownerLabels.get(r.owner_id) ?? "—" : "—",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    margin: r.affair_id ? marginByAffair.get(r.affair_id) ?? null : null,
  }));

  return (
    <div className="solux-pro sx-page">
      <div className="sx-wrap">
        <div className="sx-head">
          <div>
            <div className="sx-eyebrow">
              {count ?? rows.length} service requests in the system
            </div>
            <h1 className="sx-h1">Service Request Overview</h1>
            <p className="sx-sub">
              Every request, wherever it stands — follow progress across
              salespeople and customers. Read-only: open a row to work on the
              request itself.
            </p>
          </div>
        </div>
        <OverviewTable
          rows={rows}
          total={count ?? rows.length}
          showMargin={showMargin}
        />
      </div>
    </div>
  );
}
