"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import type { PriceListStatus } from "@/lib/types";
import {
  bulkPublishPriceLists,
  bulkArchivePriceLists,
  bulkDeletePriceLists,
  bulkAssignSeller,
  bulkDuplicatePriceLists,
} from "../actions";

export type LibraryRow = {
  id: string;
  name: string;
  categoryName: string | null;
  status: PriceListStatus;
  margins: string;
  effectiveDate: string | null;
  createdDate: string | null;
  createdBy: string;
  assignedTo: string;
  productCount: number;
  lastUpdated: string | null;
};

function StatusBadge({ status }: { status: PriceListStatus }) {
  const cls =
    status === "published"
      ? "bg-emerald-100 text-emerald-800"
      : status === "archived"
        ? "bg-neutral-200 text-neutral-500"
        : "bg-amber-100 text-amber-800";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${cls}`}>
      {status}
    </span>
  );
}

/**
 * Library table with row selection + bulk actions (publish / archive / delete /
 * assign). Pure UI: the server (page.tsx) already filtered the rows; this only
 * handles selection and calls the bulk server actions, then refreshes.
 */
export default function LibraryTable({
  rows,
  sellers,
}: {
  rows: LibraryRow[];
  sellers: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignSeller, setAssignSeller] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const allIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const allSelected = selected.size > 0 && selected.size === rows.length;
  const ids = Array.from(selected);

  function toggle(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((cur) => (cur.size === rows.length ? new Set() : new Set(allIds)));
  }

  function runBulk(fn: () => Promise<unknown>) {
    setErr(null);
    startTransition(async () => {
      try {
        await fn();
        setSelected(new Set());
        setAssignSeller("");
        router.refresh();
      } catch (e: any) {
        if (e?.message && !String(e.message).includes("NEXT_REDIRECT")) setErr(e.message);
      }
    });
  }

  const none = selected.size === 0;
  // Permanent action toolbar: always visible so the page reads as a management
  // workspace, not a passive list. Actions are disabled until ≥1 row is picked.
  const actionBtn =
    "rounded px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:text-neutral-300 disabled:hover:bg-transparent";

  return (
    <div className="space-y-2">
      {/* PERMANENT ACTION TOOLBAR */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm">
        <span className="text-[10px] font-semibold uppercase tracking-widerx text-neutral-500">
          Actions
        </span>
        <span
          className={`ml-1 rounded-full px-2 py-0.5 text-[11px] ${
            none ? "bg-neutral-100 text-neutral-400" : "bg-sky-100 text-sky-800 font-medium"
          }`}
        >
          {none ? "none selected" : `${selected.size} selected`}
        </span>
        <span className="mx-1 text-neutral-200">|</span>

        <button
          onClick={() => runBulk(() => bulkPublishPriceLists(ids))}
          disabled={pending || none}
          className={`${actionBtn} text-emerald-700 hover:bg-emerald-50`}
        >
          Publish
        </button>

        {/* Assign = pick a seller + apply */}
        <span className="inline-flex items-center gap-1">
          <select
            value={assignSeller}
            onChange={(e) => setAssignSeller(e.target.value)}
            disabled={none}
            className="rounded border border-neutral-300 px-1.5 py-1 text-xs disabled:bg-neutral-50 disabled:text-neutral-300"
          >
            <option value="">Seller…</option>
            {sellers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              const s = sellers.find((x) => x.id === assignSeller);
              if (s) runBulk(() => bulkAssignSeller(ids, s.id, s.name));
            }}
            disabled={pending || none || !assignSeller}
            className={`${actionBtn} text-neutral-700 hover:bg-neutral-100`}
          >
            Assign
          </button>
        </span>

        <button
          onClick={() => runBulk(() => bulkDuplicatePriceLists(ids))}
          disabled={pending || none}
          className={`${actionBtn} text-neutral-700 hover:bg-neutral-100`}
        >
          Duplicate
        </button>
        <button
          onClick={() => runBulk(() => bulkArchivePriceLists(ids))}
          disabled={pending || none}
          className={`${actionBtn} text-neutral-700 hover:bg-neutral-100`}
        >
          Archive
        </button>
        <button
          onClick={() => {
            if (confirm(`Permanently delete ${ids.length} price list(s)? This cannot be undone.`))
              runBulk(() => bulkDeletePriceLists(ids));
          }}
          disabled={pending || none}
          className={`${actionBtn} text-rose-600 hover:bg-rose-50`}
        >
          Delete
        </button>

        {none ? (
          <span className="ml-auto text-xs text-neutral-400">
            Select one or more price lists to enable these actions.
          </span>
        ) : (
          <button
            onClick={() => setSelected(new Set())}
            disabled={pending}
            className="ml-auto text-xs text-neutral-400 hover:text-neutral-700"
          >
            Clear selection
          </button>
        )}
        {err && <span className="w-full text-rose-700">{err}</span>}
      </div>

      <div className="panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-solux-accent text-left">
              <th className="px-3 py-2 w-8">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Select all"
                  className="h-3.5 w-3.5"
                />
              </th>
              <th className="px-3 py-2 text-xs font-semibold text-neutral-700">Price list</th>
              <th className="px-3 py-2 text-xs font-semibold text-neutral-700">Category</th>
              <th className="px-3 py-2 text-xs font-semibold text-neutral-700">Status</th>
              <th className="px-3 py-2 text-xs font-semibold text-neutral-700 text-right">T1/T2/T3</th>
              <th className="px-3 py-2 text-xs font-semibold text-neutral-700">Effective</th>
              <th className="px-3 py-2 text-xs font-semibold text-neutral-700">Created</th>
              <th className="px-3 py-2 text-xs font-semibold text-neutral-700">Created by</th>
              <th className="px-3 py-2 text-xs font-semibold text-neutral-700">Assigned to</th>
              <th className="px-3 py-2 text-xs font-semibold text-neutral-700 text-right">Products</th>
              <th className="px-3 py-2 text-xs font-semibold text-neutral-700">Updated</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-3 py-6 text-center text-neutral-500">
                  No price lists match the filters.
                </td>
              </tr>
            ) : (
              rows.map((l) => (
                <tr
                  key={l.id}
                  className={`border-t border-neutral-100 hover:bg-neutral-50/60 ${
                    selected.has(l.id) ? "bg-sky-50/60" : ""
                  }`}
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(l.id)}
                      onChange={() => toggle(l.id)}
                      aria-label={`Select ${l.name}`}
                      className="h-3.5 w-3.5"
                    />
                  </td>
                  <td className="px-3 py-2 font-medium">
                    <Link href={`/admin/pricing/${l.id}`} className="hover:underline">
                      {l.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-neutral-600">{l.categoryName ?? "All"}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={l.status} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-neutral-600">{l.margins}</td>
                  <td className="px-3 py-2 text-xs text-neutral-500">{l.effectiveDate ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-neutral-500">{l.createdDate ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-neutral-500">{l.createdBy}</td>
                  <td className="px-3 py-2 text-xs text-neutral-500">{l.assignedTo}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-neutral-600">{l.productCount}</td>
                  <td className="px-3 py-2 text-xs text-neutral-500">{l.lastUpdated ?? "—"}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <Link href={`/admin/pricing/${l.id}`} className="row-link text-xs">
                      Open →
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
