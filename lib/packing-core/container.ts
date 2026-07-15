// =====================================================================
// lib/packing-core/container.ts — VOLUME-BASED container recommendation.
//
// IMPORTANT (spec §13/§28): this is a volume + weight estimate only. It is
// NEVER presented as a proven physical loading. Every recommendation carries
// method:'VOLUME_AND_WEIGHT' + a caution, and the result always requires
// Operations review. Only fill.ts (RULE_BASED), a validated template, or a
// real 3D engine may claim more — each with its own explicit CalcMethod.
// =====================================================================
import type {
  ContainerType,
  PackingConfig,
  ContainerRecommendation,
  PackageOut,
} from "./types.ts";
import { r, longestAxis, fitsThroughDoor } from "./cbm.ts";

interface RecoArgs {
  totalCbm: number;
  totalGross: number;
  packages: PackageOut[];
  containers: ContainerType[];
  config: PackingConfig;
  forces40HQ: boolean;
}

/**
 * Usable CBM = operational × (1 − safety margin%) − minimum unused reserve.
 * This is the "current calculation usable CBM" (distinct from theoretical and
 * from the configured operational usable CBM).
 */
export function usableCbm(c: ContainerType): number | null {
  if (c.operational_cbm == null) return null;
  const afterMargin = c.operational_cbm * (1 - (c.safety_margin_pct ?? 0) / 100);
  const reserve = c.min_unused_reserve_cbm ?? 0;
  return r(Math.max(afterMargin - reserve, 0), 3);
}

/**
 * Build a ranked list of container solutions. The top pick is `recommended`.
 * Poles longer than the threshold force 40HQ (other options still listed as
 * alternatives, warned). 40GP (rules_validated=false) is offered but warned.
 */
