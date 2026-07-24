/**
 * Datasheet grouping — maps Hub spec-field keys onto the technical-page layout
 * groups (Lighting · Battery · Energy · Electronic · Mechanical) plus the
 * left-column pull-outs (headline bullets, dimensions block, product code,
 * warranty seal, certifications). Data comes from the Hub; this file only
 * decides where each field renders on the branded auto sheet.
 */

/**
 * Datasheet template version. Bump this whenever the SpecSheetPDF layout
 * changes so already-rendered sheets are treated as stale and regenerate on
 * next access.
 */
export const SPEC_SHEET_TEMPLATE_VERSION = "v2";

export const SPEC_GROUPS: { title: string; keys: string[] }[] = [
  {
    title: "Lighting",
    keys: ["efficiency", "led", "led_lifetime", "optics", "beam_angle", "light_height", "led_quantity"],
  },
  {
    title: "Battery",
    keys: ["battery_technology", "battery_capacity", "autonomy", "charging_time", "battery_lifespan", "working_temp"],
  },
  {
    title: "Energy",
    keys: ["solar_panel", "solar_panel_luminaire", "cells_type", "number_of_colarsun"],
  },
  {
    title: "Electronic",
    keys: ["controller", "sensor", "protection", "cabling"],
  },
  {
    title: "Mechanical",
    keys: ["pole_mounting", "material", "installation", "wind_speed", "color"],
  },
];

/** Headline bullets, top-left of the technical page. */
export const HEADLINE_KEYS = ["nominal_flux", "nominal_power"];

/** Left-column "Dimensions per <product>" block. */
export const DIMENSION_KEYS = ["product_dimensions", "carton_size", "net_weight", "gross_weight"];

/** Single-field pull-outs. */
export const PRODUCT_CODE_KEY = "product_code";
export const WARRANTY_KEY = "warranty_luminaire";
export const CERTIFICATIONS_KEY = "certifications";

/** Keys that render in their own pull-out — never inside the grouped panel. */
export const PULLOUT_KEYS = new Set<string>([
  ...HEADLINE_KEYS,
  ...DIMENSION_KEYS,
  PRODUCT_CODE_KEY,
  CERTIFICATIONS_KEY,
]);
