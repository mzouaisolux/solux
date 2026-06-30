"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import InlineStatusSwitcher from "@/components/InlineStatusSwitcher";
import DocQuickActions from "@/components/DocQuickActions";
import type { DocStatus } from "@/lib/types";

export type ClientDocRow = {
  id: string;
  number: string | null;
  type: string;
  date: string;
  total_price: number | null;
  status: string | null;
  currency: string | null;
  affair_id: string | null;
  affair_name: string | null;
  taskList: { id: string; number: string | null } | null;
};

const ALL = "__all__";
const UNASSIGNED = "__unassigned__";

function money(v: number | null, currency: string | null): string {
  const n = Number(v ?? 0);
  return `${currency ? currency + " " : "$"}${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function shortDate(d: string): string {
  return new Date(d).toLocaleDateString("en-GB", {
    year: "2-digit",
    month: "short",
    day: "2-digit",
  });
}

type Group = {
  key: string;
  name: string;
  unassigned: boolean;
  docs: ClientDocRow[];
  wonValue: number;
  currency: string | null;
};

/**
 * Client Documents tab — grouped by AFFAIRE (project) instead of one flat
 * list, so a client with years of history stays navigable. Collapsible
 * sections + an affaire filter; each section splits into Quotations and
 * Invoices (proformas). Legacy documents with no affaire fall into an
 * "Unassigned" bucket. Per-row status switch + quick actions are preserved.
 */
export function ClientDocumentsByAffaire({ docs }: { docs: ClientDocRow[] }) {
  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    for (const d of docs) {
      const unassigned = !d.affair_id;
      const key = d.affair_id ?? UNASSIGNED;
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          name:
            d.affair_name?.trim() ||
            (unassigned ? "Unassigned" : "Untitled affair"),
          unassigned,
          docs: [],
          wonValue: 0,
          currency: d.currency,
        };
        map.set(key, g);
      }
      g.docs.push(d);
      if ((d.status ?? "") === "won") g.wonValue += Number(d.total_price ?? 0);
    }
    const arr = [...map.values()];
    // Named affaires first (most recent activity on top); Unassigned last.
    arr.sort((a, b) => {
      if (a.unassigned !== b.unassigned) return a.unassigned ? 1 : -1;
      return (b.docs[0]?.date ?? "").localeCompare(a.docs[0]?.date ?? "");
    });
    return arr;
  }, [docs]);

  const [filter, setFilter] = useState<string>(ALL);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const visible = filter === ALL ? groups : groups.filter((g) => g.key === filter);

  function toggle(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      {groups.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <FilterChip active={filter === ALL} onClick={() => setFilter(ALL)}>
            All affaires
          </FilterChip>
          {groups.map((g) => (
            <FilterChip
              key={g.key}
              active={filter === g.key}
              onClick={() => setFilter(g.key)}
            >
              {g.name}{" "}
              <span className="opacity-60 tabular-nums">{g.docs.length}</span>
            </FilterChip>
          ))}
        </div>
      )}

      {visible.map((g) => {
        const open = !collapsed.has(g.key);
        const quotations = g.docs.filter((d) => d.type === "quotation");
        const proformas = g.docs.filter((d) => d.type === "proforma");
        const others = g.docs.filter(
          (d) => d.type !== "quotation" && d.type !== "proforma"
        );
        return (
          <section key={g.key} className="panel overflow-hidden">
            <button
              type="button"
              onClick={() => toggle(g.key)}
              className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-neutral-50/70"
            >
              <Chevron open={open} />
              <span
                className={`font-semibold ${
                  g.unassigned ? "text-neutral-500" : "text-neutral-900"
                }`}
              >
                {g.name}
              </span>
              <span className="text-xs text-neutral-500">
                {g.docs.length} document{g.docs.length === 1 ? "" : "s"}
              </span>
              {g.wonValue > 0 && (
                <span className="ml-auto text-xs font-semibold tabular-nums text-neutral-700">
                  {money(g.wonValue, g.currency)}
                </span>
              )}
            </button>
            {open && (
              <div className="border-t border-neutral-100">
                <SubGroup label="Quotations" rows={quotations} />
                <SubGroup label="Invoices (proforma)" rows={proformas} />
                <SubGroup label="Other" rows={others} />
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function SubGroup({ label, rows }: { label: string; rows: ClientDocRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="px-3 py-2">
      <div className="px-1 py-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
        {label}{" "}
        <span className="font-normal text-neutral-300">{rows.length}</span>
      </div>
      <div className="divide-y divide-neutral-100">
        {rows.map((d) => (
          <div
            key={d.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-1 py-2 text-sm"
          >
            <Link
              href={`/documents/${d.id}`}
              className="font-mono text-[13px] hover:underline"
            >
              {d.number ?? "—"}
            </Link>
            <span className="text-xs text-neutral-500">{shortDate(d.date)}</span>
            <span className="ml-auto font-semibold tabular-nums">
              {money(d.total_price, d.currency)}
            </span>
            <InlineStatusSwitcher
              docId={d.id}
              current={(d.status as DocStatus) ?? "draft"}
            />
            <DocQuickActions
              doc={{ id: d.id, status: d.status ?? "draft" }}
              taskList={d.taskList}
            />
            <Link href={`/documents/${d.id}`} className="row-link text-xs">
              Open →
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-3 py-1 text-xs transition-colors ${
        active
          ? "border-neutral-800 bg-neutral-900 text-white"
          : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"
      }`}
    >
      {children}
    </button>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={`h-3.5 w-3.5 shrink-0 text-neutral-400 transition-transform ${
        open ? "rotate-90" : ""
      }`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d="M7 5l6 5-6 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
