"use client";

import { useState, type ReactNode } from "react";

/**
 * CollapsibleSection — a compact, expandable card used to restructure the
 * production-order cockpit so the page is glanceable instead of one long wall.
 *
 *   CLOSED  → clear title + status badge (right) + a compact `summary` row
 *             (the key facts: ETA, balance remaining, booked?, …).
 *   OPEN    → the full detail (`children`): forms, breakdowns, history.
 *
 * Server-rendered children (including <form action={serverAction}>) are passed
 * straight through — toggling open simply mounts/unmounts that subtree on the
 * client; the server actions keep working unchanged.
 */
export function CollapsibleSection({
  title,
  badge,
  summary,
  children,
  defaultOpen = false,
  icon,
}: {
  title: string;
  /** Status chip shown on the right of the header (always visible). */
  badge?: ReactNode;
  /** Compact key-facts row shown ONLY when collapsed. */
  summary?: ReactNode;
  /** Full detail shown ONLY when expanded. */
  children: ReactNode;
  defaultOpen?: boolean;
  icon?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="panel overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="group w-full flex items-start justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-neutral-50/70"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {icon && <span className="text-neutral-400">{icon}</span>}
            <h2 className="text-[15px] font-semibold tracking-tight text-neutral-900">
              {title}
            </h2>
            {badge}
          </div>
          {summary && !open && (
            <div className="mt-2.5">{summary}</div>
          )}
        </div>
        <span className="flex items-center gap-2 shrink-0 pt-0.5">
          <span className="text-[11px] font-medium text-neutral-400 group-hover:text-neutral-600 hidden sm:inline">
            {open ? "Close" : "Open"}
          </span>
          <svg
            className={`h-5 w-5 text-neutral-400 transition-transform duration-200 ${
              open ? "rotate-180" : ""
            }`}
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </span>
      </button>
      {open && (
        <div className="px-5 pb-5 pt-1 border-t border-neutral-100">{children}</div>
      )}
    </section>
  );
}

/**
 * SummaryStat — one label/value pair for the compact closed-state row.
 * Kept here so both the page and any future surface render summaries the same.
 */
export function SummaryStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  tone?: "default" | "muted" | "warn" | "success" | "danger";
}) {
  const valueClass =
    tone === "warn"
      ? "text-amber-700"
      : tone === "success"
      ? "text-emerald-700"
      : tone === "danger"
      ? "text-rose-700"
      : tone === "muted"
      ? "text-neutral-500"
      : "text-neutral-800";
  return (
    <span className="inline-flex flex-col">
      <span className="text-[10px] uppercase tracking-widerx font-semibold text-neutral-400">
        {label}
      </span>
      <span className={`text-sm font-semibold tabular-nums ${valueClass}`}>
        {value}
      </span>
    </span>
  );
}

/** Horizontal wrapper for a row of SummaryStat items. */
export function SummaryRow({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2.5">{children}</div>
  );
}
