import "./clients.css";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole } from "@/lib/auth";
import { resolveUserLabelStrings } from "@/lib/user-display";
import NewClientPanel from "./NewClientPanel";
import ClientsWorkspaceList from "./ClientsWorkspaceList";
import { isTechnicalRole, DOC_ACTIVE_STATUSES } from "@/lib/types";
import { getVisibilityScope, canSeeRow } from "@/features/Permissions/lib/visibility";
import { hasUiCapability } from "@/lib/permissions";
import { parseListScope, type ListScope } from "@/lib/queries";
import { ScopeTabs } from "@/components/ScopeTabs";
import { ClientAffairTree } from "@/components/clients/ClientAffairTree";
import {
  ClientCrmCards,
  type CrmCard,
  type CrmKpis,
  type CrmAttention,
} from "@/components/clients/ClientCrmCards";
import { getAllClientAffairs } from "@/lib/client-affairs";
import type { ClientAffairs, AffairGroup } from "@/lib/affairs-prototype";
import { findCountry } from "@/lib/countries";

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

  // ---- Views ----
  // CRM cards (default, solux-clients-crm skin) / drill-down tree / flat list.
  const view =
    searchParams?.view === "flat"
      ? "flat"
      : searchParams?.view === "tree"
        ? "tree"
        : "cards";
  let treeClients: ClientAffairs[] = [];
  if (view === "tree" || view === "cards") {
    const scopedIds = new Set((clients ?? []).map((c: any) => c.id));
    const all = await getAllClientAffairs();
    treeClients = all.filter((ca) => ca.clientId && scopedIds.has(ca.clientId));
  }

  // ================= CRM CARDS VIEW (default) =================
  if (view === "cards") {
    // Primary contact per client (m101 address book; defensive pre-migration —
    // an error simply falls back to the embedded clients.contact_name).
    const { data: contactRows } = await supabase
      .from("contacts")
      .select("client_id, name, title, email, phone, is_primary")
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true });
    const contactByClient = new Map<string, any>();
    for (const r of (contactRows ?? []) as any[]) {
      if (!contactByClient.has(r.client_id)) contactByClient.set(r.client_id, r);
    }

    // Same "live affair" rule as the tree view.
    const DEAD = new Set(["lost", "abandoned", "archived"]);
    const isActiveAffair = (a: AffairGroup) =>
      !a.isArchived &&
      a.effectiveStatus !== "lost" &&
      a.effectiveStatus !== "cancelled" &&
      !(a.lifecycleStatus && DEAD.has(a.lifecycleStatus));

    const treeByClient = new Map<string, ClientAffairs>();
    for (const tc of treeClients) if (tc.clientId) treeByClient.set(tc.clientId, tc);

    const docsByClient = new Map<string, typeof docs>();
    for (const d of docs) {
      const arr = docsByClient.get(d.client_id);
      if (arr) arr.push(d);
      else docsByClient.set(d.client_id, [d]);
    }
    // Behind-schedule production orders per client (current > initial deadline).
    const clientByDoc = new Map(docs.map((d) => [d.id, d.client_id]));
    const behindByClient = new Map<string, number>();
    for (const po of productionOrders) {
      if (
        po.initial_production_deadline &&
        po.current_production_deadline &&
        po.current_production_deadline > po.initial_production_deadline
      ) {
        const cid = clientByDoc.get(po.quotation_id);
        if (cid) behindByClient.set(cid, (behindByClient.get(cid) ?? 0) + 1);
      }
    }

    const nowMs = Date.now();
    const daysSince = (iso: string | null | undefined): number | null => {
      if (!iso) return null;
      const t = Date.parse(iso);
      return Number.isNaN(t) ? null : Math.floor((nowMs - t) / 86400000);
    };
    // Last 7 calendar months (yyyy-mm keys) for the sparklines.
    const months: string[] = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(nowMs);
      d.setDate(1);
      d.setMonth(d.getMonth() - (6 - i));
      return d.toISOString().slice(0, 7);
    });
    const sparkOf = (clientDocs: typeof docs): { h: number; hi: boolean }[] => {
      const sums = months.map((m) =>
        clientDocs
          .filter((d) => d.status !== "cancelled" && (d.date ?? "").slice(0, 7) === m)
          .reduce((acc, d) => acc + d.total_price, 0)
      );
      const max = Math.max(...sums, 0);
      return sums.map((v) => ({
        h: max > 0 ? Math.max(8, Math.round((v / max) * 100)) : 10,
        hi: max > 0 && v >= max * 0.8,
      }));
    };
    const trendOf = (clientDocs: typeof docs): number | null => {
      const d90 = 90 * 86400000;
      let cur = 0;
      let prev = 0;
      for (const d of clientDocs) {
        if (!d.date || d.status === "cancelled") continue;
        const t = Date.parse(d.date);
        if (Number.isNaN(t)) continue;
        if (t >= nowMs - d90) cur += d.total_price;
        else if (t >= nowMs - 2 * d90) prev += d.total_price;
      }
      if (prev <= 0) return null;
      return ((cur - prev) / prev) * 100;
    };
    const money = (n: number) =>
      `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
    const compact = (n: number) =>
      n >= 1_000_000
        ? `$${(n / 1_000_000).toFixed(2)}M`
        : n >= 1_000
          ? `$${Math.round(n / 1_000)}k`
          : `$${Math.round(n)}`;

    const cards: CrmCard[] = (clients ?? []).map((c: any) => {
      const tc = treeByClient.get(c.id);
      const affairs = tc?.affairs ?? [];
      const live = affairs.filter(isActiveAffair);
      const wonTotal = affairs.filter((a) => a.effectiveStatus === "won").length;
      const wonLive = live.filter((a) => a.effectiveStatus === "won").length;
      const prodCount = live.filter(
        (a) => a.hasProductionOrder && a.effectiveStatus !== "won"
      ).length;
      const quoteCount = Math.max(0, live.length - prodCount - wonLive);
      const value = live.reduce((acc, a) => acc + (a.totalValue || 0), 0);
      const clientDocs = docsByClient.get(c.id) ?? [];
      const awaitingReply = clientDocs.filter((d) => d.status === "sent").length;
      const behind = behindByClient.get(c.id) ?? 0;
      const lastDoc = clientDocs.reduce<string | null>(
        (acc, d) => (d.date && (!acc || d.date > acc) ? d.date : acc),
        null
      );
      const days = daysSince(
        [tc?.latestDate, lastDoc].filter(Boolean).sort().reverse()[0] ?? null
      );
      const topAffair = live
        .slice()
        .sort((a, b) => (b.totalValue || 0) - (a.totalValue || 0))[0]?.displayName;
      // Health heuristic: amber when something drags (behind schedule, quotes
      // ignored, account gone quiet); green when winning and recently active.
      const health: CrmCard["health"] =
        behind > 0 || (awaitingReply > 0 && (days ?? 99) > 14) || (live.length > 0 && (days ?? 99) > 30)
          ? "watch"
          : wonTotal >= 1 && (days ?? 99) <= 7
            ? "strong"
            : "steady";
      const contact = contactByClient.get(c.id);
      return {
        clientId: c.id,
        name: c.company_name,
        code: c.client_code ?? null,
        country: c.country ?? null,
        countryCode: findCountry(c.country)?.code ?? null,
        topAffair: topAffair ?? null,
        health,
        value,
        valueLabel: money(value),
        trendPct: trendOf(clientDocs),
        spark: sparkOf(clientDocs),
        activeCount: live.length,
        wonCount: wonTotal,
        quoteCount,
        prodCount,
        awaitingReply,
        behindSchedule: behind,
        lastActivityDays: days,
        ownerName: salesByClient[c.id]?.name !== "—" ? salesByClient[c.id]?.name ?? null : null,
        contactName: contact?.name ?? c.contact_name ?? null,
        contactRole: contact?.title ?? null,
        contactEmail: contact?.email ?? c.email ?? null,
        contactPhone: contact?.phone ?? c.phone_number ?? null,
        archived: !!c.archived_at,
      };
    });

    // KPI band — computed over the scoped card set + the full doc set.
    const quarterStart = (() => {
      const d = new Date(nowMs);
      const qm = Math.floor(d.getMonth() / 3) * 3;
      return new Date(d.getFullYear(), qm, 1).toISOString().slice(0, 10);
    })();
    const wonDocsQuarter = docs.filter(
      (d) => d.status === "won" && (d.date ?? "") >= quarterStart
    );
    const newAffairs30d = treeClients
      .flatMap((tc) => tc.affairs)
      .filter((a) => {
        const first = a.documents[0]?.date ?? null;
        return first ? nowMs - Date.parse(first) <= 30 * 86400000 : false;
      }).length;
    const kpis: CrmKpis = {
      totalClients: cards.length,
      activeClients: cards.filter((c) => c.activeCount > 0).length,
      dormantClients: cards.filter((c) => c.activeCount === 0).length,
      activeAffairs: cards.reduce((acc, c) => acc + c.activeCount, 0),
      newAffairs30d,
      wonQuarter: wonDocsQuarter.length,
      wonQuarterValueLabel: compact(
        wonDocsQuarter.reduce((acc, d) => acc + d.total_price, 0)
      ),
      portfolioValueLabel: compact(cards.reduce((acc, c) => acc + c.value, 0)),
      portfolioSpark: sparkOf(docs),
    };
    const flagged = cards.filter((c) => c.awaitingReply > 0 || c.behindSchedule > 0);
    const attention: CrmAttention = {
      awaitingReply: cards.reduce((acc, c) => acc + c.awaitingReply, 0),
      behindSchedule: cards.reduce((acc, c) => acc + c.behindSchedule, 0),
      accounts: flagged.length,
    };

  return (
      <ClientCrmCards
        cards={cards}
        kpis={kpis}
        attention={attention}
        scope={scope}
        scopeCounts={scopeCounts}
        canCreateQuotation={canCreateQuotation}
        showOwnerFilter={global}
      />
    );
  }

  // Golden rule (Phase 2): affairs with at least one OPEN planned action.
  // One lean query — the tree flags live deals missing from this set.
  const { data: openActs } = await supabase
    .from("planned_actions")
    .select("affair_id")
    .is("done_at", null)
    .not("affair_id", "is", null);
  const openActionAffairIds = [
    ...new Set(((openActs ?? []) as any[]).map((r) => r.affair_id as string)),
  ];

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

      {/* View toggle — CRM cards (default) / drill-down tree / flat list. */}
      <div className="flex items-center gap-2 text-[12px]">
        <span className="text-neutral-400">View:</span>
        <Link href="/clients" className="text-neutral-500 hover:underline">
          Cards
        </Link>
        <span className="text-neutral-300">·</span>
        <Link
          href="/clients?view=tree"
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
        <ClientAffairTree clients={treeClients} openActionAffairIds={openActionAffairIds} />
      )}
    </div>
  );
}
