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
  setCatalogueUsage,
} from "../actions";

export type LibraryRow = {
  id: string;
  name: string;
  categoryName: string | null;
  status: PriceListStatus;
  /** m170 — whether this list feeds catalogue pricing in the quote builder. */
  useAsCataloguePricing: boolean;
  margins: string;
  effectiveDate: string | null;
  createdDate: string | null;
  createdBy: string;
  assignedTo: string;
  productCount: number;
  lastUpdated: string | null;
};

function StatusBadge({ status }: { status: PriceListStatus }) {
  return <span className={`px-sbadge ${status}`}>{status}</span>;
}

/**
 * m170 — "Use as Catalogue Pricing" switch. Optimistic toggle: flips the
 * server flag then refreshes so the quote builder picks it up immediately.
 * Only a PUBLISHED list can actually feed catalogue pricing, so the switch is
 * disabled (with a hint) on draft/archived lists.
 */
function CatalogueSwitch({
  id,
  on,
  disabled,
}: {
  id: string;
  on: boolean;
  disabled: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState(on);
  const toggle = () => {
    const next = !optimistic;
    setOptimistic(next);
    startTransition(async () => {
      try {
        await setCatalogueUsage(id, next);
        router.refresh();
      } catch {
        setOptimistic(!next); // revert on failure
      }
    });
  };
  return (
    <button
      type="button"
      role="switch"
      aria-checked={optimistic}
      aria-label="Use as catalogue pricing"
      onClick={toggle}
      disabled={disabled || pending}
      title={
        disabled
          ? "Publish this price list first — only published lists can feed catalogue pricing."
          : optimistic
          ? "Catalogue pricing ON — products in this category are auto-priced for sales."
          : "Catalogue pricing OFF — products require an approved Service Request."
      }
      className={`px-catswitch ${optimistic ? "on" : "off"}`}
      style={{
        width: 40,
        height: 22,
        borderRadius: 999,
        border: "1px solid var(--sx-line)",
        background: optimistic ? "var(--sx-go, #16a34a)" : "var(--sx-line, #d4d4d4)",
        position: "relative",
        cursor: disabled || pending ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        transition: "background 120ms",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: optimistic ? 20 : 2,
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "#fff",
          transition: "left 120ms",
          boxShadow: "0 1px 2px rgba(0,0,0,.25)",
        }}
      />
    </button>
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

  return (
    <div className="space-y-2">
      {/* PERMANENT ACTION TOOLBAR */}
      <div className="card px-toolbar">
        <span className="px-tllabel">Actions</span>
        <span className={`px-selcount ${none ? "" : "some"}`}>
          {none ? "none selected" : `${selected.size} selected`}
        </span>
        <span className="px-sep">|</span>

        <button
          onClick={() => runBulk(() => bulkPublishPriceLists(ids))}
          disabled={pending || none}
          className="px-tact pub"
        >
          Publish
        </button>

        {/* Assign = pick a seller + apply */}
        <span className="inline-flex items-center gap-1">
          <select
            value={assignSeller}
            onChange={(e) => setAssignSeller(e.target.value)}
            disabled={none}
            className="mini"
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
            className="px-tact neutral"
          >
            Assign
          </button>
        </span>

        <button onClick={() => runBulk(() => bulkDuplicatePriceLists(ids))} disabled={pending || none} className="px-tact neutral">
          Duplicate
        </button>
        <button onClick={() => runBulk(() => bulkArchivePriceLists(ids))} disabled={pending || none} className="px-tact neutral">
          Archive
        </button>
        <button
          onClick={() => {
            if (confirm(`Permanently delete ${ids.length} price list(s)? This cannot be undone.`))
              runBulk(() => bulkDeletePriceLists(ids));
          }}
          disabled={pending || none}
          className="px-tact del"
        >
          Delete
        </button>

        {none ? (
          <span className="px-spacer" style={{ cursor: "default", textDecoration: "none" }}>
            Select one or more price lists to enable these actions.
          </span>
        ) : (
          <button onClick={() => setSelected(new Set())} disabled={pending} className="px-spacer">
            Clear selection
          </button>
        )}
        {err && <span style={{ width: "100%", color: "var(--sx-amber-deep)" }}>{err}</span>}
      </div>

      <div className="card" style={{ marginTop: 14, padding: 0 }}>
        <div style={{ overflowX: "auto" }}>
          <table className="px-grid">
            <thead>
              <tr>
                <th style={{ width: 34 }}>
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
                </th>
                <th>Price list</th>
                <th>Category</th>
                <th>Status</th>
                <th title="When ON, this published list feeds catalogue pricing in the quote builder">Catalogue</th>
                <th className="num">T1/T2/T3</th>
                <th>Effective</th>
                <th>Created</th>
                <th>Created by</th>
                <th>Assigned to</th>
                <th className="num">Products</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={13} style={{ textAlign: "center", padding: "28px 12px", color: "var(--sx-mute)" }}>
                    No price lists match the filters.
                  </td>
                </tr>
              ) : (
                rows.map((l) => (
                  <tr key={l.id} className={selected.has(l.id) ? "sel" : ""}>
                    <td>
                      <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} aria-label={`Select ${l.name}`} />
                    </td>
                    <td>
                      <Link href={`/admin/pricing/${l.id}`} className="px-namelink">{l.name}</Link>
                    </td>
                    <td className="px-sub">{l.categoryName ?? "All"}</td>
                    <td><StatusBadge status={l.status} /></td>
                    <td>
                      <CatalogueSwitch
                        id={l.id}
                        on={l.useAsCataloguePricing}
                        disabled={l.status !== "published"}
                      />
                    </td>
                    <td className="num px-sub">{l.margins}</td>
                    <td className="px-sub">{l.effectiveDate ?? "—"}</td>
                    <td className="px-sub">{l.createdDate ?? "—"}</td>
                    <td className="px-sub">{l.createdBy}</td>
                    <td className="px-sub">{l.assignedTo}</td>
                    <td className="num px-sub">{l.productCount}</td>
                    <td className="px-sub">{l.lastUpdated ?? "—"}</td>
                    <td className="num">
                      <Link href={`/admin/pricing/${l.id}`} className="px-rowlink">Open →</Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
