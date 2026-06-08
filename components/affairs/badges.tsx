"use client";

// =====================================================================
// EXPERIMENTAL Affairs View — shared badge system (prototype, read-only).
// One controlled SOLUX-toned palette for every status/stage chip so the
// view stays premium and consistent (no rainbow pastels).
// =====================================================================

import type { ReactNode } from "react";
import { DOC_STATUS_LABEL, type DocStatus } from "@/lib/types";
import { STAGE_LABEL, type AffairStage } from "@/lib/affairs-prototype";

export function Pill({
  tone,
  title,
  children,
}: {
  tone: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10.5px] font-medium leading-none ring-1 ring-inset ${tone}`}
    >
      {children}
    </span>
  );
}

// Commercial status — muted, controlled tones.
const STATUS_TONE: Record<DocStatus, string> = {
  draft: "bg-neutral-100 text-neutral-600 ring-neutral-200/70",
  sent: "bg-sky-50 text-sky-700 ring-sky-200/70",
  negotiating: "bg-amber-50 text-amber-700 ring-amber-200/70",
  won: "bg-solux/10 text-solux-dark ring-solux/30",
  lost: "bg-rose-50 text-rose-700 ring-rose-200/70",
  cancelled: "bg-zinc-100 text-zinc-500 ring-zinc-200",
};

export function StatusBadge({
  status,
  archived,
}: {
  status: DocStatus;
  archived?: boolean;
}) {
  if (archived) {
    return (
      <Pill tone="bg-zinc-100 text-zinc-600 ring-zinc-300">Archived</Pill>
    );
  }
  return <Pill tone={STATUS_TONE[status]}>{DOC_STATUS_LABEL[status] ?? status}</Pill>;
}

// Operational stage — controlled tones, attention = amber, risk = rose.
const STAGE_TONE: Record<AffairStage, string> = {
  no_task_list: "bg-neutral-100 text-neutral-500 ring-neutral-200/70",
  task_list_missing: "bg-amber-50 text-amber-700 ring-amber-200/70",
  task_list_created: "bg-slate-100 text-slate-600 ring-slate-200",
  in_production: "bg-sky-50 text-sky-700 ring-sky-200/70",
  production_delayed: "bg-rose-50 text-rose-700 ring-rose-200/70",
  ready_to_ship: "bg-indigo-50 text-indigo-700 ring-indigo-200/70",
  delivered: "bg-solux/10 text-solux-dark ring-solux/30",
  cancelled: "bg-zinc-100 text-zinc-500 ring-zinc-200",
};

export function StageBadge({ stage }: { stage: AffairStage }) {
  return <Pill tone={STAGE_TONE[stage]}>{STAGE_LABEL[stage]}</Pill>;
}

// Forecast probability — deliberately NEUTRAL (ink), so it never competes
// with status colour and is never confused with production progress.
export function ProbabilityChip({ pct }: { pct: number }) {
  return (
    <span className="inline-flex items-center rounded-md bg-solux-ink/[0.06] px-1.5 py-0.5 text-[10.5px] font-semibold leading-none tabular-nums text-solux-ink ring-1 ring-inset ring-neutral-200">
      {Math.round(pct)}%
    </span>
  );
}

// Real affair lifecycle (affairs.status, m077): lead → … → completed / lost.
const LIFECYCLE: Record<string, { label: string; tone: string }> = {
  // 'open' is the m076 placeholder, shown cleanly until m077 is applied.
  open: { label: "Open", tone: "bg-neutral-100 text-neutral-600 ring-neutral-200/70" },
  lead: { label: "Lead", tone: "bg-neutral-100 text-neutral-600 ring-neutral-200/70" },
  opportunity: { label: "Opportunity", tone: "bg-sky-50 text-sky-700 ring-sky-200/70" },
  quotation: { label: "Quotation", tone: "bg-slate-100 text-slate-600 ring-slate-200" },
  negotiation: { label: "Negotiation", tone: "bg-amber-50 text-amber-700 ring-amber-200/70" },
  won: { label: "Won", tone: "bg-solux/10 text-solux-dark ring-solux/30" },
  in_production: { label: "In production", tone: "bg-amber-50 text-amber-700 ring-amber-200/70" },
  shipped: { label: "Shipped", tone: "bg-indigo-50 text-indigo-700 ring-indigo-200/70" },
  completed: { label: "Completed", tone: "bg-emerald-50 text-emerald-700 ring-emerald-200/70" },
  lost: { label: "Lost", tone: "bg-rose-50 text-rose-700 ring-rose-200/70" },
  abandoned: { label: "Abandoned", tone: "bg-zinc-100 text-zinc-500 ring-zinc-200" },
};

export function LifecycleBadge({ status }: { status: string }) {
  const m = LIFECYCLE[status] ?? {
    label: status,
    tone: "bg-neutral-100 text-neutral-600 ring-neutral-200/70",
  };
  return <Pill tone={m.tone}>{m.label}</Pill>;
}

export function fmtDate(s: string | null, opts?: Intl.DateTimeFormatOptions): string {
  if (!s) return "";
  const d = new Date(s);
  // Pin the locale so server-rendered HTML matches the client (no hydration mismatch).
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(
        "en-US",
        opts ?? { year: "2-digit", month: "short", day: "numeric" },
      );
}
