/**
 * Project Requests dashboard helpers — pure, import-free (so it stays
 * node-test-loadable; status strings are kept literal rather than importing
 * the ProjectRequestStatus union).
 *
 * Counts the RLS-scoped project rows the caller fetched into the buckets each
 * role's dashboard shows, plus a bucket → status(es) map used for deep-link
 * filters on the list below the dashboard.
 */

export type ProjectRow = {
  status: string;
  owner_id?: string | null;
  archived_at?: string | null;
};

export type ProjectSummary = {
  /** Active (non-archived) counts by status, across everything visible. */
  byStatus: Record<string, number>;
  /** Active counts by status for rows owned by `myUserId`. */
  mineByStatus: Record<string, number>;
  /** Total active visible. */
  total: number;
};

export function summarizeProjects(rows: ProjectRow[], myUserId: string | null): ProjectSummary {
  const byStatus: Record<string, number> = {};
  const mineByStatus: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    if (r.archived_at) continue;
    total++;
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    if (myUserId && r.owner_id === myUserId) {
      mineByStatus[r.status] = (mineByStatus[r.status] ?? 0) + 1;
    }
  }
  return { byStatus, mineByStatus, total };
}

/** Bucket key → the status(es) it represents (for ?status= deep links). */
export const BUCKET_STATUSES: Record<string, string[]> = {
  drafts: ["draft"],
  waiting_approval: ["waiting_director_approval"],
  waiting_costing: ["waiting_factory_cost", "waiting_logistics"],
  waiting_factory_cost: ["waiting_factory_cost"],
  waiting_logistics: ["waiting_logistics"],
  ready_for_pricing: ["ready_for_pricing"],
  priced: ["priced"],
  quotation_ready: ["quotation_generated"],
  won: ["won"],
  lost: ["lost"],
};

export function countBuckets(byStatus: Record<string, number>, statuses: string[]): number {
  return statuses.reduce((sum, s) => sum + (byStatus[s] ?? 0), 0);
}

// ===========================================================================
// "Action required" — the role-scoped items needing the current user's action.
// Drives the dashboard Action Required section AND the Projects menu badge,
// from a single source. Pure (assembly only); counts are fetched in
// lib/project-queue.getProjectActions and passed in.
// ===========================================================================

export type ProjectActionItem = {
  key: string;
  label: string;
  count: number;
  href: string;
  tone: "amber" | "violet" | "indigo" | "teal" | "emerald" | "neutral";
};

export type ProjectActionCaps = {
  canApprove: boolean;
  canCost: boolean;
  canLogistics: boolean;
  canCreate: boolean;
};

export type ProjectActionCounts = {
  waitingApproval: number;
  readyForPricing: number;
  costPending: number;
  packPending: number;
  freightPending: number;
  minePriced: number;
  mineDraft: number;
};

export function assembleProjectActions(caps: ProjectActionCaps, c: ProjectActionCounts): ProjectActionItem[] {
  const items: ProjectActionItem[] = [];
  if (caps.canApprove) {
    if (c.waitingApproval > 0)
      items.push({ key: "approve", label: "Waiting your review", count: c.waitingApproval, href: "/projects/approvals", tone: "amber" });
    if (c.readyForPricing > 0)
      items.push({ key: "price", label: "Ready for pricing", count: c.readyForPricing, href: "/projects?status=ready_for_pricing", tone: "violet" });
  }
  if (caps.canCost || caps.canLogistics) {
    if (c.costPending > 0)
      items.push({ key: "cost", label: "Factory costs to enter", count: c.costPending, href: "/projects/cost-requests", tone: "indigo" });
    if (c.packPending > 0)
      items.push({ key: "pack", label: "Packing to enter", count: c.packPending, href: "/projects/logistics-requests", tone: "teal" });
    if (c.freightPending > 0)
      items.push({ key: "freight", label: "Freight to enter", count: c.freightPending, href: "/projects/logistics-requests", tone: "teal" });
  }
  if (caps.canCreate) {
    if (c.minePriced > 0)
      items.push({ key: "quote", label: "Priced — generate quotation", count: c.minePriced, href: "/projects?mine=1&status=priced", tone: "emerald" });
    if (c.mineDraft > 0)
      items.push({ key: "draft", label: "Drafts — submit / clarify", count: c.mineDraft, href: "/projects?mine=1&status=drafts", tone: "neutral" });
  }
  return items;
}

export function projectActionTotal(items: ProjectActionItem[]): number {
  return items.reduce((sum, i) => sum + i.count, 0);
}

/**
 * Recompute a project's waiting/ready phase from which child requests were
 * REQUESTED vs COMPLETED. Returns the status it SHOULD be, or null if the
 * project isn't in a waiting/ready phase (don't touch draft/approval/priced).
 *
 * Fixes the stale-status bug: once factory cost is submitted but packing or
 * freight is still pending, the project advances waiting_factory_cost →
 * waiting_logistics (instead of falsely staying "Waiting Factory Cost"); when
 * every requested input is in, it reaches ready_for_pricing.
 */
export function computeWaitingStatus(args: {
  reqCost: boolean;
  reqPack: boolean;
  reqFreight: boolean;
  costDone: boolean;
  packDone: boolean;
  freightDone: boolean;
  current: string;
}): string | null {
  if (!["waiting_factory_cost", "waiting_logistics", "ready_for_pricing"].includes(args.current)) {
    return null;
  }
  const costOk = !args.reqCost || args.costDone;
  const packOk = !args.reqPack || args.packDone;
  const freightOk = !args.reqFreight || args.freightDone;
  if (!costOk) return "waiting_factory_cost";
  if (!packOk || !freightOk) return "waiting_logistics";
  return "ready_for_pricing";
}
