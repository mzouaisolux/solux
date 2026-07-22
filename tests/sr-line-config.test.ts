/**
 * Tests for the SR → task-list structured config backfill (OBS-1, E2E
 * « 14 juillet ») — lib/sr-line-config.ts.
 *
 * Run with:  npm test
 *
 * Pure (no DB). These lock the copy-time rule applied by
 * generateProductionTaskList: an SR-derived line with no real config gets a
 * config_values rebuilt from the SR spec, keyed by the category's REAL sales
 * fields — exact option value on a confident match, raw SR text otherwise
 * (raw values stay visible on the line and count as MISSING mappings, which
 * is what makes the release gate genuinely require a mapping pass).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSrConfigValues,
  isEmptyConfig,
  matchOptionValue,
  mergeSrConfig,
  type SrConfigField,
} from "../lib/sr-line-config.ts";

// Realistic field set — mirrors the live categories (field names + option
// shapes observed in production on 2026-07-14).
const FIELDS: SrConfigField[] = [
  {
    field_name: "SOLAR PANEL",
    field_type: "dropdown",
    options: ["18V/60W", "18V/72W", "18V/105W", "18V/140W", "Standard"],
  },
  {
    field_name: "Battery",
    field_type: "dropdown",
    options: ["230Wh", "307Wh", "538Wh", "691Wh", "768Wh", "922Wh"],
  },
  {
    field_name: "Controller",
    field_type: "dropdown",
    options: ["SES60-WB-W （微波感应-通讯方式-无线）", "MES60-4G-ZHAGA  ( IOT )"],
  },
  { field_name: "CCT", field_type: "dropdown", options: ["3000k", "4000k"] },
  {
    field_name: "OPTIONS",
    field_type: "checkbox_group",
    options: ["IOT", "HYBRID", "BIRD SPIKE"],
  },
];

// --- matchOptionValue -------------------------------------------------------

test("matchOptionValue: exact match ignoring case + spacing", () => {
  assert.equal(matchOptionValue("18v/140w", FIELDS[0].options), "18V/140W");
  assert.equal(matchOptionValue("922 Wh", FIELDS[1].options), "922Wh");
});

test("matchOptionValue: unambiguous numeric match resolves to the option", () => {
  // "140" appears in exactly one panel option → confident match.
  assert.equal(matchOptionValue("140", FIELDS[0].options), "18V/140W");
  assert.equal(matchOptionValue("691", FIELDS[1].options), "691Wh");
});

test("matchOptionValue: ambiguous or unknown values do NOT match", () => {
  // "200W" matches no option — keep raw (displayed + gated as missing).
  assert.equal(matchOptionValue("200W", FIELDS[0].options), null);
  // "60" appears in both "18V/60W" and… only one actually — use a truly
  // ambiguous case: "18" appears in every panel option.
  assert.equal(matchOptionValue("18", FIELDS[0].options), null);
  assert.equal(matchOptionValue("", FIELDS[0].options), null);
});

// --- buildSrConfigValues ----------------------------------------------------

test("build: SR spec lands under the category's real field names", () => {
  const cfg = buildSrConfigValues(
    {
      led_power: "60W",
      solar_panel_size: "140W",
      battery_spec: "922",
      controller: "MPPT",
      iot_required: true,
    },
    FIELDS
  );
  assert.deepEqual(cfg, {
    // No sales LED field exists → readable fallback label, value preserved.
    "LED Power": "60W",
    // Confident numeric matches take the OPTION's exact value → mappable.
    "SOLAR PANEL": "18V/140W",
    Battery: "922Wh",
    // Free text with no match stays RAW under the real field name.
    Controller: "MPPT",
    // checkbox_group convention: JSON-stringified string[].
    OPTIONS: JSON.stringify(["IOT"]),
  });
});

test("build: empty spec builds an empty config; nulls are skipped", () => {
  assert.deepEqual(buildSrConfigValues({}, FIELDS), {});
  assert.deepEqual(
    buildSrConfigValues(
      { led_power: null, solar_panel_size: "  ", iot_required: false },
      FIELDS
    ),
    {}
  );
});

test("build: category with no fields keeps everything under fallback labels", () => {
  const cfg = buildSrConfigValues(
    { solar_panel_size: "200W", battery_spec: "1500", iot_required: true },
    []
  );
  assert.deepEqual(cfg, {
    "Solar Panel": "200W",
    Battery: "1500",
    IoT: "Yes",
  });
});

// --- isEmptyConfig ----------------------------------------------------------

test("isEmptyConfig: null/{} and all-blank values are empty", () => {
  assert.equal(isEmptyConfig(null), true);
  assert.equal(isEmptyConfig({}), true);
  assert.equal(isEmptyConfig({ CCT: "  " }), true);
  assert.equal(isEmptyConfig({ CCT: "3000k" }), false);
});

// --- mergeSrConfig ----------------------------------------------------------

test("merge: field-keyed values supersede the generator's generic labels", () => {
  // The SR→quotation generator writes display labels ("Solar panel"…); once
  // the field-keyed values exist those labels would duplicate the same chips.
  const merged = mergeSrConfig(
    {
      "LED power": "60",
      "Solar panel": "140W",
      Battery: "922",
      "Tilt angle": "15°",
    },
    { "SOLAR PANEL": "18V/140W", Battery: "922Wh", "LED Power": "60" }
  );
  assert.deepEqual(merged, {
    "Tilt angle": "15°", // non-spec chip is kept
    "SOLAR PANEL": "18V/140W",
    Battery: "922Wh",
    "LED Power": "60",
  });
});

// P1-2 — the m181 SR wizard writes REAL field keys onto the line. Those are the
// sales team's own choices and must survive the legacy-spec backfill, while the
// specs the wizard did not cover still land.
test("merge: the line's own field-keyed value wins, the SR spec fills the gaps", () => {
  const merged = mergeSrConfig(
    // Chosen in the SR wizard (m181) — real config fields of the category that
    // are NOT spec display labels.
    { CCT: "4000K", OPTIC: "Type III" },
    { CCT: "3000K", Battery: "922Wh", Controller: "MPPT 20A" }
  );
  assert.deepEqual(merged, {
    CCT: "4000K", // the sales choice is NOT overwritten
    OPTIC: "Type III", // kept
    Battery: "922Wh", // gap filled from the SR spec
    Controller: "MPPT 20A", // gap filled from the SR spec
  });
});

// Known limitation, PRE-DATING m181 and deliberately left alone: the five spec
// display labels the generator writes squash to the same token as the live
// config fields ("SOLAR PANEL" → "solarpanel"), so mergeSrConfig cannot tell a
// generic duplicate from the category's real field. For those five the SR spec
// still wins. Distinguishing them would mean passing the category's field names
// into the merge — out of scope here; pinned by this test so a future change is
// a conscious one.
test("merge: for the 5 generic spec labels the SR spec still wins (documented limitation)", () => {
  const merged = mergeSrConfig(
    { "SOLAR PANEL": "18V/200W" },
    { "SOLAR PANEL": "18V/140W" }
  );
  assert.deepEqual(merged, { "SOLAR PANEL": "18V/140W" });
});

test("merge: an empty existing config keeps the pre-m181 behaviour (no-op precedence)", () => {
  const spec = { "SOLAR PANEL": "18V/140W", Battery: "922Wh" };
  assert.deepEqual(mergeSrConfig({}, spec), spec);
  assert.deepEqual(mergeSrConfig(null, spec), spec);
});

test("merge: a blank existing value counts as a gap, not as a choice", () => {
  const merged = mergeSrConfig(
    { "SOLAR PANEL": "   ", "Tilt angle": "15°" },
    { "SOLAR PANEL": "18V/140W" }
  );
  assert.equal(merged["SOLAR PANEL"], "18V/140W");
  assert.equal(merged["Tilt angle"], "15°");
});
