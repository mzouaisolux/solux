"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  DOC_ACTIVE_STATUSES,
  DOC_TERMINAL_STATUSES,
  type DocStatus,
} from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";
import InlineStatusSwitcher from "@/components/InlineStatusSwitcher";
import DocQuickActions from "@/components/DocQuickActions";
import ContextMenu from "@/components/ContextMenu";
import {
  DelayBadge,
  ProductionOrderStatusBadge,
} from "@/components/ProductionOrderBadges";
import {
  computeProductionDelay,
  type ProductionOrderStatus,
} from "@/lib/types";
import {
  archiveClientAction,
  deleteClientAction,
  duplicateDocument,
  unarchiveClientAction,
} from "./actions";
import { deleteQuotation } from "@/app/(app)/documents/[id]/actions";
import { ContextMenuActionItem } from "@/components/ContextMenuActionItem";

/**
 * Client-centric sales workspace.
 *
 * Each row in this list represents one client. Clicking the row expands
 * it inline (smooth grid-template-rows animation) to reveal:
 *   - every quotation for that client
 *   - inline status switcher per quotation
 *   - Mark Won quick action (or → Task list if already won)
 *   - 3-dot menu with Duplicate, Open, Open task list
 *
 * No navigation needed for daily sales work — common actions all happen
 * from this single screen. The deeper /clients/[id] workspace stays
 * available for advanced details + edits.
 */

export type ClientRow = {
  id: string;
  company_name: string;
  client_code: string | null;
  contact_name: string | null;
  email: string | null;
  phone_number: string | null;
  country: string | null;
  /** Present when migration 031 has been applied. null when active. */
  archived_at?: string | null;
};

export type DocRow = {
  id: string;
  number: string | null;
  client_id: string | null;
  type: string;
  date: string;
  total_price: number;
  status: string;
  currency: string | null;
  /** Internal affair / project name (m056). null = unnamed. */
  affair_name?: string | null;
  /** Quotation version (m059). 1 = original. */
  version?: number | null;
};

export type TaskListRef = {
  id: string;
  number: string | null;
  quotation_id: string;
};

export type ProductionOrderRef = {
  id: string;
  number: string | null;
  quotation_id: string;
  status: string;
  initial_production_deadline: string | null;
  current_production_deadline: string | null;
};

type Stats = {
  count: number;
  active: number;
  won: number;
  statusCounts: Partial<Record<DocStatus, number>>;
  revenueByCurrency: Map<string, number>;
  lastActivity: string | null;
};

