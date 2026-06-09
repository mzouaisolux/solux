import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole } from "@/lib/auth";
import { resolveUserLabelStrings } from "@/lib/user-display";
import NewClientPanel from "./NewClientPanel";
import ClientsWorkspaceList from "./ClientsWorkspaceList";
import { isTechnicalRole, DOC_ACTIVE_STATUSES } from "@/lib/types";
import { getVisibilityScope, canSeeRow } from "@/lib/visibility";
import { hasUiCapability } from "@/lib/permissions";
import { parseListScope, type ListScope } from "@/lib/queries";
import { ScopeTabs } from "@/components/ScopeTabs";
import { ClientAffairTree } from "@/components/clients/ClientAffairTree";
import { getAllClientAffairs } from "@/lib/client-affairs";
import type { ClientAffairs } from "@/lib/affairs-prototype";

/**
 * Unified client-centric sales workspace.
 *
 * The Clients page is now the daily sales hub — quotation history lives
 * inside each expandable client row. No more separate "Quotations" page.
 *
 * Scope:
 *  - admin / TLM → company-wide
 *  - sales       → only their own quotations (clients are global, but the
 *                  documents we fetch are filtered to created_by = me)
 */
export default async function ClientsWorkspacePage({
  searchParams,
}: {
  searchParams: { scope?: string; view?: string };
}) {
  const supabase = createClient();
  const { userId, effectiveRole } = await getEffectiveRole();
  const global = isTechnicalRole(effectiveRole);
  const canCreateQuotation = await hasUiCapability("quotation.create");
  const canDeleteQuotation = await hasUiCapability("quotation.delete");
  // Active / All / Archived — same vocabulary as docs/POs/task lists.
  const scope: ListScope = parseListScope(searchParams?.scope);

  // Client visibility is RLS-scoped (m058): Sales sees only clients they
  // own or have quoted; admin / TLM / operations / super see the full
  // directory. This query runs under the user's session, so the rows it
  // returns are already filtered by the database — no app-level role
  // branch needed here.
  // We fetch ALL visible clients (active + archived) and filter in-memory
  // based on the requested scope. Filtering server-side via `.is("archived_at",
  // null)` would break hard when migration 031 hasn't been applied yet
  // (column missing → PostgREST error → empty page with no recovery
  // path). The two-branch fetch below is defensive: if the column is
  // missing the fallback treats every client as active.
  let allClients: any[] = [];
  let archivedColumnExists = true;
  {
    const full = await supabase
      .from("clients")
      .select(
        "id, company_name, client_code, contact_name, email, phone_number, country, archived_at, created_by"
      )
      .order("company_name", { ascending: true });
    if (full.error) {
      // Likely: archived_at column doesn't exist yet (migration 031
      // not applied). Fall back to the legacy shape and treat every
      // row as active.
      archivedColumnExists = false;
      const fallback = await supabase
        .from("clients")
        .select(
          "id, company_name, client_code, contact_name, email, phone_number, country"
        )
        .order("company_name", { ascending: true });
      allClients = (fallback.data ?? []).map((c: any) => ({
        ...c,
        archived_at: null,
      }));
    } else {
      allClients = full.data ?? [];
    }
  }

  // ---- Sales owner (account manager) per client ----
  // Effective owner = assigned sales_owner_id (m066) when set, else the
  // creator (clients.created_by, m058). Fetched defensively so a missing
  // m066 column never breaks the page.
  const ownerOverrideById = new Map<string, string>();
  {
    const { data: ov } = await supabase
      .from("clients")
      .select("id, sales_owner_id");
    for (const r of (ov ?? []) as any[]) {
      if (r.sales_owner_id) ownerOverrideById.set(r.id, r.sales_owner_id);
    }
  }
  const effectiveOwnerByClient = new Map<string, string | null>();
  for (const c of allClients as any[]) {
    effectiveOwnerByClient.set(
      c.id,
      ownerOverrideById.get(c.id) ?? (c.created_by as string | null) ?? null
    );
  }

  // ---- Visibility scope (m067) ----
  // RLS already isolates Sales to their own clients; this narrows further
  // for GRANTED management users (e.g. a TLM scoped to one team/region sees
  // only that team's accounts). No grants → legacy behavior (technical sees
  // all, sales see own), so nothing changes for ungranted users.
  const visScope = await getVisibilityScope(userId, effectiveRole);
  allClients = allClients.filter((c: any) =>
    canSeeRow(visScope, effectiveOwnerByClient.get(c.id) ?? null)
  );
  const visibleClientIds = new Set(allClients.map((c: any) => c.id));

  // Counts for the ScopeTabs widget.
  const activeCount = allClients.filter((c: any) => !c.archived_at).length;
  const archivedCount = allClients.length - activeCount;
  const scopeCounts = {
    active: activeCount,
    all: allClients.length,
    archived: archivedCount,
  };

  // Apply scope filter for the actual list to render.
  const clients =
    scope === "all"
      ? allClients
      : scope === "archived"
        ? allClients.filter((c: any) => !!c.archived_at)
        : allClients.filter((c: any) => !c.archived_at);

  // Resolve owners to canonical Display Names (user_profiles m052) so
  // management can see + filter by who owns each account.
  const ownerIds = Array.from(
    new Set(
      [...effectiveOwnerByClient.values()].filter(
        (v): v is string => !!v
      )
    )
  );
  const ownerLabels = await resolveUserLabelStrings(ownerIds);
  // clientId → { id, name } for the owner.
  const salesByClient: Record<string, { id: string | null; name: string }> = {};
  for (const c of allClients as any[]) {
    const oid = effectiveOwnerByClient.get(c.id) ?? null;
    salesByClient[c.id] = {
      id: oid,
      name: oid ? ownerLabels.get(oid) ?? `user·${oid.slice(0, 6)}` : "—",
    };
  }

  // Documents — scoped per role. Sales sees only deals they own.
  // affair_name (m056) is requested but tolerated-absent: if the column
  // isn't there yet, we retry without it so the list never breaks.
  const docsCols =
    "id, number, client_id, type, date, total_price, status, currency, created_by, affair_name, version, root_document_id";
  const docsColsLegacy =
    "id, number, client_id, type, date, total_price, status, currency, created_by";
  function buildDocsQuery(cols: string) {
    let q = supabase
      .from("documents")
      .select(cols)
      .limit(5000)
      .order("date", { ascending: false });
    if (!global && userId) q = q.eq("created_by", userId);
    return q;
  }
  let docsRes = await buildDocsQuery(docsCols);
  if (
    docsRes.error &&
    /(affair_name|version|root_document_id)/.test(docsRes.error.message ?? "")
  ) {
    docsRes = await buildDocsQuery(docsColsLegacy);
  }
  const docsRaw = docsRes.data;
  const docs = (docsRaw ?? []).map((d: any) => ({
    id: d.id,
    number: d.number,
    client_id: d.client_id,
    type: d.type,
    date: d.date,
    total_price: Number(d.total_price || 0),
    status: d.status,
    currency: d.currency,
    affair_name: d.affair_name ?? null,
    version: Number(d.version ?? 1),
  }))
    // Client-centric page: keep only docs for clients this user can see, so
    // the header counters and per-client history match the visible list.
    .filter((d: any) => visibleClientIds.has(d.client_id));

  // Pre-resolve task lists + production orders tied to the documents in
  // this view so the expanded rows can show production status without
  // per-row fetches.
  const docIds = docs.map((d) => d.id);
  let taskLists: Array<{
    id: string;
    number: string | null;
    quotation_id: string;
  }> = [];
  let productionOrders: Array<{
    id: string;
    number: string | null;
    quotation_id: string;
    status: string;
    initial_production_deadline: string | null;
    current_production_deadline: string | null;
  }> = [];
  if (docIds.length > 0) {
    const [{ data: tls }, { data: pos }] = await Promise.all([
      supabase
        .from("production_task_lists")
        .select("id, number, quotation_id, date")
        .in("quotation_id", docIds)
        .order("date", { ascending: false }),
      supabase
        .from("production_orders")
        .select(
          "id, number, quotation_id, status, initial_production_deadline, current_production_deadline"
        )
        .in("quotation_id", docIds),
    ]);
    taskLists = (tls ?? []).map((t: any) => ({
      id: t.id,
      number: t.number,
      quotation_id: t.quotation_id,
    }));
    productionOrders = (pos ?? []).map((p: any) => ({
      id: p.id,
      number: p.number,
      quotation_id: p.quotation_id,
      status: p.status,
      initial_production_deadline: p.initial_production_deadline,
      current_production_deadline: p.current_production_deadline,
    }));
  }

  // Top counters for the header eyebrow.
  const totalActive = docs.filter((d) =>
    DOC_ACTIVE_STATUSES.includes(d.status as any)
  ).length;
  const totalWon = docs.filter((d) => d.status === "won").length;

  // ---- Drill-down tree (prototype): Client → Affair → Quotation version ----
  // Default view. Built from the affair grouping, scoped to the clients visible
  // in the current scope. The flat list stays reachable at ?view=flat.
  const view = searchParams?.view === "flat" ? "flat" : "tree";
  let treeClients: ClientAffairs[] = [];
  if (view === "tree") {
    const scopedIds = new Set((clients ?? []).map((c: any) => c.id));
    const all = await getAllClientAffairs();
    treeClients = all.filter((ca) => ca.clientId && scopedIds.has(ca.clientId));
  }

  return (
    <div className="po-premium mx-auto max-w-screen-2xl px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="eyebrow">
            {clients?.length ?? 0} clients · {totalActive} active deals ·{" "}
            {totalWon} won
          </div>
          <h1 className="doc-title mt-1">Clients</h1>
          <p className="text-sm text-neutral-500 mt-2 max-w-xl">
            Drill down Client → Affair → Quotation version. The affair owns the
            operational status; each version keeps its commercial status.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <NewClientPanel />
          {canCreateQuotation && (
            <Link href="/documents/new" className="btn-primary">
              + New quotation
            </Link>
          )}
        </div>
      </div>

      {/* Scope tabs — Active is the daily view; All shows everything;
          Archived is the safety net for "where did that client go".
          Hidden when archived_at column isn't migrated yet — counts
          would be meaningless. */}
      {archivedColumnExists && (
        <div className="flex items-center gap-3">
          <ScopeTabs
            scope={scope}
            basePath="/clients"
            counts={scopeCounts}
          />
          {scope === "archived" && (
            <span className="text-[11px] text-neutral-500">
              Archived clients are hidden from the active list but keep
              their full commercial history. Open one to restore.
            </span>
          )}
        </div>
      )}

      {/* View toggle — the drill-down tree (default) or the flat list. */}
      <div className="flex items-center gap-2 text-[12px]">
        <span className="text-neutral-400">View:</span>
        <Link
          href="/clients"
          className={
            view === "tree"
              ? "font-semibold text-solux-ink"
              : "text-neutral-500 hover:underline"
          }
        >
          Affairs tree
        </Link>
        <span className="text-neutral-300">·</span>
        <Link
          href="/clients?view=flat"
          className={
            view === "flat"
              ? "font-semibold text-solux-ink"
              : "text-neutral-500 hover:underline"
          }
        >
          Flat list
        </Link>
      </div>

      {view === "flat" ? (
        <ClientsWorkspaceList
          clients={clients ?? []}
          docs={docs}
          taskLists={taskLists}
          productionOrders={productionOrders}
          canCreateQuotation={canCreateQuotation}
          canDeleteQuotation={canDeleteQuotation}
          salesByClient={salesByClient}
          showSales={global}
        />
      ) : (
        <ClientAffairTree clients={treeClients} />
      )}
    </div>
  );
}
