/**
 * Label-based spec-sheet extraction rules — TypeScript port of the Python
 * prototype `scripts/extract_spec_sheets.py` (v1.1). Pure: operates on already-
 * extracted PDF text, no PDF/Supabase deps, so it is unit-testable and reusable
 * by the `extractSpecSheet` server action.
 *
 * Rule-based only (no OCR, no LLM). One alias-aware rule per field + a thin
 * per-family overlay (Product = FAMILY, SKU = MODEL). MODEL = SKU per the
 * versioning qualifier. Colarsun/Relight are best-effort; unmatched required
 * fields set `layoutSuspect`.
 */

import type { ImportRow } from "./types";

/* ── transforms ─────────────────────────────────────────────────────────── */
const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
function num(s: string): string {
  let t = s.trim().replace(/\s+/g, "");
  t = t.includes(",") && t.includes(".") ? t.replace(/,/g, "") : t.replace(",", ".");
  return t;
}
const dims = (s: string) => collapse(s).replace(/\s*[xX×]\s*/g, " x ");
function certclean(s: string): string {
  const re = /IEC(?:\s*6\d{4})?|TUV|EMC|LM-?\s?79(?:-?\s?08)?|LM-?\s?80|IK\s?\d{1,2}\+?|IP\s?6\d|UKCA|ULOR|LVD|RoHS|\bCE\b/gi;
  const toks: string[] = [];
  const seen = new Set<string>();
  for (const m of s.matchAll(re)) {
    let t = m[0].replace(/\s+/g, "").toUpperCase().replace("IEC61", "IEC 61");
    if (t.startsWith("IEC 61")) continue; // drop cert-number bleed
    t = ({ LM79: "LM-79", LM7908: "LM-79", LM80: "LM-80" } as Record<string, string>)[t] ?? t;
    if (!seen.has(t)) {
      seen.add(t);
      toks.push(t);
    }
  }
  return toks.join(" / ");
}

/* ── rule table (mirrors BASE_RULES) ──────────────────────────────────────── */
type Kind = "number" | "text";
type Rule = {
  key: string;
  label: string;
  kind: Kind;
  unit: string;
  scope: "common" | "model";
  sort: number;
  pattern: RegExp | null; // null ⇒ value supplied from family SKU (product_code)
  xform: (s: string) => string;
  required: boolean;
};

