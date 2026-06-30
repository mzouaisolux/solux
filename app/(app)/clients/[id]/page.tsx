import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StatusBadge } from "@/components/StatusBadge";
import { ClientDocumentsByAffaire } from "@/components/clients/ClientDocumentsByAffaire";
import ContextMenu from "@/components/ContextMenu";
import {
  deleteClientPermanently,
  archiveClientAction,
  unarchiveClientAction,
} from "../actions";
import { ContextMenuActionItem } from "@/components/ContextMenuActionItem";
import {
  DOC_ACTIVE_STATUSES,
  DOC_TERMINAL_STATUSES,
  isTechnicalRole,
  type ClientCustomField,
  type DocStatus,
} from "@/lib/types";
import {
  parseListScope,
  applyDocScope,
  type ListScope,
  type ScopeCounts,
} from "@/lib/queries";
import { ScopeTabs } from "@/components/ScopeTabs";
import { ClientBlSummary } from "@/components/clients/ClientBlSummary";
import { ClientContactsCard } from "@/components/clients/ClientContactsCard";
import { hasUiCapability } from "@/lib/permissions";
import { Timeline } from "@/components/Timeline";
import { listEventsForEntities } from "@/lib/events";
import { getCurrentUserRole } from "@/lib/auth";
import {
  EventDiscussionPanel,
  parseEventSearchParam,
} from "@/components/dashboard/EventDiscussionPanel";
import {
  ClientHubTabs,
  HUB_TABS,
  type HubTab,
} from "@/components/clients/ClientHubTabs";
import { ClientMessageComposer } from "@/components/clients/ClientMessageComposer";
import { AffairRow } from "@/components/affairs/AffairRow";
import { getClientAffairs } from "@/lib/client-affairs";
import {
  ACTIVE_PIPELINE,
  COMMERCIAL_STATUS_LABEL,
  STATUS_CHIP,
} from "@/components/prospects/tender-status";
import { NewProjectPanel } from "@/components/affairs/NewProjectPanel";
import { listAssignableOwners } from "@/lib/owner";
import type { AssignableDoc } from "@/components/affairs/AssignDocumentPanel";
import type { AffairGroup } from "@/lib/affairs-prototype";
import {
  listEntityMessagesWithAuthors,
  type EntityMessageWithAuthor,
} from "@/lib/entity-messages";

/**
 * Client workspace — the operational page sales lives on.
 *
 * Top: client identity + 4 KPI cards (quotations / active / won / revenue)
 * Middle: latest-activity summary card + "+ New quotation" CTA
 * Below: quotation history with inline status switcher per row + Won
 *        quick actions + 3-dot context menu (Open / Duplicate-like via PDF)
 * Custom tax fields (collapsible vibe via plain section, only if any)
 * Header right: ⋯ menu hosts the (now hidden) Delete + Edit actions.
 */
