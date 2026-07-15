// =====================================================================
// lib/packing-core/index.ts — engine entry point.
//
//   calculatePackingList(input, context) → PackingResult
//
// Pure: all data comes through `context` (DB-free). This is the single
// function the ERP will call from Sales Project Request / Packing List
// Request / Transport Request / Proforma / Quotation / Order / Factory prep.
// =====================================================================
import type {
  PackingInput,
  PackingContext,
  PackingResult,
  PackageOut,
  LineBreakdown,
  PackagingVersionUsed,
} from "./types.ts";
import { calcComponent } from "./carton.ts";
import { recommendContainers } from "./container.ts";
import { polesForce40HQ, longestPoleMm } from "./pole.ts";
import { r, longestAxis } from "./cbm.ts";

export * from "./types.ts";
export { cbm, volumetricWeight } from "./cbm.ts";
export { recommendContainers, usableCbm } from "./container.ts";
export * from "./fill.ts";
export * from "./placement3d.ts";

/** Default BOM explosion when the context provides none. */
function defaultBom(
  productId: string,
  options: Record<string, unknown>
): Array<{ component_id: string; qty_per_product: number; label?: string }> {
  const out: Array<{ component_id: string; qty_per_product: number; label?: string }> = [
    { component_id: productId, qty_per_product: 1 },
  ];
  // §19 example: options.pole + pole_reference → add the pole as a component.
  if (options?.pole && typeof options.pole_reference === "string") {
    out.push({ component_id: options.pole_reference, qty_per_product: 1, label: "pole" });
  }
  return out;
}

export function calculatePackingList(
  input: PackingInput,
  context: PackingContext
): PackingResult {
  const { config, containers } = context;
  const packages: PackageOut[] = [];
  const lines: LineBreakdown[] = [];
  const warnings: string[] = [];
  const assumptions: string[] = [];
  const versionsUsed = new Map<string, PackagingVersionUsed>();

  let lineIndex = 0;
  for (const item of input.items) {
    const qty = Number(item.quantity) || 0;
    if (qty <= 0) {
      warnings.push(`Item "${item.product_id}" has quantity ${item.quantity} — skipped.`);
      continue;
    }
    const options = item.options ?? {};
    const bom = context.resolveBom
      ? context.resolveBom(item.product_id, options)
      : defaultBom(item.product_id, options);

    if (!bom.length) {
      warnings.push(`No packaging BOM resolved for "${item.product_id}".`);
      continue;
    }

    for (const line of bom) {
      const spec = context.getPackaging(line.component_id);
      if (!spec) {
        warnings.push(
          `No packaging data for component "${line.component_id}" (product "${item.product_id}") — excluded from totals. Needs Operations input.`
        );
        // Still record an explicit zero breakdown so nothing is hidden.
        lines.push({
          line_index: lineIndex,
          product_id: item.product_id,
          component_id: line.component_id,
          reference: line.label ?? line.component_id,
          ordered_quantity: qty * line.qty_per_product,
          units_per_inner_carton: 1,
          units_per_outside_carton: null,
          complete_outside_cartons: 0,
          remaining_units: qty * line.qty_per_product,
          remaining_individual_cartons: 0,
          incomplete_carton_policy: config.incomplete_carton_policy,
          total_packages: 0,
          cbm_per_package: null,
          total_cbm: 0,
          net_weight: 0,
          gross_weight: 0,
          warnings: ["packaging data missing — not counted"],
        });
        lineIndex++;
        continue;
      }

      const componentQty = qty * line.qty_per_product;
      const { packages: pkgs, breakdown } = calcComponent({
        lineIndex,
        productId: item.product_id,
        quantity: componentQty,
        spec: {
          ...spec,
          volumetric_factor: spec.volumetric_factor ?? config.volumetric_factor,
        },
        config,
      });
      packages.push(...pkgs);
      lines.push(breakdown);

      if (!versionsUsed.has(spec.item_id)) {
        versionsUsed.set(spec.item_id, {
          item_id: spec.item_id,
          version_id: spec.version_id,
          version_no: spec.version_no,
          reference: spec.reference,
        });
      }
      lineIndex++;
    }
  }

  // ---- Aggregate totals -------------------------------------------------
  const totalPackages = packages.reduce((s, p) => s + p.count, 0);
  const totalCbm = r(
    packages.reduce((s, p) => s + (p.cbm_total ?? 0), 0),
    6
  );
  const netWeight = r(packages.reduce((s, p) => s + (p.net_weight ?? 0), 0), 3);
  const grossWeight = r(packages.reduce((s, p) => s + (p.gross_weight ?? 0), 0), 3);
  const volumetricWeight = r(totalCbm * config.volumetric_factor, 3);

  const longestPkg = packages
    .map((p) => longestAxis(p.dimensions_mm))
    .filter((x): x is number => x != null);
  const longestPackageMm = longestPkg.length ? Math.max(...longestPkg) : null;
  const hasPoles = packages.some((p) => p.is_pole);
  const forces40HQ = polesForce40HQ(packages, config);

  // ---- Warnings & assumptions ------------------------------------------
  if (packages.some((p) => p.cbm_total == null))
    warnings.push("Some packages have incomplete dimensions — their CBM is excluded from the total.");
  if (hasPoles) {
    const lp = longestPoleMm(packages);
    warnings.push(`Includes lamp poles${lp != null ? ` (longest ${lp}mm)` : ""} — pack in wooden cases; Operations review required.`);
  }
  if (forces40HQ)
    warnings.push(`Poles exceed ${config.pole_forces_40hq_length_mm}mm → 40HQ required regardless of quantity (Word §II).`);
  assumptions.push(`Volumetric weight = CBM × ${config.volumetric_factor} (configurable).`);
  assumptions.push(
    config.incomplete_carton_policy === "remaining_individual_cartons"
      ? "Incomplete outside cartons ship as individual cartons."
      : "Incomplete outside cartons are rounded up to a full outside carton."
  );

  // ---- Container recommendation (volume-based) -------------------------
  const container_recommendations = recommendContainers({
    totalCbm,
    totalGross: grossWeight,
    packages,
    containers,
    config,
    forces40HQ,
  });

  return {
    packages,
    lines,
    total_packages: totalPackages,
    total_cbm: totalCbm,
    net_weight: netWeight,
    gross_weight: grossWeight,
    volumetric_weight: volumetricWeight,
    longest_package_mm: longestPackageMm,
    has_poles: hasPoles,
    container_recommendations,
    // The base engine is a volume + weight estimate — NOT a physical placement.
    // The fill engine (lib/packing-core/fill.ts) can raise this to RULE_BASED,
    // and only a real 3D engine or a validated template goes beyond that.
    calculation_method: "VOLUME_AND_WEIGHT",
    warnings,
    assumptions,
    requires_operations_validation: true, // ALWAYS in Phase 1
    packaging_versions_used: Array.from(versionsUsed.values()),
  };
}
