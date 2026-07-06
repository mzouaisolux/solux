"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  PROJECT_REQUEST_STATUS_LABEL,
  type ProjectRequestStatus,
} from "@/lib/types";
import { projectStatusColors } from "@/lib/project-status-colors";
import { ProjectStatusBadge } from "@/components/projects/ProjectStatusBadge";
import { ClickableRow } from "@/components/projects/ClickableRow";

export type OverviewRow = {
  id: string;
  name: string;
  status: string;
  archived: boolean;
  client: string;
  amount: number | null;
  owner: string;
  createdAt: string | null;
  updatedAt: string | null;
};

type SortKey = "updated" | "created";

// Deterministic date rendering (explicit locale) — this component is
// SSR'd then hydrated, so an implicit runtime locale could mismatch.
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// Opportunity value, same $ formatting as the /projects list (explicit
// locale for the same SSR/hydration reason as fmtDate).
function fmtMoney(n: number | null): string {
  return n == null ? "—" : `$${n.toLocaleString("en-US")}`;
}

/**
 * The overview list: client-side search / filters / sort over the rows the
 * server page fetched under the caller's RLS. Row click opens the existing
 * request page — no actions live here.
 */
export function OverviewTable({
  rows,
  total,
}: {
  rows: OverviewRow[];
  total: number;
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [owner, setOwner] = useState("");
  const [client, setClient] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("updated");
  const [sortAsc, setSortAsc] = useState(false);

  // Filter options come from the data itself — no extra queries, and the
  // dropdowns never offer a choice that would match zero rows overall.
  const owners = useMemo(
    () => Array.from(new Set(rows.map((r) => r.owner))).sort(),
    [rows]
  );
  const clients = useMemo(
    () => Array.from(new Set(rows.map((r) => r.client))).sort(),
    [rows]
  );
  const statuses = useMemo(() => {
    const present = new Set(rows.map((r) => r.status));
    // Catalog order (lib/types), limited to statuses actually in the data.
    return (
      Object.keys(PROJECT_REQUEST_STATUS_LABEL) as ProjectRequestStatus[]
    ).filter((s) => present.has(s));
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = rows.filter((r) => {
      if (status && r.status !== status) return false;
      if (owner && r.owner !== owner) return false;
      if (client && r.client !== client) return false;
      if (!needle) return true;
      return [r.name, r.client, r.owner, r.id]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
    const key = sortKey === "updated" ? "updatedAt" : "createdAt";
    out.sort((a, b) => {
      const cmp = (a[key] ?? "").localeCompare(b[key] ?? "");
      return sortAsc ? cmp : -cmp;
    });
    return out;
  }, [rows, q, status, owner, client, sortKey, sortAsc]);

  const hasFilter = Boolean(q || status || owner || client);
  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(false); // new sort column starts with most recent first
    }
  };
  const arrow = (key: SortKey) =>
    sortKey === key ? (sortAsc ? " ↑" : " ↓") : "";

  const lbTone = (r: OverviewRow) =>
    projectStatusColors(r.status as ProjectRequestStatus, r.archived).leftBorder;

  const inputCls =
    "rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-[12px] placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none";

  return (
    <>
      {/* SEARCH + FILTERS */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search — request, customer, project, salesperson…"
          className={`${inputCls} w-80`}
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className={inputCls}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {PROJECT_REQUEST_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          className={inputCls}
          aria-label="Filter by salesperson"
        >
          <option value="">All salespeople</option>
          {owners.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <select
          value={client}
          onChange={(e) => setClient(e.target.value)}
          className={inputCls}
          aria-label="Filter by customer"
        >
          <option value="">All customers</option>
          {clients.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {hasFilter && (
          <button
            type="button"
            className="text-[12px] text-neutral-500 hover:text-neutral-900 px-1"
            onClick={() => {
              setQ("");
              setStatus("");
              setOwner("");
              setClient("");
            }}
          >
            Clear
          </button>
        )}
        <span className="sx-micro ml-auto">
          {hasFilter ? `${filtered.length} of ${rows.length}` : rows.length}
          {rows.length < total ? ` (showing first ${rows.length} of ${total})` : ""}
        </span>
      </div>

      {/* LIST */}
      <div className="sx-panel">
        <table className="sx-list">
          <thead>
            <tr>
              <th>Service request</th>
              <th>Customer</th>
              <th>Salesperson</th>
              <th className="r">Amount</th>
              <th>Status</th>
              <th>
                <button type="button" className="cursor-pointer" onClick={() => toggleSort("created")}>
                  Created{arrow("created")}
                </button>
              </th>
              <th>
                <button type="button" className="cursor-pointer" onClick={() => toggleSort("updated")}>
                  Last updated{arrow("updated")}
                </button>
              </th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8}>
                  <div className="sx-empty">
                    {hasFilter
                      ? "No request matches the current filters."
                      : "No service requests in the system yet."}
                  </div>
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <ClickableRow key={r.id} href={`/projects/${r.id}`}>
                  <td className={`border-l-[3px] ${lbTone(r)}`}>
                    <Link href={`/projects/${r.id}`} className="pname">
                      {r.name}
                    </Link>
                  </td>
                  <td>{r.client}</td>
                  <td>{r.owner}</td>
                  <td className="r sx-tnum">{fmtMoney(r.amount)}</td>
                  <td>
                    <ProjectStatusBadge
                      status={r.status as ProjectRequestStatus}
                      archived={r.archived}
                    />
                  </td>
                  <td className="sx-tnum" title={r.createdAt ?? undefined}>
                    {fmtDate(r.createdAt)}
                  </td>
                  <td className="sx-tnum" title={r.updatedAt ?? undefined}>
                    {fmtDate(r.updatedAt)}
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
    </>
  );
}