// NOTE: `scope` here is the default used when extracting from a PDF (no scope
// column available). The CSV/Excel baseline is authoritative — the CSV import
// path honors each row's SCOPE column (see rowScope in actions.ts), so a scope
// set in the spreadsheet always wins over these defaults. Defaults below are
// aligned to the v16 classification: per-SKU physical values (flux, power,
// battery capacity, solar panel, dimensions, weights, light height, led qty)
// are `model`; family-wide values (efficiency, warranties, certs, LED, etc.)
// are `common`.
export const BASE_RULES: Rule[] = [
  r("nominal_flux", "Nominal flux", "number", "lm", "model", 10, /(?:Nominal flux|Flux nominal)\s*I?\s*(?:\d+\s*[x×]\s*)?([\d.,]+)\s*Lumens?/is, num, true),
  r("nominal_power", "Nominal power", "number", "W", "model", 20, /(?:Nominal power|Puissance nominale)\s*I?\s*(?:\d+\s*[x×]\s*)?([\d.,]+)\s*[Ww]atts?/is, num, true),
  r("efficiency", "Efficiency", "number", "lm/W", "common", 30, /Efficiency\s+([\d.,]+)\s*Lumens?\/Watts?/is, num, true),
  r("led", "LED", "text", "", "common", 40, /\b(?:Led|LED)\s+(PHILIPS\s+Luxeon\s+[\d\- ]+?)(?=\n)/is, collapse, true),
  r("led_lifetime", "LED lifetime", "text", "", "common", 50, /Lifetime\s+((?:Over|Plus de)[^\n]*?LM80)/is, collapse, true),
  r("optics", "Optics", "text", "", "common", 60, /Optics[ \t]+([^\n]*?\d{3,4}\s*K?\s*(?:to|à)\s*\d{3,4}\s*K[^\n]*)/is, collapse, true),
  r("battery_technology", "Battery technology", "text", "", "common", 90, /Technology\s+(Lithium Iron Phosphate\s*LI?FEPO4)/is, collapse, true),
  r("battery_capacity", "Battery capacity", "number", "Wh", "model", 100, /Capacity\s+([\d.,]+)\s*Wh/is, num, true),
  r("autonomy", "Autonomy", "text", "", "common", 110, /Autonomy\s+((?:Over\s*|>?\s*)24[^\n]*?charge)/is, collapse, true),
  r("charging_time", "Charging time", "text", "", "common", 120, /Charging time\s+([\d/\-]+)\s*Hours?/is, collapse, true),
  r("battery_lifespan", "Battery lifespan", "text", "", "common", 130, /Lifespan\s+(Over[^\n]*?DOD)/is, collapse, true),
  r("working_temp", "Working temperature", "text", "", "common", 140, /Working temp\s+(-?\d+\s*°?[cC][^\n]*?\))/is, collapse, true),
  r("solar_panel", "Solar panel", "text", "", "model", 150, /(?:Solar panel|Solar Panel)\s+([^\n]*?\d[^\n]*?\d?\s*(?:Wc|Watts|W)\b[^\n]*)/is, collapse, true),
  r("cells_type", "Solar cell type", "text", "", "common", 170, /(?:Cells type|Cells Type)\s+([\s\S]{0,70}?Grade A)/is, collapse, true),
  r("sensor", "Sensor", "text", "", "common", 190, /Sensor\s+((?:Microwaves?|PIR)[^\n]*?[Ss]ensor)/is, collapse, true),
  r("controller", "Controller", "text", "", "common", 195, /Controller\s+(MPPT[^\n]*)/is, collapse, false),
  r("cabling", "Cabling", "text", "", "common", 196, /Cabling\s+(Waterproof[^\n]*)/is, collapse, false),
  r("protection", "Protection", "text", "", "common", 197, /Protection\s+([^\n]*?(?:BMS|Battery Management)[^\n]*)/is, collapse, false),
  r("material", "Material", "text", "", "common", 200, /(?:Materials|Material)\s+([^\n]*?(?:luminium|aluminum|steel|Steel)[^\n]*)/is, collapse, true),
  r("installation", "Installation", "text", "", "common", 210, /Installation\s+([^\n]*)/is, collapse, false),
  r("pole_mounting", "Pole mounting", "text", "", "common", 215, /Pole mounting\s+(\d+\s*mm[^\n]*)/is, collapse, false),
  r("certifications", "Certifications", "text", "", "common", 240, /(IEC\s*\/\s*TUV[\s\S]{0,220})/is, certclean, true),
  r("warranty_pv", "PV performance warranty", "number", "years", "common", 250, /PV Panels?\s*-?\s*(\d+)\s*year/is, num, true),
  r("warranty_luminaire", "Luminaire warranty", "number", "years", "common", 260, /(\d+)\s*Years?\s+Limited Warranty/is, num, true),
  // new (v16) family-specific fields — common-scoped, all optional
  r("beam_angle", "Beam angle", "number", "deg", "common", 65, /Beam angle\s+([\d.,]+)\s*(?:°|deg(?:rees)?)?/is, num, false),
  r("wind_speed", "Wind speed resistance", "text", "", "common", 145, /Wind speed(?:\s+resistance)?\s+([^\n]*?(?:KM\s*\/\s*H|km\s*\/\s*h|m\s*\/\s*s)[^\n]*)/is, collapse, false),
  r("color", "Color", "text", "", "common", 205, /(?:Colou?r|Finish)\s+(Black|White|Grey|Gray|Silver|Anthracite|Bronze|Green)\b/is, collapse, false),
  // model-scoped
  r("light_height", "Light height", "text", "", "model", 300, /(?:Light height|Line height)\s+([^\n]*?(?:cm|meters|mètres|\dm|\d m)[^\n]*)/is, collapse, true),
  r("product_dimensions", "Product dimensions", "text", "mm", "model", 310, /Product\s+((?:\d+\s*\*\s*)?D?\s*[\d.,]+\s*(?:cm)?\s*[xX×]\s*H?\s*[\d.,]+\s*(?:cm)?(?:\s*[xX×]\s*[\d.,]+\s*(?:cm)?)?)/is, dims, true),
  r("carton_size", "Carton size", "text", "mm", "model", 320, /(?:Carton size|Carton)\s+(\d[\dxX×\s]*\d)/is, dims, true),
  r("net_weight", "Net weight", "number", "kg", "model", 330, /(?:Net weight|(?<!Gross )(?<!Gross)Weight)\s+([\d.,]+)\s*KG/is, num, true),
  r("gross_weight", "Gross weight", "number", "kg", "model", 335, /Gross weight\s+([\d.,]+)\s*KG/is, num, false),
  r("warranty_battery", "Battery & controller warranty", "number", "years", "common", 340, /Controller (?:&|and) Batteries\s*:?\s*(\d+)\s*year/is, num, true),
  // new (v16) family-specific fields — model-scoped, all optional
  r("led_quantity", "LED quantity", "text", "", "model", 45, /(?:LED quantity|LEDs?\s+quantity|Number of LEDs?)\s+([^\n]*)/is, collapse, false),
  r("solar_panel_luminaire", "Solar panel (luminaire)", "text", "", "model", 155, /Solar panel\s*\(\s*luminaire\s*\)\s+([^\n]*)/is, collapse, false),
  r("number_of_colarsun", "Number of Colarsun modules", "number", "", "model", 305, /Number of Colarsun(?:\s+modules)?\s+(\d+)/is, num, false),
  r("product_code", "Product code", "text", "", "model", 350, null, collapse, true),
];

