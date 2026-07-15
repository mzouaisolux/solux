// =====================================================================
// lib/packing-core/carton.ts — carton/package math for ONE component.
//
// Turns (ordered quantity, packaging spec, config) into explicit package
// rows + a LineBreakdown that shows EVERY rounding assumption (§11).
// =====================================================================
import type {
  PackagingSpec,
  PackingConfig,
  PackageOut,
  LineBreakdown,
  Dimensions,
} from "./types.ts";
import { cbm, r } from "./cbm.ts";

export interface CartonResult {
  packages: PackageOut[];
  breakdown: LineBreakdown;
}

interface CalcArgs {
  lineIndex: number;
  productId: string;
  quantity: number;
  spec: PackagingSpec;
  config: PackingConfig;
}

/**
 * Compute packages for a single component demand.
 *
 * Model (matches the source Excel):
 *   • inner carton = the individual box for 1 unit (dims C/D/E).
 *   • outside/master carton = holds `units_per_outside_carton` units (dims F/G/H).
 *   • poles / oversized pieces ship as individual pieces (kind 'pole').
 *
 * Incomplete-carton policy is explicit and configurable:
 *   • remaining_individual_cartons → leftovers ship as individual cartons.
 *   • round_up_outside_carton      → one extra (partial) outside carton.
 */
export function calcComponent(args: CalcArgs): CartonResult {
  const { lineIndex, productId, quantity, spec, config } = args;
  const warnings: string[] = [];
  const packages: PackageOut[] = [];

  const isPole = spec.is_lamp_pole;
  const isOversized = spec.is_oversized || isPole;
  const netUnit = spec.net_weight_kg ?? 0;
  const grossUnit = spec.gross_weight_unit_kg ?? spec.net_weight_kg ?? 0;
  const innerCbm = cbm(spec.inner);
  const outerCbm = cbm(spec.outer);

  if (spec.net_weight_kg == null) warnings.push("net weight missing — treated as 0");
  if (spec.gross_weight_unit_kg == null && spec.net_weight_kg == null)
    warnings.push("gross weight missing — treated as 0");

  // -------------------------------------------------------------------
  // POLE / OVERSIZED — never boxed in master cartons; one piece = one package.
  // -------------------------------------------------------------------
  if (isPole) {
    if (innerCbm == null) warnings.push("pole dimensions incomplete — CBM unavailable");
    packages.push({
      line_index: lineIndex,
      product_id: productId,
      component_id: spec.item_id,
      reference: spec.reference,
      name: spec.name,
      item_version_id: spec.version_id,
      version_no: spec.version_no,
      package_kind: "pole",
      packaging_method: spec.packaging_type ?? "pole",
      count: quantity,
      dimensions_mm: spec.inner,
      cbm_each: innerCbm,
      cbm_total: innerCbm == null ? null : r(innerCbm * quantity, 6),
      net_weight: r(netUnit * quantity, 3),
      gross_weight: r(grossUnit * quantity, 3),
      incomplete: false,
      is_pole: true,
      is_oversized: true,
      notes: ["pole — pack in wooden case; see pole profile / Operations review"],
    });
    return {
      packages,
      breakdown: breakdown({
        lineIndex, productId, spec, quantity,
        unitsPerInner: 1, unitsPerOutside: null,
        completeOutside: 0, remainingUnits: quantity, remainingIndividual: quantity,
        policy: config.incomplete_carton_policy,
        totalPackages: quantity, cbmPerPackage: innerCbm,
        totalCbm: innerCbm == null ? 0 : r(innerCbm * quantity, 6),
        net: r(netUnit * quantity, 3), gross: r(grossUnit * quantity, 3),
        warnings,
      }),
    };
  }

  // -------------------------------------------------------------------
  // NO OUTSIDE CARTON — every unit ships as its own individual carton.
  // -------------------------------------------------------------------
  const perOutside = spec.units_per_outside_carton;
  const hasOutside = perOutside != null && perOutside >= 1 && outerCbm != null;

  if (!hasOutside) {
    if (perOutside != null && perOutside >= 1 && outerCbm == null)
      warnings.push("outside carton declared but its dimensions are missing — packed as individual cartons");
    packages.push(mkPackage({
      lineIndex, productId, spec,
      kind: "individual_carton",
      count: quantity,
      dims: spec.inner,
      cbmEach: innerCbm,
      net: netUnit, gross: grossUnit,
      incomplete: false, isOversized,
    }));
    const totalCbm = innerCbm == null ? 0 : r(innerCbm * quantity, 6);
    if (innerCbm == null) warnings.push("inner carton dimensions incomplete — CBM unavailable");
    return {
      packages,
      breakdown: breakdown({
        lineIndex, productId, spec, quantity,
        unitsPerInner: 1, unitsPerOutside: null,
        completeOutside: 0, remainingUnits: quantity, remainingIndividual: quantity,
        policy: config.incomplete_carton_policy,
        totalPackages: quantity, cbmPerPackage: innerCbm, totalCbm,
        net: r(netUnit * quantity, 3), gross: r(grossUnit * quantity, 3),
        warnings,
      }),
    };
  }

  // -------------------------------------------------------------------
  // WITH OUTSIDE CARTON — split into complete cartons + leftovers.
  // -------------------------------------------------------------------
  const N = perOutside!;
  const completeOutside = Math.floor(quantity / N);
  const remainingUnits = quantity % N;
  const grossMaster = spec.gross_weight_master_kg ?? r(grossUnit * N, 3);

  let remainingIndividual = 0;
  let extraOutside = 0;
  if (remainingUnits > 0) {
    if (config.incomplete_carton_policy === "round_up_outside_carton") {
      extraOutside = 1; // one partial outside carton
    } else {
      remainingIndividual = remainingUnits; // ship leftovers as individual cartons
    }
  }

  const outsideCount = completeOutside + extraOutside;
  if (outsideCount > 0) {
    packages.push(mkPackage({
      lineIndex, productId, spec,
      kind: "outside_carton",
      count: outsideCount,
      dims: spec.outer,
      cbmEach: outerCbm,
      net: netUnit * N, gross: grossMaster,
      incomplete: extraOutside > 0, isOversized,
    }));
  }
  if (remainingIndividual > 0) {
    packages.push(mkPackage({
      lineIndex, productId, spec,
      kind: "individual_carton",
      count: remainingIndividual,
      dims: spec.inner,
      cbmEach: innerCbm,
      net: netUnit, gross: grossUnit,
      incomplete: true, isOversized,
    }));
  }

  const totalPackages = outsideCount + remainingIndividual;
  const totalCbm = r(
    (outerCbm ?? 0) * outsideCount + (innerCbm ?? 0) * remainingIndividual,
    6
  );
  const totalNet = r(netUnit * quantity, 3);
  const totalGross = r(
    grossMaster * outsideCount + grossUnit * remainingIndividual,
    3
  );

  return {
    packages,
    breakdown: breakdown({
      lineIndex, productId, spec, quantity,
      unitsPerInner: 1, unitsPerOutside: N,
      completeOutside, remainingUnits, remainingIndividual,
      policy: config.incomplete_carton_policy,
      totalPackages, cbmPerPackage: outerCbm, totalCbm,
      net: totalNet, gross: totalGross,
      warnings,
    }),
  };
}