export default function ClientsWorkspaceList({
  clients,
  docs,
  taskLists,
  productionOrders,
  canCreateQuotation = false,
  canDeleteQuotation = false,
  salesByClient = {},
  showSales = false,
}: {
  clients: ClientRow[];
  docs: DocRow[];
  taskLists: TaskListRef[];
  productionOrders: ProductionOrderRef[];
  /** Drives visibility of "+ New quotation" CTAs per client.
   *  Computed once on the server via hasUiCapability and passed down. */
  canCreateQuotation?: boolean;
  /** Drives the "Delete quotation" row action. Capability-gated +
   *  View-As faithful, computed on the server. RLS still scopes the
   *  actual delete to quotations the user owns. */
  canDeleteQuotation?: boolean;
  /** Sales owner (account manager) per client id — { id, displayName }.
   *  Resolved server-side from clients.created_by + user_profiles. */
  salesByClient?: Record<string, { id: string | null; name: string }>;
  /** Show the sales-owner filter (management roles with the global view). */
  showSales?: boolean;
}) {
  // ---- Build per-client doc index + stats once ----
  const { docsByClient, statsByClient } = useMemo(() => {
    const docsByClient = new Map<string, DocRow[]>();
    const statsByClient = new Map<string, Stats>();
    for (const d of docs) {
      if (!d.client_id) continue;
      if (!docsByClient.has(d.client_id)) docsByClient.set(d.client_id, []);
      docsByClient.get(d.client_id)!.push(d);
      let s = statsByClient.get(d.client_id);
      if (!s) {
        s = {
          count: 0,
          active: 0,
          won: 0,
          statusCounts: {},
          revenueByCurrency: new Map(),
          lastActivity: null,
        };
        statsByClient.set(d.client_id, s);
      }
      s.count++;
      const status = (d.status as DocStatus) ?? "draft";
      s.statusCounts[status] = (s.statusCounts[status] ?? 0) + 1;
      if (DOC_ACTIVE_STATUSES.includes(status)) s.active++;
      if (status === "won") {
        s.won++;
        const cur = (d.currency as string) ?? "USD";
        s.revenueByCurrency.set(
          cur,
          (s.revenueByCurrency.get(cur) ?? 0) + Number(d.total_price || 0)
        );
      }
      if (!s.lastActivity || d.date > s.lastActivity) s.lastActivity = d.date;
    }
    // Sort each client's docs by date desc
    for (const arr of docsByClient.values()) {
      arr.sort((a, b) => b.date.localeCompare(a.date));
    }
    return { docsByClient, statsByClient };
  }, [docs]);

  const taskListByDoc = useMemo(() => {
    const m = new Map<string, TaskListRef>();
    for (const t of taskLists) {
      if (!m.has(t.quotation_id)) m.set(t.quotation_id, t);
    }
    return m;
  }, [taskLists]);

  const productionOrderByDoc = useMemo(() => {
    const m = new Map<string, ProductionOrderRef>();
    for (const p of productionOrders) {
      if (!m.has(p.quotation_id)) m.set(p.quotation_id, p);
    }
    return m;
  }, [productionOrders]);

  // ---- Filtering + sorting ----
  const [search, setSearch] = useState("");
  const [activeOnly, setActiveOnly] = useState(false);
  // Selected sales owners (multi-select). Empty = all.
  const [selectedSales, setSelectedSales] = useState<string[]>([]);

  // Sales-owner filter options + per-sales client counts (active deals
  // counter included so a manager sees workload distribution at a glance).
  const salesOptions = useMemo(() => {
    const byId = new Map<
      string,
      { id: string; name: string; total: number; active: number }
    >();
    for (const c of clients) {
      const owner = salesByClient[c.id];
      if (!owner?.id) continue;
      const e =
        byId.get(owner.id) ??
        { id: owner.id, name: owner.name, total: 0, active: 0 };
      e.total++;
      if ((statsByClient.get(c.id)?.active ?? 0) > 0) e.active++;
      byId.set(owner.id, e);
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [clients, salesByClient, statsByClient]);

  const filteredClients = useMemo(() => {
    let list = clients;
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((c) => {
        const owner = salesByClient[c.id]?.name ?? "";
        const hay = `${c.company_name} ${c.client_code ?? ""} ${c.country ?? ""} ${c.contact_name ?? ""} ${owner}`.toLowerCase();
        return hay.includes(q);
      });
    }
    if (activeOnly) {
      list = list.filter((c) => (statsByClient.get(c.id)?.active ?? 0) > 0);
    }
    if (selectedSales.length > 0) {
      list = list.filter((c) => {
        const oid = salesByClient[c.id]?.id;
        return !!oid && selectedSales.includes(oid);
      });
    }
    // Sort by recent activity desc, then by name
    return [...list].sort((a, b) => {
      const aS = statsByClient.get(a.id);
      const bS = statsByClient.get(b.id);
      const aL = aS?.lastActivity ?? "";
      const bL = bS?.lastActivity ?? "";
      if (aL && bL) return bL.localeCompare(aL);
      if (aL) return -1;
      if (bL) return 1;
      return a.company_name.localeCompare(b.company_name);
    });
  }, [clients, search, activeOnly, selectedSales, salesByClient, statsByClient]);

  // ---- One expanded row at a time. Click again to collapse. ----
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex items-end gap-3 flex-1 min-w-0">
          <label className="block flex-1 min-w-[220px] max-w-md">
            <span className="label">Search clients</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, code, country, contact…"
              className="input"
            />
          </label>
          <label className="inline-flex items-center gap-2 pb-2 cursor-pointer select-none text-xs text-neutral-700">
            <input
              type="checkbox"
              checked={activeOnly}
              onChange={(e) => setActiveOnly(e.target.checked)}
              className="h-4 w-4 accent-solux"
            />
            Active deals only
          </label>
        </div>
        <div className="text-xs text-neutral-500 pb-2">
          {filteredClients.length} of {clients.length} clients
        </div>
      </div>

      {/* Sales-owner filter — management view. Multi-select chips with a
          client count + an amber "active deals" badge for workload. */}
      {showSales && salesOptions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 mr-1">
            Sales owner
          </span>
          <button
            type="button"
            onClick={() => setSelectedSales([])}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              selectedSales.length === 0
                ? "border-solux bg-solux text-white"
                : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50"
            }`}
          >
            All sales
          </button>
          {salesOptions.map((o) => {
            const active = selectedSales.includes(o.id);
            return (
              <button
                key={o.id}
                type="button"
                onClick={() =>
                  setSelectedSales(
                    active
                      ? selectedSales.filter((x) => x !== o.id)
                      : [...selectedSales, o.id]
                  )
                }
                title={`${o.name} — ${o.total} client${
                  o.total === 1 ? "" : "s"
                }${o.active > 0 ? `, ${o.active} with active deals` : ""}`}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  active
                    ? "border-solux bg-solux text-white"
                    : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50"
                }`}
              >
                <span>{o.name}</span>
                <span
                  className={`tabular-nums ${
                    active ? "text-white/80" : "text-neutral-400"
                  }`}
                >
                  {o.total}
                </span>
                {o.active > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-amber-500 text-white text-[10px] font-semibold tabular-nums">
                    {o.active}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {filteredClients.length === 0 && (
        <div className="panel p-12 text-center text-sm text-neutral-500">
          {clients.length === 0
            ? "No clients yet. Add your first one above."
            : "No clients match your filters."}
        </div>
      )}

      {/* Rows */}
      <div className="space-y-2">
        {filteredClients.map((c) => {
          const stats = statsByClient.get(c.id);
          const isExpanded = expandedId === c.id;
          const clientDocs = docsByClient.get(c.id) ?? [];
          return (
            <ClientRowItem
              key={c.id}
              client={c}
              stats={stats}
              docs={clientDocs}
              taskListByDoc={taskListByDoc}
              productionOrderByDoc={productionOrderByDoc}
              expanded={isExpanded}
              onToggle={() => setExpandedId(isExpanded ? null : c.id)}
              canCreateQuotation={canCreateQuotation}
              canDeleteQuotation={canDeleteQuotation}
              salesName={salesByClient[c.id]?.name ?? null}
            />
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ClientRowItem({
  client,
  stats,
  docs,
  taskListByDoc,
  productionOrderByDoc,
  expanded,
  onToggle,
  canCreateQuotation,
  canDeleteQuotation,
  salesName,
}: {
  client: ClientRow;
  stats: Stats | undefined;
  docs: DocRow[];
  taskListByDoc: Map<string, TaskListRef>;
  productionOrderByDoc: Map<string, ProductionOrderRef>;
  expanded: boolean;
  onToggle: () => void;
  canCreateQuotation: boolean;
  canDeleteQuotation: boolean;
  /** Sales owner / account manager Display Name (null = unknown). */
  salesName: string | null;
}) {
  return (
    <div
      className={`rounded-xl border bg-white shadow-soft transition-all duration-200 ${
        expanded
          ? "border-neutral-300 shadow-card-hover"
          : "border-neutral-200/80 hover:border-neutral-300 hover:shadow-card-hover"
      }`}
    >
      {/* ---- Header row (always visible) — click to expand ---- */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full text-left px-5 py-4 grid grid-cols-12 gap-3 items-center group"
      >
        {/* Name + code */}
        <div className="col-span-12 md:col-span-4 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`font-semibold truncate ${
                client.archived_at
                  ? "text-neutral-500 line-through"
                  : "text-neutral-900"
              }`}
            >
              {client.company_name}
            </span>
            {client.client_code ? (
              <span className="rounded bg-solux-accent px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-widerx text-neutral-700">
                {client.client_code}
              </span>
            ) : (
              <span className="text-[10px] text-red-600 uppercase tracking-widerx">
                no code
              </span>
            )}
            {client.archived_at && (
              <span className="inline-flex items-center rounded border border-neutral-300 bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widerx text-neutral-600">
                Archived
              </span>
            )}
          </div>
          {/* Sales owner / account manager — Display Name, always visible. */}
          {salesName && salesName !== "—" && (
            <div className="mt-1 inline-flex items-center gap-1.5 text-[11px]">
              <span
                className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-neutral-200 text-[8px] font-semibold uppercase text-neutral-600"
                aria-hidden
              >
                {salesName.slice(0, 2)}
              </span>
              <span className="text-neutral-400 uppercase tracking-wider text-[9px]">
                Owner
              </span>
              <span className="font-medium text-neutral-700">{salesName}</span>
            </div>
          )}
          {(client.contact_name || client.email) && (
            <div className="text-xs text-neutral-500 mt-0.5 truncate">
              {client.contact_name ?? client.email}
            </div>
          )}
        </div>

        {/* Country */}
        <div className="col-span-3 md:col-span-1 text-xs uppercase text-neutral-500">
          {client.country ?? "—"}
        </div>

        {/* Active count */}
        <div className="col-span-3 md:col-span-1 text-right">
          {stats?.active ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-xs font-medium text-amber-800">
              {stats.active} active
            </span>
          ) : (
            <span className="text-xs text-neutral-400">—</span>
          )}
        </div>

        {/* Revenue */}
        <div className="col-span-3 md:col-span-2 text-right">
          {stats && stats.revenueByCurrency.size > 0 ? (
            <div className="text-xs tabular-nums whitespace-pre-line font-semibold text-neutral-900">
              {formatMoneyMap(stats.revenueByCurrency)}
            </div>
          ) : (
            <span className="text-xs text-neutral-400">—</span>
          )}
        </div>

        {/* Status mix */}
        <div className="col-span-9 md:col-span-2">
          {stats && stats.count > 0 ? (
            <div className="flex flex-wrap items-center gap-1">
              {[...DOC_ACTIVE_STATUSES, ...DOC_TERMINAL_STATUSES]
                .filter((k) => (stats.statusCounts[k] ?? 0) > 0)
                .slice(0, 3)
                .map((k) => (
                  <span
                    key={k}
                    className="inline-flex items-center gap-1 text-[11px] text-neutral-600"
                  >
                    <StatusBadge status={k} />
                    <span className="tabular-nums">
                      {stats.statusCounts[k]}
                    </span>
                  </span>
                ))}
            </div>
          ) : (
            <span className="text-xs text-neutral-400">—</span>
          )}
        </div>

        {/* Last activity + chevron */}
        <div className="col-span-3 md:col-span-2 flex items-center justify-end gap-2 text-xs text-neutral-600">
          <span>
            {stats?.lastActivity
              ? new Date(stats.lastActivity).toLocaleDateString("en-GB", {
                  year: "2-digit",
                  month: "short",
                  day: "2-digit",
                })
              : "—"}
          </span>
          <span
            className={`text-neutral-400 transition-transform duration-200 ${
              expanded ? "rotate-180 text-neutral-900" : "group-hover:text-neutral-700"
            }`}
            aria-hidden
          >
            ▾
          </span>
        </div>
      </button>

      {/* ---- Expanded body — uses the grid-template-rows trick for smooth height animation ---- */}
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div className="border-t border-neutral-200/70 px-5 py-4 space-y-3 bg-neutral-50/30">
            {/* Sub-toolbar */}
            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] font-semibold uppercase tracking-widerx text-neutral-500">
                Quotations · {docs.length}
              </div>
              <div className="flex items-center gap-2">
                {canCreateQuotation && (
                  <Link
                    href={`/documents/new?client=${client.id}`}
                    className="btn-xs"
                  >
                    + New quotation
                  </Link>
                )}
                {/* Edit is a first-class, visible action (no longer
                    hidden behind the 3-dot menu). */}
                <Link
                  href={`/clients/${client.id}/edit`}
                  className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                >
                  <svg
                    className="h-3 w-3"
                    viewBox="0 0 20 20"
                    fill="none"
                    aria-hidden
                  >
                    <path
                      d="M14.7 3.3a1 1 0 0 1 1.4 0l.6.6a1 1 0 0 1 0 1.4l-9.5 9.5-2.5.5.5-2.5 9.5-9.5Z"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Edit client info
                </Link>
                <Link
                  href={`/clients/${client.id}`}
                  className="text-xs text-neutral-500 hover:text-neutral-900 hover:underline"
                >
                  Open client →
                </Link>
                <ContextMenu>
                  {/* Safe + reversible: archive (or restore if already
                      archived). Visible from BOTH active and archived
                      tabs so the user can flip a client either way
                      without leaving the list. */}
                  {client.archived_at ? (
                    <ContextMenuActionItem
                      action={unarchiveClientAction}
                      id={client.id}
                      label="Restore from archive"
                      pendingLabel="Restoring…"
                      variant="success"
                    />
                  ) : (
                    <ContextMenuActionItem
                      action={archiveClientAction}
                      id={client.id}
                      label="Archive client"
                      pendingLabel="Archiving…"
                      variant="neutral"
                    />
                  )}
                  {/* Destructive: confirm + show RPC's precise error if the
                      client has linked docs/PTLs/POs. The error now shows
                      in a window.alert instead of disappearing into the
                      generic "1 error" toast. */}
                  <ContextMenuActionItem
                    action={deleteClientAction}
                    id={client.id}
                    label="Delete client"
                    pendingLabel="Deleting…"
                    variant="danger"
                    confirmMessage={`Permanently delete ${client.company_name}? This cannot be undone. If the client has linked quotations / task lists / production orders, the delete will be refused — use Archive instead in that case.`}
                  />
                </ContextMenu>
              </div>
            </div>

            {/* Quotation rows */}
            {docs.length === 0 ? (
              <div className="rounded-lg border border-dashed border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
                No quotations for this client yet. Click{" "}
                <b className="text-neutral-700">+ New quotation</b> to start.
              </div>
            ) : (
              <div className="rounded-lg border border-neutral-200/80 bg-white overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-neutral-50 border-b border-neutral-200">
                      <th className="px-3 py-2 text-left font-semibold text-[10px] uppercase tracking-widerx text-neutral-600">
                        Quote
                      </th>
                      <th className="px-3 py-2 text-left font-semibold text-[10px] uppercase tracking-widerx text-neutral-600">
                        Date
                      </th>
                      <th className="px-3 py-2 text-right font-semibold text-[10px] uppercase tracking-widerx text-neutral-600">
                        Value
                      </th>
                      <th className="px-3 py-2 text-left font-semibold text-[10px] uppercase tracking-widerx text-neutral-600">
                        Status
                      </th>
                      <th className="px-3 py-2 text-left font-semibold text-[10px] uppercase tracking-widerx text-neutral-600">
                        Next
                      </th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {docs.map((d) => {
                      const tl = taskListByDoc.get(d.id) ?? null;
                      const po = productionOrderByDoc.get(d.id) ?? null;
                      const poDelay = po
                        ? computeProductionDelay({
                            initial_production_deadline:
                              po.initial_production_deadline,
                            current_production_deadline:
                              po.current_production_deadline,
                          })
                        : null;
                      return (
                        <tr
                          key={d.id}
                          className="border-b border-neutral-100 last:border-b-0 hover:bg-neutral-50/60 transition-colors"
                        >
                          <td className="px-3 py-2.5">
                            {d.affair_name && (
                              <div
                                className="text-[13px] font-semibold text-neutral-900 leading-tight truncate max-w-[260px]"
                                title={d.affair_name}
                              >
                                {d.affair_name}
                              </div>
                            )}
                            <div className="flex items-center gap-1.5">
                              <Link
                                href={`/documents/${d.id}`}
                                className={`font-mono hover:underline ${
                                  d.affair_name
                                    ? "text-[11px] text-neutral-500"
                                    : "text-[13px] text-neutral-900"
                                }`}
                              >
                                {d.number ?? "—"}
                              </Link>
                              {(d.version ?? 1) > 1 && (
                                <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-800">
                                  V{d.version}
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-neutral-500 capitalize flex items-center gap-1.5 flex-wrap">
                              <span>{d.type}</span>
                              {po && (
                                <>
                                  <span className="text-neutral-300">·</span>
                                  <Link
                                    href={`/production/orders/${po.id}`}
                                    onClick={(e) => e.stopPropagation()}
                                    className="inline-flex items-center gap-1.5"
                                    title="Open production order"
                                  >
                                    <ProductionOrderStatusBadge
                                      status={po.status as ProductionOrderStatus}
                                    />
                                    {poDelay !== null && poDelay > 0 && (
                                      <DelayBadge delayDays={poDelay} short />
                                    )}
                                  </Link>
                                </>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-xs text-neutral-600">
                            {new Date(d.date).toLocaleDateString("en-GB", {
                              year: "2-digit",
                              month: "short",
                              day: "2-digit",
                            })}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-neutral-900">
                            {d.currency ?? "$"} {formatValue(d.total_price)}
                          </td>
                          <td className="px-3 py-2.5">
                            <InlineStatusSwitcher
                              docId={d.id}
                              current={(d.status as DocStatus) ?? "draft"}
                            />
                          </td>
                          <td className="px-3 py-2.5">
                            <DocQuickActions
                              doc={{ id: d.id, status: d.status }}
                              taskList={
                                tl
                                  ? { id: tl.id, number: tl.number }
                                  : null
                              }
                            />
                          </td>
                          <td className="px-3 py-2.5 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              <Link
                                href={`/documents/${d.id}`}
                                className="row-link text-xs"
                              >
                                Open →
                              </Link>
                              <ContextMenu>
                                <Link
                                  href={`/documents/${d.id}`}
                                  className="block px-3 py-2 text-xs text-neutral-700 hover:bg-neutral-50"
                                >
                                  Open quotation
                                </Link>
                                <Link
                                  href={`/documents/new?revise=${d.id}`}
                                  className="block px-3 py-2 text-xs text-neutral-700 hover:bg-neutral-50"
                                >
                                  Create new version (revise)
                                </Link>
                                {tl ? (
                                  <Link
                                    href={`/task-lists/${tl.id}`}
                                    className="block px-3 py-2 text-xs text-neutral-700 hover:bg-neutral-50"
                                  >
                                    Open task list
                                  </Link>
                                ) : null}
                                <form action={duplicateDocument}>
                                  <input
                                    type="hidden"
                                    name="id"
                                    value={d.id}
                                  />
                                  <button
                                    type="submit"
                                    className="block w-full text-left px-3 py-2 text-xs text-neutral-700 hover:bg-neutral-50"
                                    title="Creates the next version of this quotation (never a second V1)"
                                  >
                                    Duplicate → new version
                                  </button>
                                </form>
                                {/* Decision F: only NON-committed quotations with no
                                    task list may be hard-deleted from the list. Won /
                                    terminal / has-task-list → use Cancel or Archive. */}
                                {canDeleteQuotation &&
                                  !tl &&
                                  ["draft", "sent", "negotiating"].includes(d.status) && (
                                    <ContextMenuActionItem
                                      action={deleteQuotation}
                                      id={d.id}
                                      label="Delete quotation"
                                      pendingLabel="Deleting…"
                                      variant="danger"
                                      confirmMessage={`Permanently delete quotation ${
                                        d.number ?? ""
                                      }? This cannot be undone. Use Cancel instead if you want to keep the record.`}
                                    />
                                  )}
                              </ContextMenu>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

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
      return `${k} ${formatValue(v)}`;
    })
    .join("\n");
}

/** Compact "1.2M / 280k / 540" formatting for tight cells. */
function formatValue(v: number): string {
  if (!Number.isFinite(v) || v === 0) return "0";
  const abs = Math.abs(v);
  if (abs >= 1_000_000)
    return `${(v / 1_000_000).toLocaleString(undefined, {
      maximumFractionDigits: 2,
    })}M`;
  if (abs >= 1_000)
    return `${(v / 1_000).toLocaleString(undefined, {
      maximumFractionDigits: 1,
    })}k`;
  return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
}