function r(
  key: string, label: string, kind: Kind, unit: string,
  scope: "common" | "model", sort: number, pattern: RegExp | null,
  xform: (s: string) => string, required: boolean
): Rule {
  return { key, label, kind, unit, scope, sort, pattern, xform, required };
}

/* ── per-family overlay (Product = FAMILY) with per-variant SKUs ────────────
   Family is detected by signature (longest match wins, so "Totem (+)" beats
   "Totem"). The SKU is then resolved from the filename's variant token — the
   segment AFTER the family name and BEFORE "EN"/year — with the longest
   normalized key matching (so "DUAL50" beats "50", and the year 2025 can't be
   read as variant "20"). Single-variant families use the "" key.
   Data reconciled to the classification (Current Catalog). */
type Family = { sig: string; family: string; ptype: string; variants: Record<string, string> };
export const FAMILIES: Family[] = [
  { sig: "AOS Perf", family: "AOS Performance", ptype: "street", variants: { "100": "APF-100", "120": "APF-120", "40": "APF-40", "50": "APF-50", "60": "APF-60", "80": "APF-80" } },
  { sig: "AOS Pro", family: "AOS Pro⁺", ptype: "street", variants: { "80": "AP+80" } },
  { sig: "Totem", family: "Totem", ptype: "street", variants: { "20": "TT-20", "40": "TT-40", "60": "TT-60" } },
  { sig: "Totem (+)", family: "Totem⁺", ptype: "street", variants: { "20": "TT+-20", "40": "TT+-40", "DUAL20": "TT+-DUAL 20", "DUAL30": "TT+-DUAL 30", "60": "TT+-60" } },
  { sig: "Relight", family: "ReLight Series", ptype: "street", variants: { "DUAL": "RL-DUAL", "SINGLE": "RL-60" } },
  { sig: "SSLX Perf", family: "SSLX Performance", ptype: "street", variants: { "100": "SX-100", "120": "SX-120", "40": "SX-40", "60": "SX-60", "80": "SX-80", "DUAL50": "SX-D50" } },
  { sig: "SSLX Pro", family: "SSLX Pro", ptype: "street", variants: { "100": "SP-100", "120": "SP-120", "30": "SP-30", "40": "SP-40", "60": "SP-60", "80": "SP-80", "DUAL50": "SP-D50" } },
  { sig: "Colarsun", family: "Colarsun", ptype: "multi", variants: { "20": "CS-20", "30": "CS-30", "40": "CS-40", "60": "CS-60", "90": "CS-90", "DUAL20": "CS-D20", "DUAL30": "CS-D30", "DUAL45": "CS-D45" } },
  { sig: "Ada", family: "Ada", ptype: "bollard", variants: { "B45": "SL-021 45", "B80": "SL-021 80", "E45": "SL-021 NB", "M45": "BW-021" } },
  { sig: "Kansa", family: "Kansa", ptype: "bollard", variants: { "": "SL-005" } },
  { sig: "Koron", family: "Koron", ptype: "bollard", variants: { "45": "SL-013 45", "80": "SL-013 80", "M45": "BW-013" } },
  { sig: "Koto", family: "Koto", ptype: "bollard", variants: { "": "SL-014" } },
  { sig: "Mara", family: "Mara", ptype: "bollard", variants: { "": "SL-019" } },
  { sig: "Mira", family: "Mira", ptype: "bollard", variants: { "": "SL-006" } },
  { sig: "Ror", family: "Ror", ptype: "bollard", variants: { "110": "SL-002 110", "80": "SL-002 80" } },
  { sig: "Slinda", family: "Slinda", ptype: "bollard", variants: { "100": "SL-015 100", "80": "SL-015 80" } },
  { sig: "Vandal", family: "Vandal", ptype: "bollard", variants: { "B45": "VDL B-45", "B80": "VDL B-80", "E100": "VDL E-100", "E65": "VDL E-65" } },
];