export function recommendContainers(args: RecoArgs): ContainerRecommendation[] {
  const { totalCbm, totalGross, packages, containers, config, forces40HQ } = args;
  const longestPkg = packages
    .map((p) => longestAxis(p.dimensions_mm))
    .filter((x): x is number => x != null);
  const longestMm = longestPkg.length ? Math.max(...longestPkg) : null;
  const hasPole = packages.some((p) => p.is_pole);

  const active = containers.filter((c) => c.active);
  const recos: ContainerRecommendation[] = [];

  for (const c of active) {
    const usable = usableCbm(c);
    const assumptions: string[] = [];
    const warnings: string[] = [];

    // Count needed by VOLUME and by WEIGHT; take the larger.
    let count: number;
    if (c.code === "LCL") {
      count = 1; // LCL = loose consolidation, not "N containers"
      assumptions.push("LCL is a consolidation option, not a full container — palletized per Word §III.");
    } else if (usable == null) {
      // No operational volume configured (e.g. 40GP) → cannot size by volume.
      count = 1;
      warnings.push(`${c.code}: operational usable CBM not configured — cannot size by volume.`);
    } else {
      const byVolume = totalCbm > 0 ? Math.ceil(totalCbm / usable) : 0;
      const byWeight = c.max_payload_kg && totalGross > 0
        ? Math.ceil(totalGross / c.max_payload_kg)
        : 0;
      count = Math.max(byVolume, byWeight, totalCbm > 0 ? 1 : 0);
      if (byWeight > byVolume) warnings.push(`${c.code}: weight-limited (payload ${c.max_payload_kg}kg) — needs ${byWeight} by weight vs ${byVolume} by volume.`);
    }

    if (!c.rules_validated) {
      warnings.push(`${c.code}: loading rules NOT validated — configure & confirm before use.`);
    }
    // Longest package vs container internal length.
    if (longestMm != null && c.internal.l_mm != null && longestMm > c.internal.l_mm) {
      warnings.push(`Longest package ${longestMm}mm exceeds ${c.code} internal length ${c.internal.l_mm}mm.`);
    }
    // Door opening check (inert until door dims are configured).
    if (c.code !== "LCL" && (c.door_w_mm != null && c.door_h_mm != null)) {
      const stuck = packages.find((p) => !fitsThroughDoor(p.dimensions_mm, c.door_w_mm, c.door_h_mm));
      if (stuck) warnings.push(`A package (${stuck.reference ?? stuck.component_id}) may not pass the ${c.code} door (${c.door_w_mm}×${c.door_h_mm}mm).`);
    }
    if (hasPole && c.code === "20GP" && forces40HQ) {
      warnings.push(`Poles exceed ${config.pole_forces_40hq_length_mm}mm — 20GP not allowed (Word §II).`);
    }

    const capacityForCount = usable != null ? usable * count : null;
    const utilization = capacityForCount && capacityForCount > 0
      ? r((totalCbm / capacityForCount) * 100, 1)
      : null;
    const unused = capacityForCount != null ? r(capacityForCount - totalCbm, 3) : null;
    const weightCap = c.max_payload_kg ? c.max_payload_kg * count : null;
    const weightUtil = weightCap && weightCap > 0 ? r((totalGross / weightCap) * 100, 1) : null;
    const remainingPayload = weightCap != null ? r(weightCap - totalGross, 1) : null;

    // The current engine is a VOLUME + WEIGHT estimate — never a physical fit.
    assumptions.push("Volume & weight estimate — physical placement NOT verified; Operations review required.");
    if (c.safety_margin_pct) assumptions.push(`${c.safety_margin_pct}% safety margin applied to operational CBM.`);
    if (c.min_unused_reserve_cbm) assumptions.push(`${c.min_unused_reserve_cbm} CBM minimum unused reserve kept free.`);

    // Confidence: lower it when there are fit warnings or unconfigured volume.
    const confidence: "low" | "medium" =
      warnings.length || usable == null ? "low" : "medium";

    recos.push({
      container_code: c.code,
      container_name: c.name,
      count,
      method: "VOLUME_AND_WEIGHT",
      confidence,
      rules_validated: c.rules_validated,
      operational_cbm: c.operational_cbm,
      usable_cbm: usable,
      safety_margin_pct: c.safety_margin_pct ?? 0,
      used_cbm: totalCbm,
      utilization_pct: utilization,
      unused_cbm: unused,
      max_payload_kg: c.max_payload_kg,
      used_weight: totalGross,
      remaining_payload_kg: remainingPayload,
      weight_utilization_pct: weightUtil,
      recommended: false,
      warnings,
      assumptions,
    });
  }

  // ---- Pick the recommended option -------------------------------------
  const pick = chooseRecommended(recos, { totalCbm, forces40HQ });
  for (const rc of recos) rc.recommended = rc === pick;

  // Sort: recommended first, then fewer containers, then higher utilization.
  recos.sort((a, b) => {
    if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
    if (a.count !== b.count) return a.count - b.count;
    return (b.utilization_pct ?? 0) - (a.utilization_pct ?? 0);
  });
  return recos;
}

function chooseRecommended(
  recos: ContainerRecommendation[],
  ctx: { totalCbm: number; forces40HQ: boolean }
): ContainerRecommendation | null {
  if (!recos.length || ctx.totalCbm <= 0) return null;

  // Rule 1: long poles force 40HQ.
  if (ctx.forces40HQ) {
    const hq = recos.find((rc) => rc.container_code === "40HQ");
    if (hq) return hq;
  }

  // Rule 2: small loads → LCL when within its applicable range.
  const lcl = recos.find((rc) => rc.container_code === "LCL");
  if (lcl && ctx.totalCbm <= 15) return lcl;

  // Rule 3: among FULL containers with validated rules, pick the one that
  // fits in the fewest units with the best utilization. Exclude LCL and
  // non-validated (40GP) from the automatic pick — they stay alternatives.
  const candidates = recos.filter(
    (rc) => rc.container_code !== "LCL" && rc.rules_validated && rc.usable_cbm != null
  );
  if (!candidates.length) return recos[0];

  candidates.sort((a, b) => {
    if (a.count !== b.count) return a.count - b.count;
    return (b.utilization_pct ?? 0) - (a.utilization_pct ?? 0);
  });
  return candidates[0];
}