// ---------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------
function mkPackage(a: {
  lineIndex: number; productId: string; spec: PackagingSpec;
  kind: PackageOut["package_kind"]; count: number; dims: Dimensions;
  cbmEach: number | null; net: number; gross: number;
  incomplete: boolean; isOversized: boolean;
}): PackageOut {
  const notes: string[] = [];
  if (a.cbmEach == null) notes.push("dimensions incomplete — CBM unavailable");
  return {
    line_index: a.lineIndex,
    product_id: a.productId,
    component_id: a.spec.item_id,
    reference: a.spec.reference,
    name: a.spec.name,
    item_version_id: a.spec.version_id,
    version_no: a.spec.version_no,
    package_kind: a.kind,
    packaging_method: a.spec.packaging_type,
    count: a.count,
    dimensions_mm: a.dims,
    cbm_each: a.cbmEach,
    cbm_total: a.cbmEach == null ? null : r(a.cbmEach * a.count, 6),
    net_weight: r(a.net * a.count, 3),
    gross_weight: r(a.gross * a.count, 3),
    incomplete: a.incomplete,
    is_pole: false,
    is_oversized: a.isOversized,
    notes,
  };
}

function breakdown(a: {
  lineIndex: number; productId: string; spec: PackagingSpec; quantity: number;
  unitsPerInner: number; unitsPerOutside: number | null;
  completeOutside: number; remainingUnits: number; remainingIndividual: number;
  policy: PackingConfig["incomplete_carton_policy"];
  totalPackages: number; cbmPerPackage: number | null; totalCbm: number;
  net: number; gross: number; warnings: string[];
}): LineBreakdown {
  return {
    line_index: a.lineIndex,
    product_id: a.productId,
    component_id: a.spec.item_id,
    reference: a.spec.reference,
    ordered_quantity: a.quantity,
    units_per_inner_carton: a.unitsPerInner,
    units_per_outside_carton: a.unitsPerOutside,
    complete_outside_cartons: a.completeOutside,
    remaining_units: a.remainingUnits,
    remaining_individual_cartons: a.remainingIndividual,
    incomplete_carton_policy: a.policy,
    total_packages: a.totalPackages,
    cbm_per_package: a.cbmPerPackage,
    total_cbm: a.totalCbm,
    net_weight: a.net,
    gross_weight: a.gross,
    warnings: a.warnings,
  };
}