export type FamilyMatch = { family: string; sku: string; ptype: string; variantMatched: boolean };

const normVariant = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** The filename segment after the family signature and before EN/language/year. */
function variantSegment(filename: string, sig: string): string {
  let s = filename.replace(/\.pdf$/i, "");
  const idx = s.toLowerCase().indexOf(sig.toLowerCase());
  if (idx >= 0) s = s.slice(idx + sig.length);
  s = s.split(/\b(?:EN|En|FR|Fr|20\d\d)\b/)[0]; // drop language + year tail
  return normVariant(s);
}

/** Detect family by signature (longest match), then resolve SKU by variant. */
export function matchFamily(filename: string): FamilyMatch | null {
  const lower = filename.toLowerCase();
  const cands = FAMILIES.filter((x) => lower.includes(x.sig.toLowerCase()));
  if (cands.length === 0) return null;
  const fam = cands.sort((a, b) => b.sig.length - a.sig.length)[0];

  const keys = Object.keys(fam.variants);
  if (keys.length === 1 && keys[0] === "") {
    return { family: fam.family, sku: fam.variants[""], ptype: fam.ptype, variantMatched: true };
  }
  const seg = variantSegment(filename, fam.sig);
  const hit = keys
    .filter((k) => k !== "" && seg.includes(k))
    .sort((a, b) => b.length - a.length)[0];
  return {
    family: fam.family,
    sku: hit ? fam.variants[hit] : "",
    ptype: fam.ptype,
    variantMatched: Boolean(hit),
  };
}

export type ExtractResult = {
  family: string | null;
  sku: string | null;
  ptype: string | null;
  rows: ImportRow[];
  missingRequired: string[];
  layoutSuspect: boolean;
  warnings: string[];
};

const emptyRow = (): ImportRow => ({
  family: "", model: "", field_key: "", label: "", value_kind: "", unit: "", value: "", scope: "", sort: "",
});

/** Extract import rows from already-extracted PDF text + the source filename. */
export function extractFromText(filename: string, text: string): ExtractResult {
  const fam = matchFamily(filename);
  if (!fam) {
    return { family: null, sku: null, ptype: null, rows: [], missingRequired: [], layoutSuspect: false,
      warnings: [`No family matched filename "${filename}".`] };
  }
  const rows: ImportRow[] = [];
  const missing: string[] = [];
  const warnings: string[] = [];
  if (!fam.sku) {
    warnings.push(
      `Detected family "${fam.family}" but couldn't resolve the model/SKU from the filename — set MODEL manually before importing.`
    );
  }

  for (const rule of BASE_RULES) {
    let value: string;
    let kind: Kind = rule.kind;
    let unit = rule.unit;
    if (rule.key === "product_code") {
      value = fam.sku;
    } else {
      const m = rule.pattern ? rule.pattern.exec(text) : null;
      if (!m) {
        if (rule.required) missing.push(rule.key);
        continue;
      }
      value = rule.xform(m[1]);
    }
    if (rule.key === "light_height") {
      const mn = /^(\d+)\s*cm$/i.exec(value.trim());
      if (mn) { kind = "number"; unit = "cm"; value = mn[1]; }
    }
    rows.push({
      ...emptyRow(),
      family: fam.family,
      model: rule.scope === "common" ? "" : fam.sku,
      field_key: rule.key,
      label: rule.label,
      value_kind: kind,
      unit,
      value,
      scope: rule.scope,
      sort: String(rule.sort),
    });
  }
  return {
    family: fam.family, sku: fam.sku, ptype: fam.ptype,
    rows, missingRequired: missing, layoutSuspect: missing.length > 0,
    warnings,
  };
}
