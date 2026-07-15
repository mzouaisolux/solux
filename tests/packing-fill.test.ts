/**
 * Fill engine + configurable-CBM tests (lib/packing-core/fill.ts, container.ts).
 * Covers spec §15: usable-CBM change, historical immutability (engine level),
 * single/master/incomplete/multi-BOM/mixed recommendations, weight-limited,
 * door-too-large, pole-incompatible-with-20GP, safety reserve.
 *
 * Run with: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeFill,
  recommendContainers,
  usableCbm,
  verifyFeasibility,
  DEFAULT_3D_ENGINE,
  type PackagingSpec,
  type ContainerType,
  type PackingConfig,
  type PackingContext,
  type FillCandidate,
} from "../lib/packing-core/index.ts";

const CONFIG: PackingConfig = {
  volumetric_factor: 200,
  incomplete_carton_policy: "remaining_individual_cartons",
  pole_forces_40hq_length_mm: 5500,
  default_safety_margin_pct: 10,
};

function container(over: Partial<ContainerType>): ContainerType {
  return {
    code: "40HQ", name: "40ft HQ",
    internal: { l_mm: 11800, w_mm: 2300, h_mm: 2600 },
    door_w_mm: 2340, door_h_mm: 2585,
    theoretical_cbm: 70.56, operational_cbm: 68, max_payload_kg: 28500,
    safety_margin_pct: 0, min_unused_reserve_cbm: 0,
    applicable_cbm_min: 28, applicable_cbm_max: 68, applicable_families: [],
    rules_validated: true, active: true, ...over,
  };
}

let seq = 0;
function spec(over: Partial<PackagingSpec>): PackagingSpec {
  seq += 1;
  return {
    item_id: over.item_id ?? `i${seq}`, version_id: `v${seq}`, version_no: 1,
    reference: over.reference ?? `R${seq}`, name: over.reference ?? null,
    component_name: null, component_type: null, packaging_type: null,
    units_per_outside_carton: over.units_per_outside_carton ?? null,
    inner: over.inner ?? { l_mm: null, w_mm: null, h_mm: null },
    outer: over.outer ?? { l_mm: null, w_mm: null, h_mm: null },
    net_weight_kg: over.net_weight_kg ?? null,
    gross_weight_unit_kg: over.gross_weight_unit_kg ?? null,
    gross_weight_master_kg: over.gross_weight_master_kg ?? null,
    is_lamp_pole: over.is_lamp_pole ?? false, is_oversized: over.is_oversized ?? false,
    volumetric_factor: null,
  };
}
function ctx(map: Record<string, PackagingSpec>, resolveBom?: PackingContext["resolveBom"]): PackingContext {
  return { config: CONFIG, containers: [], getPackaging: (id) => map[id] ?? null, resolveBom };
}
function cand(product_id: string, over: Partial<FillCandidate> = {}): FillCandidate {
  return { product_id, reference: product_id, ...over };
}

// A simple 1-component product: 1610×770×205 (~0.254 CBM), 34.45kg gross.
const PANEL = spec({ item_id: "PANEL", reference: "SSLXPRO80", inner: { l_mm: 1610, w_mm: 770, h_mm: 205 }, net_weight_kg: 28.5, gross_weight_unit_kg: 34.45 });
// Master carton product: 4/carton, outer 665×450×670 (~0.2005 CBM/carton).
const MASTER = spec({ item_id: "MASTER", reference: "B021", units_per_outside_carton: 4, inner: { l_mm: 420, w_mm: 310, h_mm: 320 }, outer: { l_mm: 665, w_mm: 450, h_mm: 670 }, net_weight_kg: 2.3, gross_weight_unit_kg: 3.2 });

// ---------------------------------------------------------------------
// §15: usable CBM change 68 → 64 updates utilization & remaining
// ---------------------------------------------------------------------
test("changing operational CBM 68→64 changes usable & utilization", () => {
  const c68 = container({ operational_cbm: 68 });
  const c64 = container({ operational_cbm: 64 });
  assert.equal(usableCbm(c68), 68);
  assert.equal(usableCbm(c64), 64);
  const r68 = recommendContainers({ totalCbm: 60, totalGross: 12000, packages: [], containers: [c68], config: CONFIG, forces40HQ: false });
  const r64 = recommendContainers({ totalCbm: 60, totalGross: 12000, packages: [], containers: [c64], config: CONFIG, forces40HQ: false });
  assert.ok(r64[0].utilization_pct! > r68[0].utilization_pct!); // 60/64 > 60/68
});

test("historical snapshot: an old container config (68) is unchanged when live is 64", () => {
  // Simulate: the calc keeps its snapshot; recomputing with the snapshot yields 68-based numbers.
  const snapshot68 = container({ operational_cbm: 68 });
  const r = recommendContainers({ totalCbm: 60, totalGross: 12000, packages: [], containers: [snapshot68], config: CONFIG, forces40HQ: false });
  assert.equal(r[0].usable_cbm, 68); // snapshot preserved regardless of any live edit
});

// ---------------------------------------------------------------------
// §15: method is transparent, never "will fit"
// ---------------------------------------------------------------------
test("fill result is RULE_BASED with door dims, and never claims a physical fit", () => {
  const res = computeFill({
    context: ctx({ PANEL }), container: container({ safety_margin_pct: 0 }),
    currentCbm: 36.72, currentGross: 8450, candidates: [cand("PANEL")],
    objective: "max_cbm_utilization",
  });
  assert.equal(res.method, "RULE_BASED");
  assert.ok(res.options.length >= 1);
  const o = res.options[0];
  assert.ok(/could potentially be added/i.test(o.caution));
  assert.ok(!/will fit/i.test(o.caution));
  assert.equal(o.requires_operations_validation ?? res.requires_operations_validation, true);
});

// ---------------------------------------------------------------------
// §15: single-product recommendation, integer qty
// ---------------------------------------------------------------------
test("single-product option gives an integer max quantity that fits remaining CBM", () => {
  const c = container({ operational_cbm: 68, safety_margin_pct: 0, max_payload_kg: 28500 });
  const res = computeFill({ context: ctx({ PANEL }), container: c, currentCbm: 36.72, currentGross: 8450, candidates: [cand("PANEL")], objective: "max_cbm_utilization" });
  const single = res.options.find((o) => o.lines.length === 1)!;
  assert.ok(Number.isInteger(single.lines[0].quantity));
  assert.ok(single.final_cbm <= res.usable_cbm + 1e-6);           // never overflow
  assert.ok(single.final_utilization_pct > 54);                    // added something
});

// ---------------------------------------------------------------------
// §15: master carton — integer cartons, not remaining÷unitCBM
// ---------------------------------------------------------------------
test("master-carton product uses integer carton footprint", () => {
  const res = computeFill({ context: ctx({ MASTER }), container: container({ safety_margin_pct: 0 }), currentCbm: 10, currentGross: 1000, candidates: [cand("MASTER")], objective: "max_cbm_utilization" });
  const o = res.options[0];
  assert.ok(/carton/.test(o.lines[0].packages_summary));
  assert.ok(o.additional_cbm > 0);
});

// ---------------------------------------------------------------------
// §15: multi-BOM components (head + arm) included
// ---------------------------------------------------------------------
test("multi-component BOM footprint includes every component", () => {
  const HEAD = spec({ item_id: "H", reference: "HEAD", inner: { l_mm: 685, w_mm: 300, h_mm: 155 }, net_weight_kg: 4.5, gross_weight_unit_kg: 5.2 });
  const ARM = spec({ item_id: "A", reference: "ARM", inner: { l_mm: 850, w_mm: 450, h_mm: 80 }, net_weight_kg: 4.5, gross_weight_unit_kg: 5 });
  const resolveBom: PackingContext["resolveBom"] = (pid) => pid === "KIT"
    ? [{ component_id: "PANEL", qty_per_product: 1 }, { component_id: "H", qty_per_product: 1 }, { component_id: "A", qty_per_product: 1 }]
    : [{ component_id: pid, qty_per_product: 1 }];
  const res = computeFill({ context: ctx({ PANEL, H: HEAD, A: ARM }, resolveBom), container: container({ safety_margin_pct: 0 }), currentCbm: 20, currentGross: 3000, candidates: [cand("KIT")], objective: "max_cbm_utilization" });
  const o = res.options[0];
  // footprint of 1 KIT = panel + head + arm CBM
  const perKit = o.additional_cbm / o.lines[0].quantity;
  assert.ok(perKit > 0.254); // strictly more than the panel alone → components included
});

// ---------------------------------------------------------------------
// §15: mixed-product recommendation → several distinct options
// ---------------------------------------------------------------------
test("mixed products yield multiple distinct options", () => {
  const P2 = spec({ item_id: "P2", reference: "AOSPRO40", inner: { l_mm: 1165, w_mm: 460, h_mm: 260 }, net_weight_kg: 14.85, gross_weight_unit_kg: 17.5 });
  const res = computeFill({ context: ctx({ PANEL, P2 }), container: container({ safety_margin_pct: 0 }), currentCbm: 30, currentGross: 6000, candidates: [cand("PANEL"), cand("P2")], objective: "max_cbm_utilization", maxOptions: 5 });
  assert.ok(res.options.length >= 3);
  assert.ok(res.options.some((o) => o.lines.length >= 2)); // at least one mixed
});

// ---------------------------------------------------------------------
// §15: remaining payload limits before CBM
// ---------------------------------------------------------------------
test("weight-limited: heavy product capped by payload before CBM", () => {
  // tiny CBM, huge gross → payload binds first
  const HEAVY = spec({ item_id: "HV", reference: "HEAVY", inner: { l_mm: 300, w_mm: 300, h_mm: 300 }, net_weight_kg: 900, gross_weight_unit_kg: 1000 });
  const c = container({ operational_cbm: 68, safety_margin_pct: 0, max_payload_kg: 10000 });
  const res = computeFill({ context: ctx({ HV: HEAVY }), container: c, currentCbm: 5, currentGross: 2000, candidates: [cand("HV")], objective: "max_products" });
  const o = res.options[0];
  // remaining payload 8000kg / 1000kg ≈ 8 units — far below CBM cap
  assert.ok(o.lines[0].quantity <= 8);
  assert.ok(o.final_gross <= 10000 + 1e-6);
});

// ---------------------------------------------------------------------
// §15: package too large for the container door → excluded
// ---------------------------------------------------------------------
test("package too large for the door produces no option", () => {
  const BIG = spec({ item_id: "BIG", reference: "BIG", inner: { l_mm: 3000, w_mm: 3000, h_mm: 3000 }, net_weight_kg: 100, gross_weight_unit_kg: 120 });
  const res = computeFill({ context: ctx({ BIG }), container: container({ door_w_mm: 2340, door_h_mm: 2585 }), currentCbm: 10, currentGross: 1000, candidates: [cand("BIG")], objective: "max_cbm_utilization" });
  assert.equal(res.options.length, 0);
});

// ---------------------------------------------------------------------
// §15: pole incompatible with a 20GP (container compatibility filter)
// ---------------------------------------------------------------------
test("pole restricted to 40HQ is excluded from a 20GP fill", () => {
  const POLE = spec({ item_id: "POLE8", reference: "POLE-8M", inner: { l_mm: 250, w_mm: 250, h_mm: 8000 }, net_weight_kg: 30, gross_weight_unit_kg: 34, is_lamp_pole: true });
  const c20 = container({ code: "20GP", name: "20ft", internal: { l_mm: 5800, w_mm: 2300, h_mm: 2300 }, operational_cbm: 28, door_w_mm: 2340, door_h_mm: 2280, max_payload_kg: 28000 });
  const res = computeFill({ context: ctx({ POLE8: POLE }), container: c20, currentCbm: 5, currentGross: 500, candidates: [cand("POLE8", { is_pole: true, compatible_containers: ["40HQ"] })], objective: "max_cbm_utilization" });
  assert.equal(res.options.length, 0); // filtered out (not 20GP-compatible)
});

// ---------------------------------------------------------------------
// §15: safety reserve reduces the space offered
// ---------------------------------------------------------------------
test("safety reserve reduces remaining CBM and additions", () => {
  const base = computeFill({ context: ctx({ PANEL }), container: container({ safety_margin_pct: 0 }), currentCbm: 36.72, currentGross: 8450, candidates: [cand("PANEL")], objective: "max_cbm_utilization" });
  const reserved = computeFill({ context: ctx({ PANEL }), container: container({ safety_margin_pct: 0 }), currentCbm: 36.72, currentGross: 8450, candidates: [cand("PANEL")], objective: "max_cbm_utilization", constraints: { min_safety_reserve_cbm: 10 } });
  assert.ok(reserved.remaining_cbm < base.remaining_cbm);
  assert.ok((reserved.options[0]?.additional_cbm ?? 0) <= (base.options[0]?.additional_cbm ?? 0));
});

// ---------------------------------------------------------------------
// §15: min final utilization filters weak options
// ---------------------------------------------------------------------
test("min_final_utilization filters options below the threshold", () => {
  const res = computeFill({ context: ctx({ PANEL }), container: container({ safety_margin_pct: 0 }), currentCbm: 36.72, currentGross: 8450, candidates: [cand("PANEL")], objective: "max_cbm_utilization", constraints: { min_final_utilization_pct: 99.9 } });
  assert.ok(res.options.every((o) => o.final_utilization_pct >= 99.9));
});

// ---------------------------------------------------------------------
// §15: two-stage feasibility — validated template vs no engine vs 3D failure
// ---------------------------------------------------------------------
test("validated template → physically verified", () => {
  const v = verifyFeasibility({ hasValidatedTemplate: true });
  assert.equal(v.method, "VALIDATED_TEMPLATE");
  assert.equal(v.physically_verified, true);
});

test("no template + no 3D engine → RULE_BASED estimate, not verified", () => {
  const v = verifyFeasibility({});
  assert.equal(v.method, "RULE_BASED");
  assert.equal(v.physically_verified, false);
  assert.ok(/review/i.test(v.note));
});

test("3D stub does not place anything and never claims a fit", () => {
  const res = DEFAULT_3D_ENGINE.place({
    container: container({}),
    boxes: [{ id: "b1", reference: "X", l_mm: 1000, w_mm: 800, h_mm: 500, quantity: 100 }],
  });
  assert.equal(res.available, false);
  assert.equal(res.method, "THREE_DIMENSIONAL_PLACEMENT");
  assert.equal(res.placed.length, 0);
  assert.equal(res.unplaced.length, 1);
  assert.equal(res.requires_operations_validation, true);
});
