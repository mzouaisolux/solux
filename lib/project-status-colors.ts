/**
 * Project Request status → visual color system (m090).
 *
 * Disciplined SOLUX Projects palette (from the offline mockup): rather than a
 * rainbow, statuses read in three accents — ink (in-flight), amber (waiting on
 * the director), green (commercial: quotation ready / won) — plus a neutral
 * line for inert states (draft / lost / cancelled / archived). Class strings
 * are spelled out literally (incl. arbitrary hex values) so Tailwind JIT picks
 * them up (tailwind.config content paths already include lib/**).
 */

import type { StatusColor } from "@/lib/status-colors";
import type { ProjectRequestStatus } from "@/lib/types";

// Palette atoms — mirror the mockup's --sx-* tokens.
const NEUTRAL: StatusColor = {
  dot: "bg-[#aeaaba]",
  leftBorder: "border-l-[#dcdde1]",
  rowBg: "",
  pill: "bg-white text-[#2a2a2c] border-[#dcdde1]",
};
const INK: StatusColor = {
  dot: "bg-[#0f0f0f]",
  leftBorder: "border-l-[#0f0f0f]",
  rowBg: "",
  pill: "bg-white text-[#0f0f0f] border-[#0f0f0f]",
};
const AMBER: StatusColor = {
  dot: "bg-[#e8870e]",
  leftBorder: "border-l-[#e8870e]",
  rowBg: "",
  pill: "bg-[#fcf3e8] text-[#9a5a00] border-[#eac79b]",
};
const GREEN: StatusColor = {
  dot: "bg-[#55ff7e]",
  leftBorder: "border-l-[#55ff7e]",
  rowBg: "",
  pill: "bg-[#ecfff1] text-[#0f0f0f] border-[#a9f4be]",
};
// "Won" — the only filled badge (ink chip with a neon dot).
const GREEN_FILL: StatusColor = {
  dot: "bg-[#55ff7e]",
  leftBorder: "border-l-[#55ff7e]",
  rowBg: "",
  pill: "bg-[#0f0f0f] text-white border-[#0f0f0f]",
};

export const PROJECT_REQUEST_STATUS_COLORS: Record<ProjectRequestStatus, StatusColor> = {
  draft: NEUTRAL,
  submitted: INK,
  waiting_director_approval: AMBER,
  waiting_factory_cost: INK, // "Operations in progress"
  waiting_logistics: INK, // same stage, same accent
  ready_for_pricing: INK,
  priced: INK,
  quotation_generated: GREEN,
  won: GREEN_FILL,
  lost: NEUTRAL,
  cancelled: NEUTRAL,
};

const ARCHIVED: StatusColor = NEUTRAL;

export function projectStatusColors(
  status: ProjectRequestStatus,
  archived?: boolean | null
): StatusColor {
  if (archived) return ARCHIVED;
  return PROJECT_REQUEST_STATUS_COLORS[status] ?? PROJECT_REQUEST_STATUS_COLORS.draft;
}
