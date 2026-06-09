"use client";

import Link from "next/link";
import { useState } from "react";

/**
 * Operations Cockpit — compact 4-card command center.
 *
 * v5 design — converged on the Production-card reference. Each card:
 *   1. HEADER : icon + title + big primaryCount + (small) primaryLabel
 *   2. METRICS: a small row of 1-2 "pill" gauges (e.g. "0 delayed",
 *               "1 ending ≤7d"). ALWAYS rendered even when count=0 —
 *               they're operational dials, not "things wrong".
 *   3. ITEMS  : 2-4 real entity entries. Each entry has TWO lines:
 *                 primary   = "PO-005 · VIZONA PT..."  (bold, dark)
 *                 secondary = "Balance of 186.2 still outst..." (gray)
 *               Whole entry is a Link.
 *   4. FOOTER : pinned to the bottom of every card via flex-col +
 *               mt-auto. Visual alignment across all 4 cards stays
 *               consistent regardless of how much content each holds.
 *
 * Card height equalises naturally because the grid stretches items;
 * we add `flex flex-col` + `flex-1` on the items area so empty cards
 * don't collapse. A min-h floor prevents the very-empty case from
 * crushing the visual rhythm.
 */

export type CockpitItem = {
  id: string;
  /** Primary line — "PO-005 · VIZONA PT...". Bold, dark. */
  primary: string;
  /** Secondary line — "Balance of 186.2 still outst...". Gray, smaller. */
  secondary?: string;
  /** Whole entry routes here on click. */
  href?: string;
  /** Visual emphasis tone for the primary text. */
  tone?: "default" | "danger" | "warn" | "info" | "success";
  /** Optional tiny status badge on the right of the primary line —
   *  surfaces collaborative event state for this entity (e.g.
   *  "Working", "Waiting client") so the user can see at a glance
   *  whether someone is already handling it. */
  statusBadge?: {
    label: string;
    tone: "sky" | "sky-light" | "amber" | "purple" | "emerald";
  };
  /** Aggregate unread comment count for the current user across all
   *  events tied to this entity. Drives the pulsing rose dot on the
   *  row (m045). 0 / undefined → no dot. */
  unreadCount?: number;
};

export type CockpitMetric = {
  /** Short noun ("delayed", "ending ≤7d"). */
  label: string;
  /** Count or value, rendered tabular. */
  value: number | string;
  /** Optional tone for the value when emphasis is warranted. */
  tone?: "default" | "danger" | "warn" | "info";
};

export type CockpitCardData = {
  primaryCount: number;
  primaryLabel: string;
  /** 1-2 metric gauges, always rendered (incl. zero values). */
  metrics?: CockpitMetric[];
  /** 2-4 entity rows. Anything beyond is summarised via +N overflow. */
  items: CockpitItem[];
  /** Total candidates in the underlying pool — drives "+N more". */
  totalCount?: number;
  /** Empty state copy when items.length === 0. */
  emptyMessage: string;
  /** Destination of the bottom View → link. */
  viewAllHref: string;
  /** Custom footer label. Defaults to "View →". */
  viewAllLabel?: string;
};

export type OperationsCockpitData = {
  critical: CockpitCardData;
  production: CockpitCardData;
  payments: CockpitCardData;
  quotations: CockpitCardData;
};

/* ===========================================================================
   Tone palettes per card.
   =========================================================================== */

const CARD_TONES = {
  critical: {
    ring: "border-rose-300",
    bg: "bg-rose-50/40",
    dot: "text-rose-600",
    label: "text-rose-900",
    count: "text-rose-700",
  },
  production: {
    ring: "border-sky-200",
    bg: "bg-sky-50/30",
    dot: "text-sky-600",
    label: "text-sky-900",
    count: "text-sky-700",
  },
  payments: {
    ring: "border-amber-200",
    bg: "bg-amber-50/30",
    dot: "text-amber-700",
    label: "text-amber-900",
    count: "text-amber-800",
  },
  quotations: {
    ring: "border-neutral-200",
    bg: "bg-white",
    dot: "text-neutral-600",
    label: "text-neutral-800",
    count: "text-neutral-900",
  },
} as const;

