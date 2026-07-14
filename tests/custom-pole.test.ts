/**
 * Tests for the custom-pole (mât) quotation-line helper (lib/custom-pole.ts).
 *
 * Run with:  npm test
 *
 * Pure (no DB / no server imports). Covers the description wording from the
 * owner's spec examples, the round-trip through config_values, the
 * discriminator, and the "at least one height" rule.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  POLE_LINE_TYPE,
  emptyPoleSpec,
  buildPoleDescription,
  isCustomPoleLine,
  isCustomPoleConfig,
  poleSpecToConfigValues,
  poleSpecFromConfigValues,
  validatePoleSpec,
  type PoleSpec,
} from "../lib/custom-pole.ts";

const base: PoleSpec = {
  heightReference: "total_pole_height",
  totalPoleHeightM: 8,
  lightPointHeightM: null,
  armType: "single_arm",
  armLengthM: 1.5,
  thicknessMm: 4,
  surfaceTreatment: "hot_dip_galvanized",
  painting: true,
  ralColor: null,
  note: null,
};

test("spec example 1 — overall pole height, single arm, galvanized, painting", () => {
  assert.equal(
    buildPoleDescription(base),
    "Custom pole – overall pole height 8m, single arm, arm length 1.5m, thickness 4mm, hot-dip galvanized, painting included"
  );
});

test("spec example 2 — light mounting height reference", () => {
  assert.equal(
    buildPoleDescription({
      ...base,
      heightReference: "light_point_height",
      totalPoleHeightM: null,
      lightPointHeightM: 7,
    }),
    "Custom pole – light mounting height 7m, single arm, arm length 1.5m, thickness 4mm, hot-dip galvanized, painting included"
  );
});

test("spec example 3 — both heights, chosen reference leads", () => {
  assert.equal(
    buildPoleDescription({ ...base, totalPoleHeightM: 8, lightPointHeightM: 7 }),
    "Custom pole – overall pole height 8m, light mounting height 7m, single arm, arm length 1.5m, thickness 4mm, hot-dip galvanized, painting included"
  );
});

test("spec example 4 — double arm, C5 treatment, no painting", () => {
  assert.equal(
    buildPoleDescription({
      ...base,
      heightReference: "light_point_height",
      totalPoleHeightM: null,
      lightPointHeightM: 7,
      armType: "double_arm",
      surfaceTreatment: "c5",
      painting: false,
    }),
    "Custom pole – light mounting height 7m, double arm, arm length 1.5m, thickness 4mm, C5 treatment, no painting"
  );
});

test("no arm omits arm length; painting RAL is appended", () => {
  const s: PoleSpec = {
    ...base,
    armType: "no_arm",
    armLengthM: 2, // ignored because no arm
    painting: true,
    ralColor: "RAL 7016",
  };
  const d = buildPoleDescription(s);
  assert.ok(d.includes("no arm"), d);
  assert.ok(!d.includes("arm length"), d);
  assert.ok(d.includes("painting included (RAL 7016)"), d);
});

test("config_values round-trip + discriminator", () => {
  const cv = poleSpecToConfigValues(base);
  assert.equal(cv.line_type, POLE_LINE_TYPE);
  assert.ok(isCustomPoleConfig(cv));
  assert.ok(isCustomPoleLine({ config_values: cv }));
  assert.ok(!isCustomPoleLine({ config_values: { SOLAR: "x" } }));
  assert.ok(!isCustomPoleLine({ config_values: null }));
  const back = poleSpecFromConfigValues(cv);
  assert.deepEqual(back, base);
  assert.equal(poleSpecFromConfigValues({ line_type: "other" }), null);
});

test("at-least-one-height rule — never blocks when one is known", () => {
  assert.equal(validatePoleSpec(base), null); // total only
  assert.equal(
    validatePoleSpec({ ...base, totalPoleHeightM: null, lightPointHeightM: 7 }),
    null
  ); // light point only
  assert.match(
    validatePoleSpec({ ...base, totalPoleHeightM: null, lightPointHeightM: null }) ?? "",
    /at least one height/i
  );
});

test("emptyPoleSpec is a valid starting point (defaults set, no heights yet)", () => {
  const e = emptyPoleSpec();
  assert.equal(e.heightReference, "light_point_height"); // #4 — primary = light mounting height
  assert.equal(e.armType, "single_arm");
  assert.ok(validatePoleSpec(e)); // needs a height before it's valid
});
