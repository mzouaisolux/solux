"use client";

import { useState, type ReactNode } from "react";

/**
 * CollapsibleSection — Production Order "Premium" section card (brief §5.7).
 * Rendered only inside the `.po-premium` scope, so it can use the premium
 * tokens/classes directly.
 *
 *   CLOSED  → clear title + status pill + (optional) "Action needed" pill,
 *             then a bordered CELL GRID summary (the key facts).
 *   OPEN    → the full detail (`children`): forms, breakdowns, history.
 *
 * A section flagged `attention` gets the Hazard left rail (striped ink) — no
 * color, fully on-brand. Collapsible behaviour is unchanged; server-action
 * forms pass straight through as children.
 */
export function CollapsibleSection({
  title,
  badge,
  summary,
  children,
  defaultOpen = false,
  icon,
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
      className={`panel overflow-hidden ${attention ? "po-attention" : ""}`}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-start justify-between gap-4 px-5 py-4 text-left"
      >
        <div className="min-w-0 flex-1">
          {/* Header: title · status pill · attention pill */}
          <div className="flex items-center gap-2.5 flex-wrap">
            {icon && <span className="text-[color:var(--mute)]">{icon}</span>}
            <h2 className="po-sec-title">{title}</h2>
            {badge}
            {attention && (
              <span className="po-pill po-pill--ink">
                <span className="pdot" />
                {attentionLabel}
              </span>
            )}
          </div>
          {/* Cell-grid summary — closed state only */}
          {summary && !open && <div className="mt-3.5">{summary}</div>}
        </div>
        {/* Open / Close control */}
        <span className="po-toggle mt-0.5 shrink-0">
          {open ? "Close" : "Open"}
          <svg
            className={`h-4 w-4 transition-transform duration-200 ${
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
        <div className="px-5 pb-5 pt-1 border-t border-[color:var(--line)]">
          {children}
        </div>
      )}
    </section>
  );
}

/**
 * SummaryStat — one cell in the closed-state cell grid (brief §5.7).
 *   tone="success" → leading Flash-Green dot (positive: Received, On time…)
 *   tone="muted"   → muted value (— / No / None)
 *   else           → ink value (no rainbow; urgency lives in the Hazard rail)
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
  const muted = tone === "muted";
  const success = tone === "success";
  return (
    <div className="po-cell">
      <div className="po-ck">{label}</div>
      <div className={`po-cv ${muted ? "muted" : ""}`}>
        {success && <span className="gdot" aria-hidden />}
        {value}
      </div>
    </div>
  );
}

/** Bordered cell-grid container for a row of SummaryStat cells. */
export function SummaryRow({ children }: { children: ReactNode }) {
  return <div className="po-cellgrid">{children}</div>;
}
