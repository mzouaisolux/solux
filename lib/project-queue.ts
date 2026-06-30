/**
 * "Action required" project items for the current user — server-only.
 *
 * The single source for both the dashboard Action Required section and the
 * Projects menu badge: how many items need THIS user's action, scoped by
 * capability and RLS. Cheap (one project_requests projection + up to three
 * head-counts) and soft-fails to [] so the global nav never breaks.
 */

import type { createClient } from "@/lib/supabase/server";
import { hasUiCapability } from "@/lib/permissions";
import { assembleProjectActions, type ProjectActionItem } from "@/lib/project-dashboard";

export async function getProjectActions(
  supabase: ReturnType<typeof createClient>,
  userId: string | null
): Promise<ProjectActionItem[]> {
  try {
    const [canApprove, canCost, canLogistics, canCreate] = await Promise.all([
      hasUiCapability("project.approve"),
      hasUiCapability("project.enter_cost"),
      hasUiCapability("project.enter_logistics"),
      hasUiCapability("project.create"),
    ]);
    if (!canApprove && !canCost && !canLogistics && !canCreate) return [];

    const needsChild = canCost || canLogistics;
    const head = (table: string) =>
      supabase.from(table).select("id", { count: "exact", head: true }).eq("status", "pending");
    const [countsRes, c, pk, fr] = await Promise.all([
      supabase.rpc("project_request_status_counts"),
      needsChild ? head("factory_cost_requests") : Promise.resolve({ count: 0 } as any),
      needsChild ? head("packing_list_requests") : Promise.resolve({ count: 0 } as any),
      needsChild ? head("freight_cost_requests") : Promise.resolve({ count: 0 } as any),
    ]);

    // Status counts from the grouped RPC (m127); fall back to a fetch-all
    // projection if the RPC isn't applied yet.
    const byStatus: Record<string, number> = {};
    const mineByStatus: Record<string, number> = {};
    if (!(countsRes as any).error && (countsRes as any).data) {
      for (const r of (countsRes as any).data as any[]) {
        byStatus[r.status] = Number(r.total) || 0;
        const m = Number(r.mine) || 0;
        if (m) mineByStatus[r.status] = m;
      }
    } else {
      const { data: rows } = await supabase
        .from("project_requests")
        .select("status, owner_id")
        .is("archived_at", null);
      for (const r of (rows ?? []) as any[]) {
        byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
        if (r.owner_id === userId) mineByStatus[r.status] = (mineByStatus[r.status] ?? 0) + 1;
      }
    }
    const cnt = (st: string) => byStatus[st] ?? 0;
    const mine = (st: string) => mineByStatus[st] ?? 0;

    return assembleProjectActions(
      { canApprove, canCost, canLogistics, canCreate },
      {
        waitingApproval: cnt("waiting_director_approval"),
        readyForPricing: cnt("ready_for_pricing"),
        costPending: (c as any).count ?? 0,
        packPending: (pk as any).count ?? 0,
        freightPending: (fr as any).count ?? 0,
        minePriced: mine("priced"),
        mineDraft: mine("draft"),
      }
    );
  } catch {
    return [];
  }
}
