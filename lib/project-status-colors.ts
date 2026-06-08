/**
 * Project Request status → visual color system (m090).
 *
 * Mirrors lib/status-colors.ts: subtle, semantic pills + left-border accents.
 * Class strings are spelled out literally so Tailwind JIT picks them up
 * (tailwind.config content paths already include lib/**). Archived rows read
 * neutral regardless of status.
 *
 * Semantic mapping: draft/cancelled > neutral, submitted/priced > sky,
 * waiting-approval > amber, waiting-cost > indigo, waiting-logistics > teal,
 * ready-for-pricing > violet, quotation-generated/won > emerald, lost > rose.
 */

import type { StatusColor } from "@/lib/status-colors";
import type { ProjectRequestStatus } from "@/lib/types";

export const PROJECT_REQUEST_STATUS_COLORS: Record<ProjectRequestStatus, StatusColor> = {
  draft: {
    dot: "bg-neutral-400",
    leftBorder: "border-l-neutral-300",
    rowBg: "",
    pill: "bg-neutral-50 text-neutral-700 border-neutral-200",
  },
  submitted: {
    dot: "bg-sky-500",
    leftBorder: "border-l-sky-400",
    rowBg: "",
    pill: "bg-sky-50 text-sky-800 border-sky-200",
  },
  waiting_director_approval: {
    dot: "bg-amber-500",
    leftBorder: "border-l-amber-400",
    rowBg: "",
    pill: "bg-amber-50 text-amber-800 border-amber-200",
  },
  waiting_factory_cost: {
    dot: "bg-indigo-500",
    leftBorder: "border-l-indigo-400",
    rowBg: "",
    pill: "bg-indigo-50 text-indigo-800 border-indigo-200",
  },
  // Same palette as waiting_factory_cost — both display "Operations in progress".
  waiting_logistics: {
    dot: "bg-indigo-500",
    leftBorder: "border-l-indigo-400",
    rowBg: "",
    pill: "bg-indigo-50 text-indigo-800 border-indigo-200",
  },
  ready_for_pricing: {
    dot: "bg-violet-500",
    leftBorder: "border-l-violet-400",
    rowBg: "",
    pill: "bg-violet-50 text-violet-800 border-violet-200",
  },
  priced: {
    dot: "bg-sky-600",
    leftBorder: "border-l-sky-500",
    rowBg: "",
    pill: "bg-sky-50 text-sky-800 border-sky-200",
  },
  quotation_generated: {
    dot: "bg-emerald-500",
    leftBorder: "border-l-emerald-400",
    rowBg: "",
    pill: "bg-emerald-50 text-emerald-800 border-emerald-200",
  },
  won: {
    dot: "bg-emerald-600",
    leftBorder: "border-l-emerald-600",
    rowBg: "",
    pill: "bg-emerald-100 text-emerald-900 border-emerald-300",
  },
  lost: {
    dot: "bg-rose-400",
    leftBorder: "border-l-rose-300",
    rowBg: "",
    pill: "bg-rose-50 text-rose-700 border-rose-200",
  },
  cancelled: {
    dot: "bg-neutral-400",
    leftBorder: "border-l-neutral-200",
    rowBg: "",
    pill: "bg-neutral-100 text-neutral-600 border-neutral-200",
  },
};

const ARCHIVED: StatusColor = {
  dot: "bg-neutral-400",
  leftBorder: "border-l-neutral-200",
  rowBg: "",
  pill: "bg-neutral-100 text-neutral-600 border-neutral-200",
};

export function projectStatusColors(
  status: ProjectRequestStatus,
  archived?: boolean | null
): StatusColor {
  if (archived) return ARCHIVED;
  return PROJECT_REQUEST_STATUS_COLORS[status] ?? PROJECT_REQUEST_STATUS_COLORS.draft;
}
