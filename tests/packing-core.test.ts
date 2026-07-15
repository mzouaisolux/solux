/**
 * Packing engine tests (lib/packing-core) — the framework-independent core.
 *
 * Covers the computational cases from the spec §27:
 *   simple product · master carton · incomplete master (§11 example) ·
 *   mixed products · lamp head + arm (BOM) · Dual (2 heads) · pole ·
 *   pole > 5.5m (forces 40HQ) · 20GP reco · 40HQ reco · manual override ·
 *   configurable volumetric factor · missing-dims integrity.
 *
 * Version-immutability / restore / re-import cases are DB/service-level and
 * live in the import+service tests (they can't be exercised on the pure core).
 *
 * Run with: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculatePackingList,
  type PackagingSpec,
  type ContainerType,
  type PackingConfig,
  type PackingContext,
} from "../lib/packing-core/index.ts";
import { recommendContainers } from "../lib/packing-core/container.ts";
import { cbm } from "../lib/packing-core/cbm.ts";

// ---------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------
const CONFIG: PackingConfig = {
  volumetric_factor: 200,
  incomplete_carton_policy: "remaining_individual_cartons",
  pole_forces_40hq_length_mm: 5500,
  default_safety_margin_pct: 10,
};

const CONTAINERS: ContainerType[] = [
  { code: "LCL", name: "LCL", internal: { l_mm: null, w_mm: null, h_mm: null }, theoretical_cbm: null, operational_cbm: null, max_payload_kg: null, safety_margin_pct: 0, applicable_cbm_min: 0, applicable_cbm_max: 15, rules_validated: true, active: true },
  { code: "20GP", name: "20ft GP", internal: { l_mm: 5800, w_mm: 2300, h_mm: 2300 }, theoretical_cbm: 30.68, operational_cbm: 28, max_payload_kg: 28000, safety_margin_pct: 10, applicable_cbm_min: 15, applicable_cbm_max: 28, rules_validated: true, active: true },
  { code: "40GP", name: "40ft GP", internal: { l_mm: 12030, w_mm: 2350, h_mm: 2390 }, theoretical_cbm: 67.6, operational_cbm: null, max_payload_kg: 26500, safety_margin_pct: 10, applicable_cbm_min: null, applicable_cbm_max: null, rules_validated: false, active: true },
  { code: "40HQ", name: "40ft HQ", internal: { l_mm: 11800, w_mm: 2300, h_mm: 2600 }, theoretical_cbm: 70.56, operational_cbm: 68, max_payload_kg: 28500, safety_margin_pct: 10, applicable_cbm_min: 28, applicable_cbm_max: 68, rules_validated: true, active: true },
];

let seq = 0;
function spec(over: Partial<PackagingSpec>): PackagingSpec {
  seq += 1;
  return {
    item_id: over.item_id ?? `item-${seq}`,
    version_id: over.version_id ?? `ver-${seq}`,
    version_no: over.version_no ?? 1,
    reference: over.reference ?? null,
    name: over.name ?? null,
    component_name: over.component_name ?? null,
    component_type: over.component_type ?? null,
    packaging_type: over.packaging_type ?? null,
    units_per_outside_carton: over.units_per_outside_carton ?? null,
    inner: over.inner ?? { l_mm: null, w_mm: null, h_mm: null },
    outer: over.outer ?? { l_mm: null, w_mm: null, h_mm: null },
    net_weight_kg: over.net_weight_kg ?? null,
    gross_weight_unit_kg: over.gross_weight_unit_kg ?? null,
    gross_weight_master_kg: over.gross_weight_master_kg ?? null,
    is_lamp_pole: over.is_lamp_pole ?? false,
    is_oversized: over.is_oversized ?? false,
    volumetric_factor: over.volumetric_factor ?? null,
  };
}

function ctx(map: Record<string, PackagingSpec>, resolveBom?: PackingContext["resolveBom"]): PackingContext {
  return {
    config: CONFIG,
    containers: CONTAINERS,
    getPackaging: (id) => map[id] ?? null,
    resolveBom,
  };
}

// Reusable specs
const SIMPLE = spec({ item_id: "SIMPLE", reference: "SIMPLE", inner: { l_mm: 500, w_mm: 300, h_mm: 200 }, net_weight_kg: 2, gross_weight_unit_kg: 2.5 });
const MASTER = spec({ item_id: "MASTER", reference: "B021-38", units_per_outside_carton: 4, inner: { l_mm: 420, w_mm: 310, h_mm: 320 }, outer: { l_mm: 665, w_mm: 450, h_mm: 670 }, net_weight_kg: 2.3, gross_weight_unit_kg: 3.2 });

// ---------------------------------------------------------------------
// 1) Simple product — no outside carton → N individual cartons
// ---------------------------------------------------------------------
test("simple product → individual cartons, CBM & weights", () => {
  const res = calculatePackingList(
    { source_type: "manual", source_id: null, items: [{ product_id: "SIMPLE", quantity: 10 }] },
    ctx({ SIMPLE })
  );
  assert.equal(res.total_packages, 10);
  assert.equal(res.packages[0].package_kind, "individual_carton");
  assert.equal(res.total_cbm, cbm({ l_mm: 500, w_mm: 300, h_mm: 200 })! * 10); // 0.03 × 10
  assert.equal(res.net_weight, 20);
  assert.equal(res.gross_weight, 25);
  assert.equal(res.lines[0].complete_outside_cartons, 0);
  assert.equal(res.lines[0].remaining_individual_cartons, 10);
  assert.equal(res.requires_operations_validation, true);
});

// ---------------------------------------------------------------------
// 2) Product with a master carton — exact multiple
// ---------------------------------------------------------------------
test("master carton, exact multiple → only outside cartons", () => {
  const res = calculatePackingList(
    { source_type: "manual", source_id: null, items: [{ product_id: "MASTER", quantity: 100 }] },
    ctx({ MASTER })
  );
  const b = res.lines[0];
  assert.equal(b.units_per_outside_carton, 4);
  assert.equal(b.complete_outside_cartons, 25);
  assert.equal(b.remaining_units, 0);
  assert.equal(b.remaining_individual_cartons, 0);
  assert.equal(res.total_packages, 25);
  assert.equal(res.packages.length, 1);
  assert.equal(res.packages[0].package_kind, "outside_carton");
  assert.equal(res.net_weight, 230); // 2.3 × 100
});

// ---------------------------------------------------------------------
// 3) Incomplete master carton — the §11 example (qty 102, N 4)
// ---------------------------------------------------------------------
test("incomplete master carton → §11 example numbers exactly", () => {
  const res = calculatePackingList(
    { source_type: "manual", source_id: null, items: [{ product_id: "MASTER", quantity: 102 }] },
    ctx({ MASTER })
  );
  const b = res.lines[0];
  assert.equal(b.ordered_quantity, 102);
  assert.equal(b.units_per_outside_carton, 4);
  assert.equal(b.complete_outside_cartons, 25);
  assert.equal(b.remaining_units, 2);
  assert.equal(b.remaining_individual_cartons, 2);
  assert.equal(b.total_packages, 27);
  // two package rows: 25 outside + 2 individual
  const outside = res.packages.find((p) => p.package_kind === "outside_carton")!;
  const indiv = res.packages.find((p) => p.package_kind === "individual_carton")!;
  assert.equal(outside.count, 25);
  assert.equal(indiv.count, 2);
  assert.equal(indiv.incomplete, true);
});

test("incomplete carton policy round_up → one extra outside carton", () => {
  const res = calculatePackingList(
    { source_type: "manual", source_id: null, items: [{ product_id: "MASTER", quantity: 102 }] },
    { ...ctx({ MASTER }), config: { ...CONFIG, incomplete_carton_policy: "round_up_outside_carton" } }
  );
  const b = res.lines[0];
  assert.equal(b.complete_outside_cartons, 25);
  assert.equal(b.remaining_individual_cartons, 0);
  assert.equal(b.total_packages, 26); // 25 + 1 partial outside
});

// ---------------------------------------------------------------------
// 4) Mixed products
// ---------------------------------------------------------------------
test("mixed products aggregate packages and versions", () => {
  const res = calculatePackingList(
    {
      source_type: "manual", source_id: null,
      items: [
        { product_id: "SIMPLE", quantity: 10 },
        { product_id: "MASTER", quantity: 100 },
      ],
    },
    ctx({ SIMPLE, MASTER })
  );
  assert.equal(res.total_packages, 35); // 10 + 25
  assert.equal(res.packaging_versions_used.length, 2);
});

// ---------------------------------------------------------------------
// 5) Product with lamp head + arm (BOM explosion)
// ---------------------------------------------------------------------
test("lamp head + arm via BOM", () => {
  const HEAD = spec({ item_id: "HEAD", reference: "SSLXPRO80 HEAD", inner: { l_mm: 685, w_mm: 300, h_mm: 155 }, net_weight_kg: 4.56, gross_weight_unit_kg: 5.21 });
  const ARM = spec({ item_id: "ARM", reference: "ARM", inner: { l_mm: 850, w_mm: 450, h_mm: 80 }, net_weight_kg: 4.5, gross_weight_unit_kg: 5 });
  const PANEL = spec({ item_id: "PANEL", reference: "SSLXPRO80 PANEL", inner: { l_mm: 1610, w_mm: 770, h_mm: 205 }, net_weight_kg: 28.5, gross_weight_unit_kg: 34.45 });
  const resolveBom: PackingContext["resolveBom"] = (pid) =>
    pid === "SSLXPRO80"
      ? [
          { component_id: "PANEL", qty_per_product: 1 },
          { component_id: "HEAD", qty_per_product: 1 },
          { component_id: "ARM", qty_per_product: 1 },
        ]
      : [{ component_id: pid, qty_per_product: 1 }];

  const res = calculatePackingList(
    { source_type: "manual", source_id: null, items: [{ product_id: "SSLXPRO80", quantity: 20 }] },
    ctx({ HEAD, ARM, PANEL }, resolveBom)
  );
  assert.equal(res.packaging_versions_used.length, 3);
  assert.equal(res.total_packages, 60); // 20 panels + 20 heads + 20 arms
  assert.ok(res.packages.some((p) => p.reference === "SSLXPRO80 HEAD"));
  assert.ok(res.packages.some((p) => p.reference === "ARM"));
});

// ---------------------------------------------------------------------
// 6) Dual product — two heads per product
// ---------------------------------------------------------------------
test("Dual product requires two heads", () => {
  const HEAD = spec({ item_id: "DHEAD", reference: "DUAL HEAD", inner: { l_mm: 685, w_mm: 300, h_mm: 155 }, net_weight_kg: 4.5, gross_weight_unit_kg: 5 });
  const PANEL = spec({ item_id: "DPANEL", reference: "DUAL PANEL", inner: { l_mm: 1825, w_mm: 1010, h_mm: 245 }, net_weight_kg: 40.5, gross_weight_unit_kg: 46.5 });
  const resolveBom: PackingContext["resolveBom"] = (pid) =>
    pid === "DUAL50"
      ? [
          { component_id: "DPANEL", qty_per_product: 1 },
          { component_id: "DHEAD", qty_per_product: 2 }, // ← Dual
        ]
      : [{ component_id: pid, qty_per_product: 1 }];

  const res = calculatePackingList(
    { source_type: "manual", source_id: null, items: [{ product_id: "DUAL50", quantity: 10 }] },
    ctx({ DHEAD: HEAD, DPANEL: PANEL }, resolveBom)
  );
  const headLine = res.lines.find((l) => l.reference === "DUAL HEAD")!;
  assert.equal(headLine.ordered_quantity, 20); // 10 products × 2 heads
});

// ---------------------------------------------------------------------
// 7) Product with a pole
// ---------------------------------------------------------------------
test("pole ships as pole packages, not boxed", () => {
  const HEAD = spec({ item_id: "PHEAD", reference: "HEAD", inner: { l_mm: 450, w_mm: 420, h_mm: 320 }, net_weight_kg: 4, gross_weight_unit_kg: 5.3, units_per_outside_carton: 4, outer: { l_mm: 890, w_mm: 460, h_mm: 690 } });
  const POLE = spec({ item_id: "POLE-2M", reference: "POLE-2M", inner: { l_mm: 250, w_mm: 250, h_mm: 2100 }, net_weight_kg: 5.8, gross_weight_unit_kg: 6.7, is_lamp_pole: true });
  const res = calculatePackingList(
    { source_type: "manual", source_id: null, items: [{ product_id: "PHEAD", quantity: 5, options: { pole: true, pole_reference: "POLE-2M" } }] },
    ctx({ PHEAD: HEAD, "POLE-2M": POLE })
  );
  assert.equal(res.has_poles, true);
  const pole = res.packages.find((p) => p.is_pole)!;
  assert.equal(pole.package_kind, "pole");
  assert.equal(pole.count, 5);
  assert.ok(res.warnings.some((w) => /pole/i.test(w)));
});

// ---------------------------------------------------------------------
// 8) Pole longer than 5.5m → forces 40HQ
// ---------------------------------------------------------------------
test("pole > 5.5m forces 40HQ recommendation", () => {
  const POLE8 = spec({ item_id: "POLE-8M", reference: "POLE-8M", inner: { l_mm: 250, w_mm: 250, h_mm: 8000 }, net_weight_kg: 30, gross_weight_unit_kg: 34, is_lamp_pole: true });
  const res = calculatePackingList(
    { source_type: "manual", source_id: null, items: [{ product_id: "POLE-8M", quantity: 5 }] },
    ctx({ "POLE-8M": POLE8 })
  );
  assert.equal(res.has_poles, true);
  assert.ok(res.warnings.some((w) => /40HQ/.test(w)));
  assert.equal(res.container_recommendations[0].container_code, "40HQ");
  assert.equal(res.container_recommendations[0].recommended, true);
});

// ---------------------------------------------------------------------
// 9 & 10) 20GP vs 40HQ recommendation (volume-based, direct)
// ---------------------------------------------------------------------
test("20GP recommended for a ~20 CBM load", () => {
  const recos = recommendContainers({ totalCbm: 20, totalGross: 5000, packages: [], containers: CONTAINERS, config: CONFIG, forces40HQ: false });
  const rec = recos.find((r) => r.recommended)!;
  assert.equal(rec.container_code, "20GP");
  assert.equal(rec.count, 1);
});

test("40HQ recommended for a ~60 CBM load (fewer containers)", () => {
  const recos = recommendContainers({ totalCbm: 60, totalGross: 12000, packages: [], containers: CONTAINERS, config: CONFIG, forces40HQ: false });
  const rec = recos.find((r) => r.recommended)!;
  assert.equal(rec.container_code, "40HQ");
  assert.equal(rec.count, 1);
  assert.ok(rec.utilization_pct! > 90); // 60 / (68×0.9=61.2) ≈ 98%
});

test("LCL recommended for a small (<15 CBM) load", () => {
  const recos = recommendContainers({ totalCbm: 10, totalGross: 2000, packages: [], containers: CONTAINERS, config: CONFIG, forces40HQ: false });
  assert.equal(recos.find((r) => r.recommended)!.container_code, "LCL");
});

test("40GP is offered but never auto-recommended (rules not validated)", () => {
  const recos = recommendContainers({ totalCbm: 60, totalGross: 12000, packages: [], containers: CONTAINERS, config: CONFIG, forces40HQ: false });
  const gp40 = recos.find((r) => r.container_code === "40GP")!;
  assert.equal(gp40.rules_validated, false);
  assert.equal(gp40.recommended, false);
  assert.ok(gp40.warnings.some((w) => /not validated/i.test(w)));
});

// ---------------------------------------------------------------------
// 11) Manual override — a per-calculation dimension change alters output
// ---------------------------------------------------------------------
test("manual dimension override changes CBM for this calculation only", () => {
  const base = calculatePackingList(
    { source_type: "manual", source_id: null, items: [{ product_id: "MASTER", quantity: 100 }] },
    ctx({ MASTER })
  );
  const overridden = { ...MASTER, outer: { l_mm: 700, w_mm: 450, h_mm: 670 } };
  const after = calculatePackingList(
    { source_type: "manual", source_id: null, items: [{ product_id: "MASTER", quantity: 100 }] },
    ctx({ MASTER: overridden })
  );
  assert.notEqual(base.total_cbm, after.total_cbm);
  assert.ok(after.total_cbm > base.total_cbm);
});

// ---------------------------------------------------------------------
// Configurable volumetric factor
// ---------------------------------------------------------------------
test("volumetric factor is configurable, not hard-coded", () => {
  const res200 = calculatePackingList(
    { source_type: "manual", source_id: null, items: [{ product_id: "SIMPLE", quantity: 10 }] },
    ctx({ SIMPLE })
  );
  const res300 = calculatePackingList(
    { source_type: "manual", source_id: null, items: [{ product_id: "SIMPLE", quantity: 10 }] },
    { ...ctx({ SIMPLE }), config: { ...CONFIG, volumetric_factor: 300 } }
  );
  assert.equal(res200.volumetric_weight, res200.total_cbm * 200);
  assert.equal(res300.volumetric_weight, res300.total_cbm * 300);
});

// ---------------------------------------------------------------------
// Integrity — missing dims never fabricate a CBM
// ---------------------------------------------------------------------
test("missing dimension → CBM null, excluded from total, warned", () => {
  const BAD = spec({ item_id: "BAD", reference: "BAD", inner: { l_mm: 500, w_mm: 300, h_mm: null }, net_weight_kg: 2, gross_weight_unit_kg: 2.5 });
  const res = calculatePackingList(
    { source_type: "manual", source_id: null, items: [{ product_id: "BAD", quantity: 5 }] },
    ctx({ BAD })
  );
  assert.equal(res.packages[0].cbm_each, null);
  assert.equal(res.total_cbm, 0);
  assert.ok(res.warnings.some((w) => /incomplete dimensions/i.test(w)));
});

test("unknown component → excluded, warned, nothing fabricated", () => {
  const res = calculatePackingList(
    { source_type: "manual", source_id: null, items: [{ product_id: "GHOST", quantity: 5 }] },
    ctx({})
  );
  assert.equal(res.total_packages, 0);
  assert.ok(res.warnings.some((w) => /No packaging data/i.test(w)));
});
