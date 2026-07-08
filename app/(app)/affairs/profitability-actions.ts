"use server";

/**
 * Lazy data endpoints for the Profitability drawer (m152 widget).
 *
 * SECURITY: server actions are public POST endpoints — anyone authenticated
 * can invoke them directly, bypassing the page. So the gate here is the REAL
 * role (`hasCapability`, not the View-As effective role): without
 * `project.view_profitability` the action returns null and no margin or cost
 * ever reaches the browser (m142 rule). The page-side widgets are themselves
 * fed by the capability-gated batch loader; this action only serves the
 * drawer's on-demand breakdown.
 */

import { createClient } from "@/lib/supabase/server";
import { hasCapability } from "@/lib/permissions";
import {
  loadAffairProfitability,
  loadAffairWaterfall,
  type WaterfallPayload,
} from "@/lib/profitability-server";
import type { ProfitabilityResult } from "@/lib/profitability";

export async function getProfitabilityBreakdown(
  affairId: string
): Promise<ProfitabilityResult | null> {
  if (!affairId) return null;
  // REAL role — a super_admin previewing "as sales" still passes (they hold
  // the data anyway); a real sales caller gets null even by direct POST.
  if (!(await hasCapability("project.view_profitability"))) return null;
  const supabase = createClient();
  const map = await loadAffairProfitability(supabase, [affairId]);
  return map.get(affairId) ?? null;
}

/**
 * "Why did the margin change?" + full cost-revision AUDIT history — lazy,
 * drawer-only, REAL-role gated.
 */
export async function getProfitabilityWaterfall(
  affairId: string
): Promise<WaterfallPayload | null> {
  if (!affairId) return null;
  if (!(await hasCapability("project.view_profitability"))) return null;
  const supabase = createClient();
  return loadAffairWaterfall(supabase, affairId);
}
