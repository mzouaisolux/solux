"use server";
// =====================================================================
// /packing/calculator server actions — run the engine, save a calculation.
// Defense-in-depth: every action re-checks super-admin (RLS also enforces).
// =====================================================================
import { requireSuperAdmin, getCurrentUserRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { buildPackingContext, getContainers, getFillCandidates } from "@/lib/packing-server";
import {
  calculatePackingList,
  computeFill,
  type PackingInput,
  type PackingResult,
  type FillObjective,
  type FillConstraints,
  type FillResult,
  type FillCandidate,
} from "@/lib/packing-core/index.ts";

export async function runCalculation(
  items: PackingInput["items"]
): Promise<PackingResult> {
  await requireSuperAdmin();
  const ctx = await buildPackingContext();
  return calculatePackingList(
    { source_type: "manual", source_id: null, items },
    ctx
  );
}

/**
 * "Which products could still be added?" — RULE_BASED estimate (fill.ts).
 * Builds the candidate catalogue from the DB per the requested scope, then
 * runs the pure fill engine. Never claims a physical fit.
 */
export async function runFill(input: {
  container_code: string;
  currentCbm: number;
  currentGross: number;
  objective: FillObjective;
  constraints?: FillConstraints;
  scope?: "all" | "same_family" | "in_request" | "selected";
  current_item_ids?: string[];
  families?: string[];
}): Promise<FillResult> {
  await requireSuperAdmin();
  const sb = createClient();
  const ctx = await buildPackingContext();
  const container = ctx.containers.find((c) => c.code === input.container_code);
  if (!container) throw new Error(`Unknown container ${input.container_code}`);

  const currentIds = new Set(input.current_item_ids ?? []);
  let candidates: FillCandidate[] = (await getFillCandidates(sb)).map((c) => ({
    ...c,
    in_current_request: currentIds.has(c.product_id),
  }));

  if (input.scope === "in_request") candidates = candidates.filter((c) => c.in_current_request);
  if (input.scope === "same_family" && input.families?.length)
    candidates = candidates.filter((c) => c.family && input.families!.includes(c.family));

  return computeFill({
    context: ctx,
    container,
    currentCbm: input.currentCbm,
    currentGross: input.currentGross,
    candidates,
    objective: input.objective,
    constraints: input.constraints,
    maxOptions: 5,
  });
}

/**
 * Edit a container's capacity config with a FULL field-level audit trail.
 * Historical calculations are unaffected (they snapshot container_config_used).
 */
export async function updateContainerConfig(
  code: string,
  patch: Record<string, unknown>,
  reason: string,
  effectiveDate?: string
): Promise<void> {
  await requireSuperAdmin();
  const { userId } = await getCurrentUserRole();
  const sb = createClient();
  const { data: before } = await sb.from("packing_container_type").select("*").eq("code", code).maybeSingle();
  if (!before) throw new Error(`Unknown container ${code}`);

  const EDITABLE = [
    "name", "internal_l_mm", "internal_w_mm", "internal_h_mm", "door_w_mm", "door_h_mm",
    "theoretical_cbm", "operational_cbm", "max_payload_kg", "safety_margin_pct",
    "min_unused_reserve_cbm", "applicable_cbm_min", "applicable_cbm_max",
    "active", "notes", "validation_status", "effective_date",
  ];
  const changes: Record<string, unknown> = {};
  const audit: any[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!EDITABLE.includes(k)) continue;
    if (String((before as any)[k] ?? "") === String(v ?? "")) continue;
    changes[k] = v;
    audit.push({
      container_id: (before as any).id, code, field: k,
      old_value: (before as any)[k] == null ? null : String((before as any)[k]),
      new_value: v == null ? null : String(v),
      changed_by: userId, reason, effective_date: effectiveDate ?? null,
    });
  }
  if (!Object.keys(changes).length) return;

  changes.version_no = ((before as any).version_no ?? 1) + 1;
  changes.updated_at = new Date().toISOString();
  const { error } = await sb.from("packing_container_type").update(changes).eq("code", code);
  if (error) throw new Error(`Update failed: ${error.message}`);
  if (audit.length) await sb.from("packing_container_type_change").insert(audit);
}

/**
 * Persist an auto-calculated result as a packing_calculation with its
 * packaging-version SNAPSHOT (so it never changes when master data changes).
 * Status starts 'auto_calculated' — Operations review required.
 */
export async function saveCalculation(input: {
  meta: { customer?: string; project?: string; destination?: string; incoterm?: string };
  items: PackingInput["items"];
}): Promise<{ id: string; reference: string }> {
  await requireSuperAdmin();
  const { userId } = await getCurrentUserRole();
  const ctx = await buildPackingContext();
  const result = calculatePackingList(
    { source_type: "manual", source_id: null, items: input.items },
    ctx
  );

  const sb = createClient();
  const { data: seq } = await sb
    .from("packing_calculation")
    .select("id", { count: "exact", head: true });
  const reference = `PLC-${String((seq as any)?.length ?? Date.now()).slice(-6)}`;

  const { data, error } = await sb
    .from("packing_calculation")
    .insert({
      reference,
      source_type: "manual",
      customer: input.meta.customer || null,
      project: input.meta.project || null,
      destination: input.meta.destination || null,
      incoterm: input.meta.incoterm || null,
      status: "auto_calculated",
      auto_result: result as any,
      total_packages: result.total_packages,
      total_cbm: result.total_cbm,
      total_net_weight: result.net_weight,
      total_gross_weight: result.gross_weight,
      recommended: result.container_recommendations.find((r) => r.recommended) ?? null,
      warnings: result.warnings,
      packaging_versions_used: result.packaging_versions_used as any,
      // Snapshot the container config used → editing usable CBM later never
      // changes this historical calculation (m174 / spec §2/§14.2).
      container_config_used: ctx.containers as any,
      created_by: userId,
    })
    .select("id, reference")
    .single();

  if (error) throw new Error(`Save failed: ${error.message}`);

  // Persist input lines (traceability).
  await sb.from("packing_calculation_line").insert(
    input.items.map((it, idx) => ({
      calculation_id: data!.id,
      product_item_id: it.product_id,
      quantity: it.quantity,
      options: (it.options ?? {}) as any,
      line_order: idx,
    }))
  );

  return { id: data!.id, reference: data!.reference };
}
