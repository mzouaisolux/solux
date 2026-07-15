// =====================================================================
// lib/packing-core/types.ts
//
// Framework-independent contract for the Packing List calculation engine.
// NO imports from Next.js, Supabase, React or the DB — this file (and the
// whole packing-core folder) must stay pure so the ERP can reuse it as-is.
//
// The public INPUT/OUTPUT shapes match the spec §19 exactly (snake_case),
// so an ERP caller gets the same JSON the standalone module returns.
// =====================================================================

/** One dimension triple in millimetres. Any axis may be null (missing data). */
export interface Dimensions {
  l_mm: number | null;
  w_mm: number | null;
  h_mm: number | null;
}

/**
 * Normalized packaging spec the engine consumes for ONE item/component.
 * The caller (service layer) builds these from the active packing_item_version
 * rows — the engine never touches the DB. All ids are opaque strings.
 */
export interface PackagingSpec {
  item_id: string;
  version_id: string | null;
  version_no: number | null;
  reference: string | null;
  name: string | null;
  component_name: string | null;
  component_type: string | null;
  packaging_type: string | null;

  /** Units packed inside one OUTSIDE / master carton. null / 1 → no master carton. */
  units_per_outside_carton: number | null;

  inner: Dimensions; // individual carton
  outer: Dimensions; // outside / master carton (may be all-null)

  net_weight_kg: number | null;
  gross_weight_unit_kg: number | null;
  gross_weight_master_kg: number | null;

  is_lamp_pole: boolean;
  is_oversized: boolean;

  /** Volumetric factor for THIS spec; falls back to config when null. */
  volumetric_factor: number | null;
}

/** Configurable container type (from packing_container_type, editable). */
export interface ContainerType {
  code: string; // LCL | 20GP | 40GP | 40HQ
  name: string;
  internal: Dimensions;
  door_w_mm?: number | null;
  door_h_mm?: number | null;
  theoretical_cbm: number | null;
  operational_cbm: number | null;
  max_payload_kg: number | null;
  safety_margin_pct: number; // % of operational volume kept free
  /** Absolute CBM kept free on top of the % margin (min unused reserve). */
  min_unused_reserve_cbm?: number | null;
  applicable_cbm_min: number | null;
  applicable_cbm_max: number | null;
  /** Product families this container is meant for (empty = any). */
  applicable_families?: string[] | null;
  rules_validated: boolean; // 40GP = false → warn, never present as proven
  active: boolean;
}

/** Engine configuration (from packing_config, all overridable). */
export interface PackingConfig {
  volumetric_factor: number; // default 200 (Excel: CBM×200)
  incomplete_carton_policy: "remaining_individual_cartons" | "round_up_outside_carton";
  pole_forces_40hq_length_mm: number; // default 5500
  default_safety_margin_pct: number; // default 10
}

/** Dependency-injected context — this is how the engine stays DB-free. */
export interface PackingContext {
  config: PackingConfig;
  containers: ContainerType[];
  /** Resolve a packaging spec by product/component id. null → unknown item. */
  getPackaging: (id: string) => PackagingSpec | null;
  /**
   * Optional BOM explosion: a sellable product → its physical components.
   * When omitted, a product maps to itself (+ a pole component if
   * options.pole/pole_reference are set — matches the §19 example).
   */
  resolveBom?: (
    productId: string,
    options: Record<string, unknown>
  ) => Array<{ component_id: string; qty_per_product: number; label?: string }>;
}

// ---------------------------------------------------------------------
// PUBLIC INPUT (spec §19)
// ---------------------------------------------------------------------
export interface PackingInputItem {
  product_id: string;
  quantity: number;
  options?: Record<string, unknown>;
}
export interface PackingInput {
  source_type: string; // manual | erp_quotation | erp_order | …
  source_id: string | null;
  items: PackingInputItem[];
}

// ---------------------------------------------------------------------
// PUBLIC OUTPUT (spec §19 + explicit, never-hidden per-line breakdown §11)
// ---------------------------------------------------------------------
export type PackageKind =
  | "outside_carton"
  | "individual_carton"
  | "master_carton"
  | "pole"
  | "pallet"
  | "loose";

export interface PackageOut {
  line_index: number;
  product_id: string;
  component_id: string;
  reference: string | null;
  name: string | null;
  item_version_id: string | null;
  version_no: number | null;
  package_kind: PackageKind;
  packaging_method: string | null;
  count: number;
  dimensions_mm: Dimensions;
  cbm_each: number | null;
  cbm_total: number | null;
  net_weight: number | null;
  gross_weight: number | null;
  incomplete: boolean;
  is_pole: boolean;
  is_oversized: boolean;
  notes: string[];
}

