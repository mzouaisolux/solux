// =====================================================================
// SR → task-list structured config (OBS-1, E2E « 14 juillet »).
// =====================================================================
//
// A quotation generated from a Service Request carries the technical spec
// (LED power, solar panel, battery, controller, IoT) only as FREE TEXT in
// the line description / original_sales_request. When "Launch Production"
// copies the lines to production_task_list_lines, the product line therefore
// lands with config_values = {} — the factory sees a blank line and the
// Factory Mapping release gate shows "Complete" vacuously (nothing to map).
//
// This module rebuilds a STRUCTURED config_values for such lines from the
// SR's spec, keyed by the category's real sales config fields (the admin
// vocabulary — "SOLAR PANEL", "Battery", "Controller", "OPTIONS"…):
//
//   • When the SR value matches one of the field's options (exact after
//     normalisation, or an unambiguous numeric match like "1152" →
//     "1152 Wh"), the OPTION's exact value is stored — so the factory
//     mapping resolver (optionLookupKey) can resolve it.
//   • Otherwise the RAW SR text is stored under the field name. It still
//     displays on the line (ProductSummaryCard renders config verbatim) and
//     the release gate counts it as a MISSING mapping — which is exactly
//     what forces production to look at it instead of releasing blind.
//   • If the category has no matching field at all, the value is kept under
//     a readable fallback label so the information is never dropped.
//
// PURE module (no DB) so the matching rules are unit-testable.
// =====================================================================

/** The SR technical spec, as carried by project_requests / project_products. */
export type SrTechSpec = {
  led_power?: string | null;
  solar_panel_size?: string | null;
  battery_spec?: string | null;
  controller?: string | null;
  iot_required?: boolean | null;
};

/** One sales-scope config field of the line's category, with its options. */
export type SrConfigField = {
  field_name: string;
  field_type: string; // "dropdown" | "checkbox_group" | …
  options: string[]; // option_value list, already category-scoped
};

/** Lower-case, collapse whitespace. */
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
/** Lower-case, strip everything non-alphanumeric ("60 W" → "60w"). */
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
/** Numeric tokens with comma decimals normalised ("614,4 Wh" → ["614.4"]). */
const numbers = (s: string) =>
  (s.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(",", "."));

/**
 * Match a free-text SR value against a field's option values.
 * Returns the OPTION's exact value on a confident match, null otherwise.
 * Conservative on purpose: a wrong silent match would send the factory a
 * wrong spec, while "no match" merely keeps the raw text visible + gated.
 */
export function matchOptionValue(
  raw: string,
  options: string[]
): string | null {
  const v = raw.trim();
  if (!v) return null;
  for (const o of options) if (norm(o) === norm(v)) return o;
  for (const o of options) if (squash(o) && squash(o) === squash(v)) return o;
  // Unambiguous numeric match: the SR value carries exactly one number and
  // exactly one option contains it ("1152" → "1152 Wh"; "140W" → "18V/140W").
  const ns = numbers(v);
  if (ns.length === 1) {
    const hits = options.filter((o) => numbers(o).includes(ns[0]));
    if (hits.length === 1) return hits[0];
  }
  return null;
}

/** True when a config object carries no real value (null/{}/blank values). */
export function isEmptyConfig(
  cfg: Record<string, string> | null | undefined
): boolean {
  if (!cfg) return true;
  return Object.values(cfg).every((v) => v == null || String(v).trim() === "");
}

/**
 * Overlay the SR field-keyed config onto a line's existing config. Existing
 * chips are kept (e.g. "Tilt angle"), EXCEPT the generic spec display labels
 * the SR→quotation generator writes ("LED power", "Solar panel", "Battery",
 * "Controller", "IoT") — those describe the same spec the field-keyed values
 * now carry, and keeping both would show duplicate chips on the line.
 */
const GENERIC_SPEC_LABELS = new Set([
  "ledpower",
  "solarpanel",
  "battery",
  "controller",
  "iot",
]);
export function mergeSrConfig(
  existing: Record<string, string> | null | undefined,
  srConfig: Record<string, string>
): Record<string, string> {
  const kept = Object.fromEntries(
    Object.entries(existing ?? {}).filter(
      ([k]) => !GENERIC_SPEC_LABELS.has(squash(k))
    )
  );
  return { ...kept, ...srConfig };
}

/**
 * Build the structured config_values for one SR-derived line from the SR
 * spec + the category's sales config fields. Returns {} when the spec is
 * empty — callers only overwrite an EMPTY config, never a filled one.
 */
export function buildSrConfigValues(
  spec: SrTechSpec,
  fields: SrConfigField[]
): Record<string, string> {
  const out: Record<string, string> = {};
  const dropdowns = fields.filter((f) => f.field_type === "dropdown");
  const pick = (re: RegExp) => dropdowns.find((f) => re.test(f.field_name));

  const assign = (
    field: SrConfigField | undefined,
    raw: string | null | undefined,
    fallbackLabel: string
  ) => {
    const v = raw == null ? "" : String(raw).trim();
    if (!v) return;
    if (field) out[field.field_name] = matchOptionValue(v, field.options) ?? v;
    else out[fallbackLabel] = v;
  };

  // Field-name keywords, matched against the ADMIN's own vocabulary (live
  // fields today: "SOLAR PANEL", "Battery", "Controller", "OPTIC", "CCT",
  // "OPTIONS", "Spigot ( for pole Ø )"). No sales LED field exists today,
  // so LED power lands under the fallback label — still visible on the line.
  assign(pick(/\bled\b/i), spec.led_power, "LED Power");
  assign(pick(/solar|panel/i), spec.solar_panel_size, "Solar Panel");
  assign(pick(/batter/i), spec.battery_spec, "Battery");
  assign(pick(/control/i), spec.controller, "Controller");

  if (spec.iot_required) {
    // checkbox_group values are stored as a JSON-stringified string[]
    // (ConfigFieldInput convention) — tick the category's own IOT option.
    const grp = fields.find(
      (f) =>
        f.field_type === "checkbox_group" &&
        f.options.some((o) => squash(o) === "iot")
    );
    if (grp) {
      const opt = grp.options.find((o) => squash(o) === "iot")!;
      out[grp.field_name] = JSON.stringify([opt]);
    } else {
      out["IoT"] = "Yes";
    }
  }

  return out;
}
