// =====================================================================
// Tender pipeline status vocabulary (m112) — PURE module, importable
// from server pages (client hub "Active Tenders") and client components
// (TendersManager / TenderPipeline) alike.
// =====================================================================

/** Pipeline: Accepted → Searching Partner → Partner Identified →
 *  Contacted → Waiting Feedback → Interested → Project Request →
 *  Opportunity Created | Rejected | Lost. ('partner_assigned' keeps its
 *  DB value, displayed as "Partner Identified".) */
export const COMMERCIAL_STATUS_LABEL: Record<string, string> = {
  new: "New",
  accepted: "Accepted",
  searching_partner: "Searching Partner",
  partner_assigned: "Partner Identified",
  contacted: "Contacted",
  waiting_feedback: "Waiting Feedback",
  interested: "Interested",
  project_request: "Project Request",
  opportunity_created: "Opportunity Created",
  rejected: "Rejected",
  lost: "Lost",
};

export const STATUS_CHIP: Record<string, string> = {
  new: "bg-sky-50 text-sky-700 ring-sky-200",
  accepted: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  searching_partner: "bg-amber-50 text-amber-800 ring-amber-300",
  partner_assigned: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  contacted: "bg-blue-50 text-blue-700 ring-blue-200",
  waiting_feedback: "bg-violet-50 text-violet-700 ring-violet-200",
  interested: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  project_request: "bg-teal-50 text-teal-700 ring-teal-200",
  opportunity_created: "bg-neutral-900 text-white ring-neutral-900",
  rejected: "bg-rose-50 text-rose-700 ring-rose-200",
  lost: "bg-neutral-100 text-neutral-400 ring-neutral-200",
};

/** The Kanban columns of the Tender Pipeline. */
export const PIPELINE_STAGES = [
  "accepted", "searching_partner", "partner_assigned", "contacted",
  "waiting_feedback", "interested", "project_request", "opportunity_created",
] as const;

/** Columns shown on the Kanban BOARD (UX refactor) — converted tenders
 *  leave the board: their work continues on the affair (/affairs). */
export const BOARD_STAGES = [
  "accepted", "searching_partner", "partner_assigned", "contacted",
  "waiting_feedback", "interested", "project_request",
] as const;

/** Active pipeline = accepted tenders being worked (critical rule §10). */
export const ACTIVE_PIPELINE = new Set<string>([
  "accepted", "searching_partner", "partner_assigned", "contacted",
  "waiting_feedback", "interested", "project_request",
]);
