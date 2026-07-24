/**
 * Knowledge Hub — TS extraction engine (extractFromText). Validates the ported
 * rule table behaves in JS on real spec-sheet text: family/SKU detection,
 * numeric + text fields, cert-token rebuild, light-height promotion, and the
 * layout-change guard (missing required ⇒ layoutSuspect).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { extractFromText, matchFamily } from "../features/product-knowledge-hub/lib/extractRules.ts";

// Faithful excerpt of the Vandal B45 spec-table text (as extracted from the PDF).
const VANDAL_B45 = `Vandal
Model I B45
Nominal flux I 588 Lumens
Nominal power I 3 watts
Lighting
Efficiency 196 Lumens/Watt
Led PHILIPS Luxeon 30-30
Lifetime Over 100.000 Hrs - LM80
Optics Asymetric & Symetric I 2300 to 6000 K I DUAL CCT OPTIONAL
Light height 45cm
Battery
Technology Lithium Iron Phosphate LIFEPO4
Capacity 38Wh
Autonomy Over 24 hours at full charge
Charging time 6 Hours
Lifespan Over 5000 CYCLES @ 50% DOD
Working temp -10°C to 70 °C (optional -40°C TO 70°C )
Solar panel 6,3 Wc
Cells type Monocrystaline Panel Grade A
Product 450x 280 x 280 Certificate IEC 61215 - IEC 61730 I and II
Carton size 530 x 730 x 770 (4 pcs / Ctn)
Net weight 4,2 KG
Sensor Microwave 270° Motion Sensor
Material Aluminium & polycarbonate
Certifications
IEC / TUV / EMC / LM-80 test standards / IK10 / IP67 / CE / ULOR / UKCA
PV Panels - 25 year performance warranty Controller & Batteries : 3 years
Solux offers a 5 Years Limited Warranty for the Vandal Series
`;

const FNAME = "SOLUX I Spec Sheet I Vandal - B45 EN 2025.pdf";

function byKey(rows: ReturnType<typeof extractFromText>["rows"]) {
  const m = new Map<string, { value: string; unit: string; kind: string; scope: string }>();
  for (const r of rows) m.set(r.field_key, { value: r.value, unit: r.unit, kind: r.value_kind, scope: r.scope });
  return m;
}

test("matches family + SKU from filename", () => {
  const f = matchFamily(FNAME);
  assert.equal(f?.family, "Vandal");
  assert.equal(f?.sku, "VDL B-45");
});

test("extracts numeric and text fields correctly", () => {
  const res = extractFromText(FNAME, VANDAL_B45);
  const m = byKey(res.rows);
  assert.equal(res.family, "Vandal");
  assert.equal(m.get("nominal_flux")?.value, "588");
  assert.equal(m.get("nominal_power")?.value, "3");
  assert.equal(m.get("battery_capacity")?.value, "38");
  assert.equal(m.get("net_weight")?.value, "4.2"); // comma → dot
  assert.equal(m.get("solar_panel")?.value, "6,3 Wc");
  assert.equal(m.get("product_code")?.value, "VDL B-45");
  assert.equal(m.get("sensor")?.value, "Microwave 270° Motion Sensor");
});

test("light height promotes to a number when purely '<n> cm'", () => {
  const m = byKey(extractFromText(FNAME, VANDAL_B45).rows);
  assert.equal(m.get("light_height")?.kind, "number");
  assert.equal(m.get("light_height")?.unit, "cm");
  assert.equal(m.get("light_height")?.value, "45");
});

test("certifications rebuilt from token whitelist (IK10, not IK1)", () => {
  const m = byKey(extractFromText(FNAME, VANDAL_B45).rows);
  assert.equal(m.get("certifications")?.value, "IEC / TUV / EMC / LM-80 / IK10 / IP67 / CE / ULOR / UKCA");
});

test("working temp keeps the leading minus", () => {
  const m = byKey(extractFromText(FNAME, VANDAL_B45).rows);
  assert.match(m.get("working_temp")?.value ?? "", /^-10°C to 70/);
});

test("scope: per-SKU fields are model, family-wide fields are common", () => {
  const m = byKey(extractFromText(FNAME, VANDAL_B45).rows);
  // Per-SKU physical values → model (aligned to the v16 Excel classification).
  assert.equal(m.get("nominal_flux")?.scope, "model");
  assert.equal(m.get("nominal_power")?.scope, "model");
  assert.equal(m.get("battery_capacity")?.scope, "model");
  assert.equal(m.get("product_code")?.scope, "model");
  // Family-wide values → common.
  assert.equal(m.get("efficiency")?.scope, "common");
  assert.equal(m.get("warranty_battery")?.scope, "common");
});

test("resolves the correct SKU per variant from the filename", () => {
  const cases: [string, string, string][] = [
    // SSLX Pro — every variant
    ["TEST-APP-SOLUX I Spec Sheet I SSLX Pro 30-EN.pdf", "SSLX Pro", "SP-30"],
    ["TEST-APP-SOLUX I Spec Sheet I SSLX Pro 40 EN 2025.pdf", "SSLX Pro", "SP-40"],
    ["TEST-APP-SOLUX I Spec Sheet I SSLX Pro 60-EN.pdf", "SSLX Pro", "SP-60"],
    ["TEST-APP-SOLUX I Spec Sheet I SSLX Pro 80-EN.pdf", "SSLX Pro", "SP-80"],
    ["TEST-APP-SOLUX I Spec Sheet I SSLX Pro 100 EN 2025.pdf", "SSLX Pro", "SP-100"],
    ["TEST-APP-SOLUX I Spec Sheet I SSLX Pro 120 EN 2025.pdf", "SSLX Pro", "SP-120"],
    ["TEST-APP-SOLUX I Spec Sheet I SSLX Pro Dual 50 EN 2025.pdf", "SSLX Pro", "SP-D50"],
    // year 2025 must NOT be read as variant "20"
    ["SOLUX I Spec Sheet I Colarsun 90 EN 2025.pdf", "Colarsun", "CS-90"],
    ["SOLUX I Spec Sheet I Colarsun Dual 20 EN 2025.pdf", "Colarsun", "CS-D20"],
    // Totem vs Totem⁺ disambiguation
    ["SOLUX I Spec Sheet I Totem 20 EN 2025.pdf", "Totem", "TT-20"],
    ["SOLUX I Spec Sheet I Totem (+) - 20 EN 2025.pdf", "Totem⁺", "TT+-20"],
    // Vandal / Ada letter-variants
    ["SOLUX I Spec Sheet I Vandal - E100 EN 2025.pdf", "Vandal", "VDL E-100"],
    ["SOLUX I Spec Sheet I Vandal - E65 EN 2025.pdf", "Vandal", "VDL E-65"],
    ["SOLUX I Spec Sheet I Ada B45 - EN.pdf", "Ada", "SL-021 45"],
    // single-variant family
    ["SOLUX I Spec Sheet I Kansa-EN.pdf", "Kansa", "SL-005"],
  ];
  for (const [file, family, sku] of cases) {
    const m = matchFamily(file);
    assert.equal(m?.family, family, `family for ${file}`);
    assert.equal(m?.sku, sku, `sku for ${file}`);
    assert.equal(m?.variantMatched, true, `variantMatched for ${file}`);
  }
});

// Bollard-style sheet carrying the v16 family-specific fields.
const KORON_45 = `Koron
Model I 45
Nominal flux I 588 Lumens
Nominal power I 3 watts
Beam angle 111°
LED quantity 2*40
Wind speed resistance 160KM/H
Solar panel (luminaire) 33 Watts /18V
Number of Colarsun modules 2
Color Black
`;
const KORON_FNAME = "SOLUX I Spec Sheet I Koron 45 EN 2025.pdf";

test("extracts the v16 family-specific fields with correct scope/kind", () => {
  const res = extractFromText(KORON_FNAME, KORON_45);
  const m = byKey(res.rows);
  assert.equal(m.get("beam_angle")?.value, "111");
  assert.equal(m.get("beam_angle")?.kind, "number");
  assert.equal(m.get("beam_angle")?.unit, "deg");
  assert.equal(m.get("beam_angle")?.scope, "common");
  assert.equal(m.get("led_quantity")?.value, "2*40");
  assert.equal(m.get("led_quantity")?.scope, "model");
  assert.equal(m.get("wind_speed")?.value, "160KM/H");
  assert.equal(m.get("solar_panel_luminaire")?.value, "33 Watts /18V");
  assert.equal(m.get("solar_panel_luminaire")?.scope, "model");
  assert.equal(m.get("number_of_colarsun")?.value, "2");
  assert.equal(m.get("number_of_colarsun")?.kind, "number");
  assert.equal(m.get("color")?.value, "Black");
});

test("v16 fields are optional — absence does not trip the layout guard", () => {
  // The Vandal fixture carries none of the new fields; they must simply be absent.
  const res = extractFromText(FNAME, VANDAL_B45);
  const m = byKey(res.rows);
  assert.equal(m.has("beam_angle"), false);
  assert.equal(m.has("led_quantity"), false);
  assert.equal(res.missingRequired.includes("beam_angle"), false);
});

test("layout guard fires on drifted text", () => {
  const res = extractFromText(FNAME, "Model I B45\nsome redesigned layout with no known labels");
  assert.equal(res.layoutSuspect, true);
  assert.ok(res.missingRequired.includes("nominal_flux"));
});