const PRIMARY_TONES = {
  default: "text-neutral-900",
  danger: "text-rose-800",
  warn: "text-amber-800",
  info: "text-sky-800",
  success: "text-emerald-800",
} as const;

const METRIC_VALUE_TONES = {
  default: "text-neutral-800",
  danger: "text-rose-700",
  warn: "text-amber-700",
  info: "text-sky-700",
} as const;

/* ===========================================================================
   Cockpit grid — auto-rows-fr stretches all cards to the tallest row.
   =========================================================================== */

export function OperationsCockpit({
  data,
}: {
  data: OperationsCockpitData;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 auto-rows-fr">
      <CockpitCard
        toneKey="critical"
        icon="●"
        title="Critical"
        card={data.critical}
      />
      <CockpitCard
        toneKey="production"
        icon="◆"
        title="Production"
        card={data.production}
      />
      <CockpitCard
        toneKey="payments"
        icon="$"
        title="Payments"
        card={data.payments}
      />
      <CockpitCard
        toneKey="quotations"
        icon="▤"
        title="Quotations"
        card={data.quotations}
      />
    </div>
  );
}

/* ===========================================================================
   Single card
   =========================================================================== */

function CockpitCard({
  toneKey,
  icon,
  title,
  card,
}: {
  toneKey: keyof typeof CARD_TONES;
  icon: string;
  title: string;
  card: CockpitCardData;
}) {
  const tone = CARD_TONES[toneKey];
  const [collapsed, setCollapsed] = useState(false);
  // Critical card with live items → Hazard treatment (ink frame + striped
  // rail) under the premium scope, so "critical" reads the same here as on
  // the Order detail. Pure presentation (only effective inside .po-premium).
  const critical = toneKey === "critical" && card.primaryCount > 0;
  const shouldPulse = critical;
  const visibleItems = card.items.slice(0, 4);
  const totalItems = card.totalCount ?? card.items.length;
  const overflow = Math.max(0, totalItems - visibleItems.length);

  return (
    <div
      className={`rounded-xl border-2 ${tone.bg} shadow-soft flex flex-col overflow-hidden min-h-[420px] ${
        critical ? "po-hazard border-[color:var(--ink)]" : tone.ring
      }`}
    >
      {/* HEADER */}
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex items-start justify-between gap-2 px-3.5 py-3 hover:bg-black/[0.02] transition-colors text-left"
        aria-expanded={!collapsed}
        title={collapsed ? "Expand" : "Collapse"}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={`text-base leading-none ${
              critical ? "text-[color:var(--ink)]" : tone.dot
            } ${shouldPulse ? "animate-pulse" : ""}`}
            aria-hidden
          >
            {icon}
          </span>
          <span
            className={`text-[10px] font-bold uppercase tracking-widerx ${tone.label}`}
          >
            {title}
          </span>
          <span className="text-[9px] text-neutral-400 ml-1">
            {collapsed ? "▸" : "▾"}
          </span>
        </div>
        <div className="text-right shrink-0">
          <div
            className={`text-3xl font-bold tabular-nums leading-none ${tone.count}`}
          >
            {card.primaryCount}
          </div>
          <div className="text-[9px] uppercase tracking-widerx text-neutral-500 mt-1">
            {card.primaryLabel}
          </div>
        </div>
      </button>

      {/* COLLAPSED — nothing else, footer still pinned via flex-1 spacer. */}
      {collapsed ? (
        <div className="flex-1" />
      ) : (
        <>
          {/* METRICS PILLS — always visible, including zero values, so
              users see the operational dials at a glance. */}
          {card.metrics && card.metrics.length > 0 && (
            <div className="px-3.5 pb-2 flex flex-wrap gap-1.5">
              {card.metrics.map((m) => (
                <div
                  key={m.label}
                  className="inline-flex items-baseline gap-1 rounded-md border border-neutral-200/80 bg-white px-2 py-0.5 text-[10px]"
                >
                  <span
                    className={`font-bold tabular-nums ${
                      METRIC_VALUE_TONES[m.tone ?? "default"]
                    }`}
                  >
                    {m.value}
                  </span>
                  <span className="text-neutral-500">{m.label}</span>
                </div>
              ))}
            </div>
          )}

          {/* ITEMS — grows to fill the card so footer stays at bottom. */}
          <div className="flex-1 px-2 pb-1">
            {visibleItems.length === 0 ? (
              <p className="text-[11px] text-neutral-400 italic text-center py-4 px-2">
                {card.emptyMessage}
              </p>
            ) : (
              <ul className="space-y-0">
                {visibleItems.map((item) => (
                  <li key={item.id}>
                    <CockpitTwoLineRow item={item} />
                  </li>
                ))}
                {overflow > 0 && (
                  <li>
                    <Link
                      href={card.viewAllHref}
                      className="block px-2 py-1 text-[10px] text-neutral-500 hover:text-neutral-900 font-medium"
                    >
                      +{overflow} more →
                    </Link>
                  </li>
                )}
              </ul>
            )}
          </div>

          {/* FOOTER — mt-auto pins it to the bottom even when items are
              sparse. Same height across all 4 cards thanks to the
              fixed paddings + auto-rows-fr on the grid. */}
          <div className="mt-auto px-3.5 py-2.5 border-t border-neutral-200/60 bg-white/40">
            <Link
              href={card.viewAllHref}
              className="block w-full text-center text-[11px] font-semibold text-neutral-700 hover:text-neutral-900 transition-colors"
            >
              {card.viewAllLabel ?? "View →"}
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

/* ===========================================================================
   Two-line entity row.

   Primary line   = bold, dark, identity ("PO-005 · VIZONA PT...")
   Secondary line = gray, smaller, descriptive ("Balance overdue · prod...")

   Whole row hover-able, whole row a Link.
   =========================================================================== */

/** Tailwind palette for the optional status badge on a cockpit row. */
const STATUS_BADGE_TONES = {
  sky: "bg-sky-600 text-white border-sky-700", // working — active
  "sky-light": "bg-sky-100 text-sky-900 border-sky-200", // acknowledged
  amber: "bg-amber-100 text-amber-900 border-amber-300", // waiting
  purple: "bg-purple-100 text-purple-900 border-purple-300", // escalated
  emerald: "bg-emerald-100 text-emerald-800 border-emerald-200",
} as const;

function CockpitTwoLineRow({ item }: { item: CockpitItem }) {
  const primaryClass = PRIMARY_TONES[item.tone ?? "default"];
  const badge = item.statusBadge;
  const unread = item.unreadCount ?? 0;
  const hasUnread = unread > 0;
  // Critical (delayed / overdue) rows → Hazard striped rail under premium.
  const danger = item.tone === "danger";
  const inner = (
    <div
      className={`px-2 py-1.5 rounded-md transition-colors ${
        danger ? "po-hazard pl-3" : ""
      } ${
        hasUnread
          ? "bg-rose-50/60 hover:bg-rose-50 border-l-2 border-rose-400 -ml-0.5 pl-1.5"
          : "hover:bg-white/80"
      }`}
    >
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {/* Unread pulse dot — small, subtle, only when unread > 0. */}
          {hasUnread && (
            <span
              className="relative inline-flex shrink-0"
              title={`${unread} new comment${unread === 1 ? "" : "s"} since your last visit`}
            >
              <span className="absolute inline-flex h-2 w-2 rounded-full bg-rose-400 opacity-75 animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-600" />
            </span>
          )}
          <div
            className={`text-[12px] font-semibold truncate leading-tight ${primaryClass}`}
            title={item.primary}
          >
            {item.primary}
          </div>
        </div>
        {badge && (
          <span
            className={`inline-flex items-center px-1.5 py-[1px] rounded text-[9px] font-semibold uppercase tracking-widerx border shrink-0 ${
              STATUS_BADGE_TONES[badge.tone]
            }`}
            title={`Collaborative status: ${badge.label}`}
          >
            {badge.label}
          </span>
        )}
      </div>
      {item.secondary && (
        <div
          className={`text-[11px] truncate mt-0.5 leading-tight ${
            hasUnread ? "text-rose-700 font-medium" : "text-neutral-500"
          }`}
          title={item.secondary}
        >
          {hasUnread && (
            <span className="mr-1">💬 {unread} new ·</span>
          )}
          {item.secondary}
        </div>
      )}
    </div>
  );
  if (item.href) {
    return (
      <Link href={item.href} className="block">
        {inner}
      </Link>
    );
  }
  return inner;
}