/** Explicit carton math per input line — rounding assumptions are visible. */
export interface LineBreakdown {
  line_index: number;
  product_id: string;
  component_id: string;
  reference: string | null;
  ordered_quantity: number;
  units_per_inner_carton: number;
  units_per_outside_carton: number | null;
  complete_outside_cartons: number;
  remaining_units: number;
  remaining_individual_cartons: number;
  incomplete_carton_policy: PackingConfig["incomplete_carton_policy"];
  total_packages: number;
  cbm_per_package: number | null;
  total_cbm: number;
  net_weight: number;
  gross_weight: number;
  warnings: string[];
}

/**
 * How a capacity/fit figure was produced. This is MANDATORY on every
 * recommendation so the UI never implies a physical fit it didn't compute.
 *   VOLUME_ONLY                 — cargo CBM ÷ usable CBM, nothing else.
 *   VOLUME_AND_WEIGHT           — + gross-weight vs payload (the current engine).
 *   RULE_BASED                  — + package dimensions / rotations / layer rules.
 *   VALIDATED_TEMPLATE          — an Operations-validated loading configuration.
 *   THREE_DIMENSIONAL_PLACEMENT — a real geometric placement simulation.
 *   MANUALLY_VALIDATED          — a human confirmed the physical load.
 */
export type CalcMethod =
  | "VOLUME_ONLY"
  | "VOLUME_AND_WEIGHT"
  | "RULE_BASED"
  | "VALIDATED_TEMPLATE"
  | "THREE_DIMENSIONAL_PLACEMENT"
  | "MANUALLY_VALIDATED";

/** Short label + honest caution per method. NEVER says "will fit". */
export const CALC_METHOD_LABEL: Record<CalcMethod, string> = {
  VOLUME_ONLY: "Volume estimate only",
  VOLUME_AND_WEIGHT: "Volume & weight estimate",
  RULE_BASED: "Dimension-aware estimate",
  VALIDATED_TEMPLATE: "Previously validated loading configuration",
  THREE_DIMENSIONAL_PLACEMENT: "3D placement simulated",
  MANUALLY_VALIDATED: "Manually validated by Operations",
};
export const CALC_METHOD_CAUTION: Record<CalcMethod, string> = {
  VOLUME_ONLY: "Physical placement not verified — estimated additional capacity only.",
  VOLUME_AND_WEIGHT: "Physical placement not verified — Operations review required.",
  RULE_BASED: "Dimension-aware estimate — Operations review required.",
  VALIDATED_TEMPLATE: "Based on a previously validated load; re-confirm if packaging changed.",
  THREE_DIMENSIONAL_PLACEMENT: "3D placement simulated — Operations confirmation still required.",
  MANUALLY_VALIDATED: "Confirmed by Operations.",
};

export type Confidence = "low" | "medium" | "high";

export interface ContainerRecommendation {
  container_code: string;
  container_name: string;
  count: number;
  /** MANDATORY — how this figure was produced. Never implies a physical fit. */
  method: CalcMethod;
  confidence: Confidence;
  rules_validated: boolean;
  operational_cbm: number | null;
  usable_cbm: number | null; // operational × (1 − margin) − min reserve
  safety_margin_pct: number;
  used_cbm: number;
  utilization_pct: number | null;
  unused_cbm: number | null; // remaining CBM
  max_payload_kg: number | null;
  used_weight: number;
  remaining_payload_kg: number | null;
  weight_utilization_pct: number | null;
  recommended: boolean;
  warnings: string[];
  assumptions: string[];
}

export interface PackagingVersionUsed {
  item_id: string;
  version_id: string | null;
  version_no: number | null;
  reference: string | null;
}

export interface PackingResult {
  packages: PackageOut[];
  lines: LineBreakdown[];
  total_packages: number;
  total_cbm: number;
  net_weight: number;
  gross_weight: number;
  volumetric_weight: number; // total_cbm × factor (chargeable-weight input)
  longest_package_mm: number | null;
  has_poles: boolean;
  container_recommendations: ContainerRecommendation[];
  /** Overall method behind the recommendation (currently VOLUME_AND_WEIGHT). */
  calculation_method: CalcMethod;
  warnings: string[];
  assumptions: string[];
  requires_operations_validation: boolean; // ALWAYS true in Phase 1
  packaging_versions_used: PackagingVersionUsed[];
}
