// =====================================================================
// lib/packing-core/placement3d.ts — 3D placement engine INTERFACE (Phase 3).
//
// IMPORTANT: no real geometric placement exists yet. This file defines the
// contract and a HONEST stub that reports `available: false` — it never
// disguises the CBM/rule estimate as a 3D simulation. Keep this module
// ISOLATED from the fast CBM/rule engine (fill.ts / container.ts) so the
// simple calculation stays fast and reliable.
//
// A future real implementation (bin-packing / guillotine / skyline / ILP)
// replaces DEFAULT_3D_ENGINE and returns method THREE_DIMENSIONAL_PLACEMENT.
// =====================================================================
import type { ContainerType } from "./types.ts";

export interface PlacementBox {
  id: string;
  reference: string | null;
  l_mm: number;
  w_mm: number;
  h_mm: number;
  quantity: number;
  weight_kg?: number;
  allowed_rotations?: Array<"lwh" | "lhw" | "wlh" | "whl" | "hlw" | "hwl">;
  stackable?: boolean;
  max_stack_kg?: number;
  fragile?: boolean;
  is_pole?: boolean;
}

export interface PlacementRequest {
  container: ContainerType; // internal L/W/H + door dims
  boxes: PlacementBox[];
  reserve_accessory_cbm?: number;
}

export interface PlacedBox {
  id: string;
  index: number;
  position_mm: { x: number; y: number; z: number };
  orientation: string;         // e.g. "lwh"
  layer?: number;
}

export interface PlacementResult {
  available: boolean;          // false until a real engine ships
  method: "THREE_DIMENSIONAL_PLACEMENT";
  placed: PlacedBox[];
  unplaced: Array<{ id: string; reason: string }>;
  used_geometric_cbm: number | null;
  utilization_pct: number | null;
  remaining_zones: unknown[];  // geometric free zones (engine-specific)
  algorithm: string;
  compute_ms: number | null;
  notes: string[];
  requires_operations_validation: true;
}

export interface Placement3DEngine {
  readonly available: boolean;
  readonly algorithm: string;
  place(req: PlacementRequest): PlacementResult;
}

/**
 * Honest placeholder. Returns a NOT-IMPLEMENTED result — it does NOT place
 * anything and must never be presented as a physical-fit confirmation.
 * The two-stage recommendation (see fill.ts + verifyFeasibility) treats an
 * unavailable engine as "estimate — Operations review required".
 */
export const DEFAULT_3D_ENGINE: Placement3DEngine = {
  available: false,
  algorithm: "none",
  place(req: PlacementRequest): PlacementResult {
    return {
      available: false,
      method: "THREE_DIMENSIONAL_PLACEMENT",
      placed: [],
      unplaced: req.boxes.map((b) => ({ id: b.id, reason: "3D placement engine not implemented (Phase 3)" })),
      used_geometric_cbm: null,
      utilization_pct: null,
      remaining_zones: [],
      algorithm: "none",
      compute_ms: null,
      notes: [
        "No geometric placement was performed.",
        "This is NOT a physical-fit confirmation — use the volume/rule estimate and Operations review.",
      ],
      requires_operations_validation: true,
    };
  },
};

/**
 * Two-stage feasibility verdict for a proposed load (spec §9):
 *   1) a validated template wins;
 *   2) else a real 3D engine (when available);
 *   3) else an estimate that explicitly requires Operations review.
 * Returns the honest method + whether physical fit was actually verified.
 */
export function verifyFeasibility(opts: {
  hasValidatedTemplate?: boolean;
  engine?: Placement3DEngine;
  request?: PlacementRequest;
}): {
  method: "VALIDATED_TEMPLATE" | "THREE_DIMENSIONAL_PLACEMENT" | "RULE_BASED";
  physically_verified: boolean;
  placement?: PlacementResult;
  note: string;
} {
  if (opts.hasValidatedTemplate) {
    return { method: "VALIDATED_TEMPLATE", physically_verified: true, note: "Matches a previously validated loading configuration." };
  }
  const engine = opts.engine ?? DEFAULT_3D_ENGINE;
  if (engine.available && opts.request) {
    const placement = engine.place(opts.request);
    const ok = placement.available && placement.unplaced.length === 0;
    return {
      method: "THREE_DIMENSIONAL_PLACEMENT",
      physically_verified: ok,
      placement,
      note: ok ? "3D placement simulated — Operations confirmation still required." : "3D placement could not place all packages despite sufficient theoretical CBM.",
    };
  }
  return { method: "RULE_BASED", physically_verified: false, note: "Estimate only — no validated template or 3D engine available; Operations review required." };
}
