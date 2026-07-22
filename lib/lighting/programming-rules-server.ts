/**
 * Programming rules + requirement counts — server loaders (m180).
 *
 * Not server ACTIONS: these take a Supabase client and are shared by the
 * task-list page, the release gates and the line-lighting actions. Every
 * function is defensive — pre-m180 (table/column absent) degrades to
 * "no rules / nothing missing" so the app runs unchanged until the
 * migration lands.
 */

import type { createClient } from "@/lib/supabase/server";
import {
  lineLightingStatus,
  normalizeLineLighting,
} from "@/lib/lighting/line-setup";
import {
  normalizeRule,
  resolveProgrammingRequirement,
  ruleSubjectFromLine,
  type ProgrammingRule,
} from "@/lib/lighting/programming-rules";

type Supabase = ReturnType<typeof createClient>;

/** All programming rules, priority-desc. Pre-m180 → []. */
export async function loadRules(supabase: Supabase): Promise<ProgrammingRule[]> {
  const { data, error } = await supabase
    .from("lighting_programming_rules")
    .select(
      "id, outcome, priority, category_id, product_id, sku_pattern, controller, config_match, active, notes"
    )
    .order("priority", { ascending: false });
  if (error || !data) return [];
  return (data as unknown[])
    .map(normalizeRule)
    .filter((r): r is ProgrammingRule => r != null);
}

/**
 * m180 — lines that REQUIRE programming but are missing it or still need
 * review. Feeds evaluateRelease (Final Validation must wait) and the
 * Pre-Validation board. Pre-m180 → 0, never blocks a legacy deployment.
 */
export async function missingRequiredProgrammingFor(
  supabase: Supabase,
  taskListId: string
): Promise<number> {
  const { data: lines, error } = await supabase
    .from("production_task_list_lines")
    .select("id, product_id, category_id, product_sku, config_values, lighting")
    .eq("task_list_id", taskListId);
  if (error || !lines) return 0;
  const rules = await loadRules(supabase);
  let missing = 0;
  for (const raw of lines as any[]) {
    const { requirement } = resolveProgrammingRequirement(ruleSubjectFromLine(raw), rules);
    if (requirement !== "required") continue;
    const status = lineLightingStatus(requirement, normalizeLineLighting(raw.lighting));
    if (status === "missing" || status === "needs_review") missing++;
  }
  return missing;
}
