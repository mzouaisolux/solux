import { createClient } from "@/lib/supabase/server";

/**
 * Lightweight, RLS-scoped count helpers for the top-nav action badges.
 * Each soft-fails to 0 so the nav never crashes on a missing table / migration
 * or a DB error — mirrors lib/project-queue.getProjectActions.
 */

/**
 * Orders needing attention (Orders badge): explicitly delayed, OR past their
 * production deadline and still in motion (not shipped / delivered / cancelled /
 * completed). RLS scopes the rows to what the current user can see.
 */
export async function getOrdersBadgeCount(
  supabase: ReturnType<typeof createClient>
): Promise<number> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { count, error } = await supabase
      .from("production_orders")
      .select("id", { count: "exact", head: true })
      .or(
        `status.eq.production_delayed,and(current_production_deadline.lt.${today},status.not.in.(shipped,delivered,cancelled,production_completed))`
      );
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Task lists awaiting action (Task Lists badge): under validation (waiting for
 * the production team) or bounced for revision (waiting for sales). RLS scopes
 * to the user's relevant rows.
 */
export async function getTaskListsBadgeCount(
  supabase: ReturnType<typeof createClient>
): Promise<number> {
  try {
    const { count, error } = await supabase
      .from("production_task_lists")
      .select("id", { count: "exact", head: true })
      .in("status", ["under_validation", "needs_revision"]);
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}