export default async function ClientWorkspacePage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { scope?: string; event?: string | string[]; tab?: string };
}) {
  const supabase = createClient();
  const scope: ListScope = parseListScope(searchParams?.scope);
  // Affairs-first: opening a client lands on its projects, not CRM KPIs.
  const tab: HubTab = HUB_TABS.includes(searchParams?.tab as HubTab)
    ? (searchParams.tab as HubTab)
    : "affairs";
  const canCreateQuotation = await hasUiCapability("quotation.create");
  const canCreateProjectRequest = await hasUiCapability("project.create");
  // ?event=<uuid> auto-opens the conversation drawer overlaid on
  // this client page — notification entry point.
  const eventDiscussionId = parseEventSearchParam(searchParams?.event);
  const { userId: currentUserId, role, isSuperAdmin } = await getCurrentUserRole();

  // Single full fetch — KPIs need everything, table is in-memory
  // filtered. One query instead of two = simpler + always coherent.
  //
  // Defensive on `clients.archived_at`: if migration 031 hasn't been
  // applied the column is missing and the SELECT below errors → the
  // page would crash with notFound(). We retry without archived_at so
  // the workspace keeps working pre-migration; archived state simply
  // can't be displayed until the column exists.
  const clientFull = await supabase
    .from("clients")
    .select(
      "id, company_name, client_code, contact_name, email, phone_number, country, custom_fields, starting_sequence_number, archived_at, bl_profile"
    )
    .eq("id", params.id)
    .maybeSingle();
  let client: any = clientFull.data;
  if (clientFull.error) {
    const fallback = await supabase
      .from("clients")
      .select(
        "id, company_name, client_code, contact_name, email, phone_number, country, custom_fields, starting_sequence_number"
      )
      .eq("id", params.id)
      .maybeSingle();
    client = fallback.data
      ? { ...fallback.data, archived_at: null, bl_profile: null }
      : null;
  }

  const { data: allDocs } = await supabase
    .from("documents")
    .select(
      "id, number, type, date, total_price, status, currency, archived_at, affair_id, affair_name"
    )
    .eq("client_id", params.id)
    .order("date", { ascending: false });

  if (!client) notFound();

  // CRM step 2 (m101): the client's address book. Defensive pre-migration:
  // if the contacts table doesn't exist yet the query errors → empty list,
  // and the tab keeps rendering the embedded company contact.
  const { data: contactRows } = await supabase
    .from("contacts")
    .select("id, client_id, name, title, email, phone, is_primary, notes")
    .eq("client_id", params.id)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });
  const contacts = (contactRows ?? []) as any[];

  // Tender pipeline (m112): tenders where this client was identified as
  // the local partner. Defensive pre-migration — error → empty list.
  const { data: tenderRows } = await supabase
    .from("tenders")
    .select("id, title, country, buyer, deadline, commercial_status, converted_affair_id")
    .eq("attached_client_id", params.id)
    .order("deadline", { ascending: true, nullsFirst: false });
  const activeTenders = ((tenderRows ?? []) as any[]).filter((t) =>
    ACTIVE_PIPELINE.has(t.commercial_status)
  );

  // In-memory scope filter — semantics match applyDocScope() in
  // lib/queries.ts, just applied client-side because we want
  // unscoped KPIs at the top.
  function inDocScope(d: any, s: ListScope): boolean {
    if (s === "archived") return !!d.archived_at;
    if (s === "all") return true;
    return (
      !d.archived_at && d.status !== "cancelled" && d.status !== "lost"
    );
  }
  const docs = (allDocs ?? []).filter((d) => inDocScope(d, scope));

  // Tab counts — computed off the full set so they don't lie when the
  // user is on the Archived tab.
  const scopeCounts: ScopeCounts = {
    active: (allDocs ?? []).filter((d: any) => inDocScope(d, "active")).length,
    all: (allDocs ?? []).length,
    archived: (allDocs ?? []).filter((d: any) => !!d.archived_at).length,
  };

  // Pre-resolve task lists for the Won-row quick actions.
  const docIds = (docs ?? []).map((d) => d.id);
  const taskListByDoc = new Map<
    string,
    { id: string; number: string | null }
  >();
  // For the aggregated timeline we also need the FULL list of task
  // lists (any status) + production orders linked to this client's
  // documents — not just the ones surfaced by the Won-row UI.
  const allDocIds = (allDocs ?? []).map((d) => d.id);
  const allTaskListIds: string[] = [];
  const allProductionOrderIds: string[] = [];
  if (allDocIds.length > 0) {
    const { data: tlRows } = await supabase
      .from("production_task_lists")
      .select("id, number, quotation_id")
      .in("quotation_id", allDocIds);
    for (const t of tlRows ?? []) {
      allTaskListIds.push(t.id);
      // Build the visible map only for docs currently in scope.
      if (docIds.includes(t.quotation_id) && !taskListByDoc.has(t.quotation_id)) {
        taskListByDoc.set(t.quotation_id, { id: t.id, number: t.number });
      }
    }
    if (allTaskListIds.length > 0) {
      const { data: poRows } = await supabase
        .from("production_orders")
        .select("id")
        .in("task_list_id", allTaskListIds);
      for (const p of poRows ?? []) allProductionOrderIds.push(p.id);
    }
  }

  const customFields = (Array.isArray(client.custom_fields)
    ? client.custom_fields
    : []) as ClientCustomField[];

  // ---- KPI aggregates (bucketed per currency) ----
  // Computed off the FULL set so the header always reflects the
  // client's lifetime stats regardless of which scope tab is open.
  const revenueByCurrency = new Map<string, number>();
  const statusCounts: Partial<Record<DocStatus, number>> = {};
  let active = 0;
  let won = 0;
  for (const d of allDocs ?? []) {
    const status = (d.status as DocStatus) ?? "draft";
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    if (DOC_ACTIVE_STATUSES.includes(status)) active++;
    if (status === "won") {
      won++;
      const cur = (d.currency ?? "USD") as string;
      revenueByCurrency.set(
        cur,
        (revenueByCurrency.get(cur) ?? 0) + Number(d.total_price || 0)
      );
    }
  }
  // totalCount = "do they have any deals at all" (drives the
  // first-time empty state). scopedCount = "how many in current view".
  const totalCount = allDocs?.length ?? 0;
  const scopedCount = docs.length;
  const latestDoc = (allDocs ?? [])[0];
  const wonInProduction = (allDocs ?? []).filter(
    (d) => d.status === "won" && taskListByDoc.has(d.id)
  ).length;

  // ---- Aggregated activity feed ----
  // Pull events for the client + every doc + every task list + every PO
  // attached to this client. Merged + sorted newest-first by the helper,
  // capped at 100 rows globally so a noisy entity can't drown the feed.
  // This is the "account history" view sales asks for when a customer
  // calls about anything.
  const clientEvents = await listEventsForEntities(
    [
      { entity_type: "client", entity_ids: [client.id] },
      { entity_type: "document", entity_ids: allDocIds },
      { entity_type: "task_list", entity_ids: allTaskListIds },
      { entity_type: "production_order", entity_ids: allProductionOrderIds },
    ],
    100
  );
  // Resolve actor labels in one user_roles read (same pattern as doc/TL
  // pages — keeps the UI consistent across surfaces).
  const clientActorIds = Array.from(
    new Set(clientEvents.map((e) => e.actor_id).filter(Boolean))
  ) as string[];
  const clientActorLabels = new Map<string, string>();
  if (clientActorIds.length > 0) {
    const { data: roles } = await supabase
      .from("user_roles")
      .select("user_id, role")
      .in("user_id", clientActorIds);
    for (const r of roles ?? []) {
      clientActorLabels.set(
        r.user_id,
        `${r.role} · ${String(r.user_id).slice(0, 8)}`
      );
    }
  }

  // ---- Tab-specific data (fetched only for the active tab) ----
  let clientAffairs: AffairGroup[] = [];
  let affairOwners: { id: string; name: string }[] = [];
  let canAssignOwner = false;
  if (tab === "affairs") {
    const [affs, ownersRaw] = await Promise.all([
      getClientAffairs(params.id),
      listAssignableOwners(),
    ]);
    clientAffairs = affs;
    affairOwners = ownersRaw.map((o) => ({ id: o.id, name: o.name }));
    canAssignOwner = isTechnicalRole(role);
  }
  // "Assign existing quotation" candidates for an affair = the client's OTHER
  // families (latest version each), derived from the already-loaded affairs —
  // no extra query. Lets the expansion offer the same assign action as the page.
  const assignableFor = (a: AffairGroup): AssignableDoc[] =>
    clientAffairs
      .filter((other) => other.anchorId !== a.anchorId && other.latest)
      .map((other) => ({
        id: other.latest!.id,
        number: other.latest!.number ?? null,
        type: other.latest!.type,
        status: other.latest!.status,
      }));
  let clientMessages: EntityMessageWithAuthor[] = [];
  if (tab === "messages") {
    clientMessages = await listEntityMessagesWithAuthors("client", params.id);
  }

  return (
    <div className="mx-auto max-w-screen-2xl px-6 py-8 space-y-6">
      {/* ---------- HERO ---------- */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="eyebrow">Client workspace</div>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <h1 className="doc-title">{client.company_name}</h1>
            {client.client_code && (
              <span className="rounded bg-solux-accent px-2 py-0.5 text-[11px] font-mono uppercase tracking-widerx text-neutral-700">
                {client.client_code}
              </span>
            )}
          </div>
          <p className="text-sm text-neutral-500 mt-2">
            {[
              client.country,
              client.contact_name,
              client.email,
              client.phone_number,
            ]
              .filter(Boolean)
              .join(" · ") || "—"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <Link href="/clients" className="btn-secondary">
            ← All clients
          </Link>
          {/* PRIMARY ACTIONS — visible, no hunting required.
              Edit is now a first-class button (was buried in the 3-dot
              menu before); + New quotation stays the dominant CTA when
              the user is allowed to create. */}
          <Link
            href={`/clients/${client.id}/edit`}
            className="btn-secondary inline-flex items-center gap-1.5"
          >
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 20 20"
              fill="none"
              aria-hidden
            >
              <path
                d="M14.7 3.3a1 1 0 0 1 1.4 0l.6.6a1 1 0 0 1 0 1.4l-9.5 9.5-2.5.5.5-2.5 9.5-9.5Z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
            </svg>
            Edit client info
          </Link>
          {canCreateQuotation && (
            <Link href={`/documents/new?client=${client.id}`} className="btn-primary">
              + New quotation
            </Link>
          )}
          {canCreateProjectRequest && (
            <Link
              href={`/projects/new?client=${client.id}`}
              className="btn-secondary"
            >
              + New service request
            </Link>
          )}
          {/* DESTRUCTIVE ACTIONS only — kept in a discreet 3-dot menu
              so they require a deliberate click. Archive (safe) is
              listed before Delete (destructive), Delete is colored red
              to signal danger. */}
          <ContextMenu>
            {!client.archived_at ? (
              <ContextMenuActionItem
                action={archiveClientAction}
                id={client.id}
                label="Archive client"
                pendingLabel="Archiving…"
                variant="neutral"
              />
            ) : (
              <ContextMenuActionItem
                action={unarchiveClientAction}
                id={client.id}
                label="Restore from archive"
                pendingLabel="Restoring…"
                variant="success"
              />
            )}
            {isSuperAdmin && (
              <ContextMenuActionItem
                action={deleteClientPermanently}
                id={client.id}
                label="Permanently delete"
                pendingLabel="Deleting…"
                variant="danger"
                confirmMessage={
                  "Cette action est irréversible. Le client et toutes les données liées seront définitivement supprimés. Voulez-vous continuer ?"
                }
              />
            )}
          </ContextMenu>
        </div>
      </div>

      {/* Archive banner — surface the state prominently when archived. */}
      {client.archived_at && (
        <div className="rounded-md border border-neutral-300 bg-neutral-100 px-3 py-2 text-xs text-neutral-700 flex items-center gap-2">
          <svg
            className="h-3.5 w-3.5 flex-none text-neutral-500"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden
          >
            <path d="M4 4h12v3H4V4Zm0 5h12v7H4V9Zm3 2v2h6v-2H7Z" />
          </svg>
          <span>
            This client is archived (
            {new Date(client.archived_at).toLocaleDateString("en-GB")}). Linked
            quotations, task lists and orders are preserved but the client
            is hidden from the active list.
          </span>
        </div>
      )}

      {/* ---------- CLIENT HUB TABS ---------- */}
      <ClientHubTabs clientId={client.id} active={tab} />

      {/* ===== OVERVIEW ===== */}
      {tab === "overview" && (
        <div className="space-y-6">
      {/* ---------- KPI ROW ---------- */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Quotations" value={String(totalCount)} />
        <KpiCard
          label="Active deals"
          value={String(active)}
          tone="amber"
          hint="Draft / Sent / Negotiating"
        />
        <KpiCard
          label="Won"
          value={String(won)}
          tone="emerald"
          hint={
            wonInProduction > 0
              ? `${wonInProduction} in production`
              : undefined
          }
        />
        <KpiCard
          label="Revenue (won)"
          value={
            revenueByCurrency.size > 0
              ? formatMoneyMap(revenueByCurrency)
              : "—"
          }
          tone="emerald"
        />
      </div>

      {/* ---------- SHIPPING / BL PROFILE (read-only summary) ---------- */}
      <ClientBlSummary clientId={client.id} rawProfile={client.bl_profile ?? null} />

      {/* ---------- ACTIVE TENDERS (m112) ----------
          Tenders where this client was identified as the local partner.
          The pipeline stays the work surface; this is the client-side
          read (Règle Produit #0: display, don't own). */}
      {activeTenders.length > 0 && (
        <section className="panel p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="eyebrow">Active tenders ({activeTenders.length})</div>
            <Link
              href="/prospects/pipeline"
              className="text-[12px] font-semibold text-neutral-500 hover:text-neutral-900 hover:underline"
            >
              Open the pipeline →
            </Link>
          </div>
          <ul className="mt-2 divide-y divide-neutral-100">
            {activeTenders.map((t) => {
              const dl = t.deadline
                ? Math.round(
                    (Date.parse(t.deadline + "T00:00:00Z") - Date.now()) / 86_400_000
                  )
                : null;
              return (
                <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-neutral-900">
                      {t.title}
                    </div>
                    <div className="text-[11.5px] text-neutral-500">
                      {[t.country, t.buyer].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>
                  {dl != null && (
                    <span
                      className={`text-[11px] font-semibold tabular-nums ${
                        dl >= 0 && dl < 7
                          ? "text-rose-700"
                          : dl < 0
                            ? "text-neutral-300"
                            : "text-neutral-500"
                      }`}
                    >
                      {dl < 0 ? "closed" : `${dl}d left`}
                    </span>
                  )}
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ${
                      STATUS_CHIP[t.commercial_status] ??
                      "bg-neutral-100 text-neutral-600 ring-neutral-200"
                    }`}
                  >
                    {COMMERCIAL_STATUS_LABEL[t.commercial_status] ?? t.commercial_status}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ---------- ACTIVITY CARD ---------- */}
      {latestDoc && (
        <section className="panel p-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="eyebrow">Latest activity</div>
              <div className="mt-1 text-sm text-neutral-800">
                Quotation{" "}
                <Link
                  href={`/documents/${latestDoc.id}`}
                  className="font-mono font-semibold hover:underline"
                >
                  {latestDoc.number ?? "—"}
                </Link>{" "}
                ·{" "}
                <StatusBadge
                  status={(latestDoc.status as DocStatus) ?? "draft"}
                />{" "}
                · created{" "}
                {new Date(latestDoc.date).toLocaleDateString("en-GB", {
                  year: "numeric",
                  month: "short",
                  day: "2-digit",
                })}
              </div>
              <div className="text-xs text-neutral-500 mt-1">
                Value:{" "}
                <b className="font-mono">
                  {(latestDoc.currency ?? "USD") + " "}
                  {Number(latestDoc.total_price ?? 0).toLocaleString(
                    undefined,
                    { minimumFractionDigits: 2, maximumFractionDigits: 2 }
                  )}
                </b>
              </div>
            </div>
          </div>
        </section>
      )}
        </div>
      )}

      {/* ===== AFFAIRS ===== */}
      {tab === "affairs" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-neutral-500">
              All projects for {client.company_name}. Open one for the full
              operational workspace.
            </p>
            <NewProjectPanel
              lockedClient={{ id: client.id, name: client.company_name ?? "This client" }}
              owners={affairOwners}
            />
          </div>
          {clientAffairs.length === 0 ? (
            <p className="panel p-12 text-center text-sm text-neutral-500">
              No projects for this client yet — create one with{" "}
              <strong>New project</strong>, or start a quotation.
            </p>
          ) : (
            <div className="space-y-3">
              {clientAffairs.map((a) => (
                <AffairRow
                  key={a.anchorId}
                  affair={a}
                  owners={affairOwners}
                  canAssignOwner={canAssignOwner}
                  assignableDocs={assignableFor(a)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===== DOCUMENTS ===== */}
      {tab === "documents" && (
        <div className="space-y-6">
      {/* ---------- QUOTATION HISTORY ---------- */}
      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold">Documents by affaire</h2>
            <p className="text-xs text-neutral-500">
              Grouped by project so nothing gets lost as history grows — filter
              by affaire, or expand a project to see its quotations & proformas.
            </p>
          </div>
          <ScopeTabs
            scope={scope}
            basePath={`/clients/${params.id}`}
            counts={scopeCounts}
          />
        </div>

        {totalCount === 0 ? (
          <div className="panel p-12 text-center text-sm text-neutral-500">
            No quotations yet for this client. Click{" "}
            <b className="text-neutral-700">+ New quotation</b> to start.
          </div>
        ) : scopedCount === 0 ? (
          <div className="panel p-8 text-center text-sm text-neutral-500">
            No quotations in this view.{" "}
            <Link
              href={`/clients/${params.id}`}
              className="text-neutral-700 underline"
            >
              Switch to Active
            </Link>{" "}
            or{" "}
            <Link
              href={`/clients/${params.id}?scope=all`}
              className="text-neutral-700 underline"
            >
              All
            </Link>{" "}
            to see this client's history.
          </div>
        ) : (
          <ClientDocumentsByAffaire
            docs={(docs as any[]).map((d) => ({
              id: d.id,
              number: d.number,
              type: d.type,
              date: d.date,
              total_price: d.total_price,
              status: d.status,
              currency: d.currency,
              affair_id: d.affair_id ?? null,
              affair_name: d.affair_name ?? null,
              taskList: taskListByDoc.get(d.id) ?? null,
            }))}
          />
        )}

        {/* Status pipeline footer — quick scan of distribution */}
        {totalCount > 0 && (
          <div className="flex flex-wrap items-center gap-2 px-2">
            <span className="eyebrow">Pipeline:</span>
            {[...DOC_ACTIVE_STATUSES, ...DOC_TERMINAL_STATUSES]
              .filter((k) => (statusCounts[k] ?? 0) > 0)
              .map((k) => (
                <span
                  key={k}
                  className="inline-flex items-center gap-1 text-xs text-neutral-600"
                >
                  <StatusBadge status={k} />
                  <span className="tabular-nums font-medium">
                    {statusCounts[k]}
                  </span>
                </span>
              ))}
          </div>
        )}
      </section>
        </div>
      )}

      {/* ===== MESSAGES ===== */}
      {tab === "messages" && (
        <section className="panel p-5 space-y-4">
          <div className="eyebrow">Conversation</div>
          {clientMessages.length === 0 ? (
            <p className="text-sm text-neutral-500">
              No messages yet — start this client&rsquo;s conversation below.
            </p>
          ) : (
            <ul className="space-y-3">
              {clientMessages.map((m) => (
                <li
                  key={m.id}
                  className="border-b border-neutral-100 pb-2 last:border-0"
                >
                  <div className="text-[11px] text-neutral-400">
                    {m.author_name ?? "—"} ·{" "}
                    {new Date(m.created_at).toLocaleString("en-GB", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                  <div className="mt-0.5 whitespace-pre-wrap text-sm text-neutral-800">
                    {m.message}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <ClientMessageComposer clientId={client.id} />
        </section>
      )}

      {/* ===== CONTACTS ===== */}
      {tab === "contacts" && (
        <>
        {/* CRM step 2 (m101) — the people address book (several per client). */}
        <ClientContactsCard clientId={client.id} contacts={contacts} />
        <section className="panel p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="eyebrow">Company record — printed on documents</div>
            <Link href={`/clients/${client.id}/edit`} className="row-link">
              Edit client →
            </Link>
          </div>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm md:grid-cols-2">
            <ContactField label="Main contact" value={client.contact_name} />
            <ContactField label="Email" value={client.email} />
            <ContactField label="Phone" value={client.phone_number} />
            <ContactField label="Country" value={client.country} />
          </dl>
          {customFields.length > 0 && (
            <div>
              <div className="eyebrow mb-2">Tax / registration</div>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm md:grid-cols-2">
                {customFields
                  .filter((f) => f.label && f.value)
                  .map((f, i) => (
                    <div key={i} className="flex justify-between">
                      <dt className="text-neutral-500">{f.label}</dt>
                      <dd className="font-mono text-xs">{f.value}</dd>
                    </div>
                  ))}
              </dl>
            </div>
          )}
        </section>
        </>
      )}

      {/* ===== ACTIVITY ===== */}
      {tab === "activity" && (
        <div className="space-y-6">
      {/* ---------- AGGREGATED ACTIVITY TIMELINE ---------- */}
      {/* Unified account history: client edits + quotation events +
          task list workflow + production order lifecycle. Sales scrolls
          here when a customer calls and asks "where are we on order X" —
          one place answers the question. */}
      <section className="panel p-5 space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div className="eyebrow">Account history</div>
            <h3 className="text-sm font-semibold text-neutral-900 mt-0.5">
              Activity across quotations, task lists, and production
            </h3>
          </div>
          <span className="text-[11px] text-neutral-400 tabular-nums">
            {clientEvents.length} event{clientEvents.length === 1 ? "" : "s"}
          </span>
        </div>
        <Timeline
          events={clientEvents}
          actorLabelByUser={clientActorLabels}
          emptyMessage="No activity yet for this client. Events from quotations, task lists, and production orders will appear here automatically."
        />
      </section>
        </div>
      )}

      {/* Conversation drawer overlay — opens when ?event=<id> is in
          the URL. Client context stays visible behind the drawer. */}
      <EventDiscussionPanel
        eventId={eventDiscussionId}
        expectedEntityId={params.id}
        currentUserId={currentUserId ?? null}
      />
    </div>
  );
}

/** Read-only label/value pair for the Contacts tab. */
function ContactField({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="truncate font-medium text-neutral-800">{value || "—"}</dd>
    </div>
  );
}

/** Compact KPI card used in the workspace hero row. */
function KpiCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "emerald" | "amber";
}) {
  const valueClass =
    tone === "emerald"
      ? "text-emerald-700"
      : tone === "amber"
      ? "text-amber-700"
      : "text-neutral-900";
  return (
    <div className="panel p-4">
      <div className="eyebrow">{label}</div>
      <div
        className={`mt-1 text-2xl font-semibold tabular-nums leading-tight whitespace-pre-line ${valueClass}`}
      >
        {value}
      </div>
      {hint && (
        <div className="text-[11px] text-neutral-500 mt-1">{hint}</div>
      )}
    </div>
  );
}

function formatMoneyMap(m: Map<string, number>): string {
  if (m.size === 0) return "$0";
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
