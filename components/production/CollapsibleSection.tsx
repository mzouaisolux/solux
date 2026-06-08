"use client";

import { useState, type ReactNode } from "react";

/**
 * CollapsibleSection — a premium, glanceable summary card used to restructure
 * the production-order cockpit so the page reads in 5 seconds instead of one
 * long wall of forms.
 *
 *   CLOSED  → bold title + status badge + (optional) "Action needed" chip, then
 *             a row of KPI tiles (the key facts, colored when they matter).
 *   OPEN    → the full detail (`children`): forms, breakdowns, history.
 *
 * Server-rendered children (including <form action={serverAction}>) pass
 * straight through — toggling open just mounts/unmounts that subtree on the
 * client; the server actions keep working unchanged.
 */
export function CollapsibleSection({
  title,
  badge,
  summary,
  children,
  defaultOpen = false,
  icon,
  /** When true, the card gets a subtle amber accent + "Action needed" chip. */
  attention = false,
  attentionLabel = "Action needed",
}: {
  title: string;
  badge?: ReactNode;
  summary?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  icon?: ReactNode;
  attention?: boolean;
  attentionLabel?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section
      className={`group relative overflow-hidden rounded-xl border bg-white transition-all duration-200 ${
        attention
          ? "border-amber-200/90 shadow-[0_1px_2px_rgba(180,120,0,0.05)]"
          : "border-neutral-200/90"
      } ${
        open
          ? "shadow-sm ring-1 ring-neutral-100"
          : "hover:border-neutral-300 hover:shadow-sm"
      }`}
    >
      {/* Left accent bar — only when the section needs attention. */}
      {attention && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-amber-400/90"
        />
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-start justify-between gap-4 px-5 py-4 text-left"
      >
        <div className="min-w-0 flex-1">
          {/* Header: title · status badge · attention chip */}
          <div className="flex items-center gap-2.5 flex-wrap">
            {icon && <span className="text-neutral-400">{icon}</span>}
            <h2 className="text-base font-semibold tracking-tight text-neutral-900">
              {title}
            </h2>
            {badge}
            {attention && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-amber-700">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                {attentionLabel}
              </span>
            )}
          </div>
          {/* KPI summary — closed state only */}
          {summary && !open && <div className="mt-3.5">{summary}</div>}
        </div>
        {/* Open / Close affordance */}
        <span className="mt-0.5 shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-neutral-50/80 px-2.5 py-1.5 text-xs font-semibold text-neutral-600 transition-colors group-hover:border-neutral-300 group-hover:bg-white">
          {open ? "Close" : "Open"}
          <svg
            className={`h-4 w-4 text-neutral-400 transition-transform duration-200 ${
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
 * SummaryStat — one KPI tile for the closed-state row. A soft rounded tile
 * with a small readable label and a large, contrasted value. Tone tints the
 * whole tile so blocking / late / done states pop without reading the text.
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
  const toneClass =
    tone === "warn"
      ? "bg-amber-50 text-amber-700"
      : tone === "success"
      ? "bg-emerald-50 text-emerald-700"
      : tone === "danger"
      ? "bg-rose-50 text-rose-700"
      : tone === "muted"
      ? "bg-neutral-50 text-neutral-400"
      : "bg-neutral-50 text-neutral-900";
  const labelClass =
    tone === "warn"
      ? "text-amber-600/80"
      : tone === "success"
      ? "text-emerald-600/80"
      : tone === "danger"
      ? "text-rose-600/80"
      : "text-neutral-400";
  return (
    <div className={`rounded-lg px-3.5 py-2.5 min-w-[116px] ${toneClass}`}>
      <div
        className={`text-[10px] font-semibold uppercase tracking-wide ${labelClass}`}
      >
        {label}
      </div>
      <div className="mt-1 text-[15px] font-bold leading-tight tabular-nums">
        {value}
      </div>
    </div>
  );
}

/** Flex-wrap container for a row of SummaryStat KPI tiles. */
export function SummaryRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2.5">{children}</div>;
}
