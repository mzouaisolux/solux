/**
 * Tests for the Product Lighting Setup validation + program normalization.
 * (lib/lighting/validate.ts)
 *
 * Run with:  npm test
 *
 * Pure (no DB / no server imports). These lock the launch gate the owner spec
 * requires: Energy Study uploaded, Lighting Power, Lighting Program, Operating
 * Hours and Approved Optics must ALL be present before Launch Production, and
 * the dimming program is a structured, order-preserving list of {output,
 * duration_hours} — never free text.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateLightingSetup,
  normalizeLightingProgram,
  isLightingProgramComplete,
  totalProgramHours,
  LIGHTING_INCOMPLETE_MESSAGE,
} from "../lib/lighting/validate.ts";
import type { LightingSetupInput } from "../lib/lighting/types.ts";

// A complete, valid setup — the baseline every test mutates from.
function completeSetup(): LightingSetupInput {
  return {
    lighting_power: 60,
    operating_hours: 12,
    lighting_program: [
      { output: 100, duration_hours: 5 },
      { output: 70, duration_hours: 2 },
      { output: 50, duration_hours: 5 },
    ],
    approved_optics: "Type III",
    energy_study_path: "lighting/doc-1/energy-study-123.pdf",
  };
}

// --- validateLightingSetup: happy path -------------------------------------

test("validateLightingSetup: a fully filled setup passes", () => {
  const v = validateLightingSetup(completeSetup());
  assert.equal(v.ok, true);
  assert.deepEqual(v.missing, []);
});

// --- validateLightingSetup: each required field blocks ---------------------

test("validateLightingSetup: missing Energy Study does NOT block (owner 2026-07-05 — documents are an aid, never an obligation; manual workflow is first-class)", () => {
  assert.equal(
    validateLightingSetup({ ...completeSetup(), energy_study_path: null }).ok,
    true
  );
  assert.equal(
    validateLightingSetup({ ...completeSetup(), energy_study_path: "   " }).ok,
    true
  );
});

test("validateLightingSetup: missing / non-positive Lighting Power blocks", () => {
  assert.ok(validateLightingSetup({ ...completeSetup(), lighting_power: null }).missing.includes("lighting_power"));
  assert.ok(validateLightingSetup({ ...completeSetup(), lighting_power: 0 }).missing.includes("lighting_power"));
  assert.ok(validateLightingSetup({ ...completeSetup(), lighting_power: -5 }).missing.includes("lighting_power"));
});

test("validateLightingSetup: empty Lighting Program blocks", () => {
  const v = validateLightingSetup({ ...completeSetup(), lighting_program: [] });
  assert.equal(v.ok, false);
  assert.ok(v.missing.includes("lighting_program"));
});

test("validateLightingSetup: program with a zero-duration period blocks", () => {
  const v = validateLightingSetup({
    ...completeSetup(),
    lighting_program: [{ output: 100, duration_hours: 0 }],
  });
  assert.ok(v.missing.includes("lighting_program"));
});

test("validateLightingSetup: missing Operating Hours blocks", () => {
  const v = validateLightingSetup({ ...completeSetup(), operating_hours: null });
  assert.ok(v.missing.includes("operating_hours"));
});

test("validateLightingSetup: missing Approved Optics blocks", () => {
  assert.ok(validateLightingSetup({ ...completeSetup(), approved_optics: null }).missing.includes("approved_optics"));
  assert.ok(validateLightingSetup({ ...completeSetup(), approved_optics: "  " }).missing.includes("approved_optics"));
});

test("validateLightingSetup: a totally empty setup reports every missing field (documents excluded — optional)", () => {
  const v = validateLightingSetup({
    lighting_power: null,
    operating_hours: null,
    lighting_program: [],
    approved_optics: null,
    energy_study_path: null,
  });
  assert.equal(v.ok, false);
  assert.deepEqual(
    [...v.missing].sort(),
    ["approved_optics", "lighting_power", "lighting_program", "operating_hours"].sort()
  );
});

test("the exact incomplete message is exported verbatim (owner spec)", () => {
  assert.equal(
    LIGHTING_INCOMPLETE_MESSAGE,
    "Product Lighting Setup is incomplete. Please complete the lighting configuration before launching production."
  );
});

// --- normalizeLightingProgram: coercion, order, clamping -------------------

test("normalizeLightingProgram: keeps valid periods in order", () => {
  const p = normalizeLightingProgram([
    { output: 100, duration_hours: 5 },
    { output: 50, duration_hours: 5 },
  ]);
  assert.deepEqual(p, [
    { output: 100, duration_hours: 5 },
    { output: 50, duration_hours: 5 },
  ]);
});

test("normalizeLightingProgram: coerces numeric strings", () => {
  const p = normalizeLightingProgram([{ output: "70", duration_hours: "2" }]);
  assert.deepEqual(p, [{ output: 70, duration_hours: 2 }]);
});

test("normalizeLightingProgram: clamps output to 0..100", () => {
  const p = normalizeLightingProgram([
    { output: 150, duration_hours: 1 },
    { output: -20, duration_hours: 1 },
  ]);
  assert.equal(p[0].output, 100);
  assert.equal(p[1].output, 0);
});

test("normalizeLightingProgram: drops malformed entries, never throws", () => {
  assert.deepEqual(normalizeLightingProgram(null), []);
  assert.deepEqual(normalizeLightingProgram("nope"), []);
  assert.deepEqual(normalizeLightingProgram([null, 1, "x", {}]), []);
  assert.deepEqual(normalizeLightingProgram([{ output: 100 }]), []); // no duration
});

test("normalizeLightingProgram: accepts `duration`/`hours` aliases", () => {
  assert.deepEqual(normalizeLightingProgram([{ output: 80, duration: 3 }]), [
    { output: 80, duration_hours: 3 },
  ]);
  assert.deepEqual(normalizeLightingProgram([{ output: 80, hours: 4 }]), [
    { output: 80, duration_hours: 4 },
  ]);
});

test("isLightingProgramComplete + totalProgramHours", () => {
  assert.equal(isLightingProgramComplete([]), false);
  assert.equal(isLightingProgramComplete([{ output: 100, duration_hours: 5 }]), true);
  assert.equal(
    totalProgramHours([
      { output: 100, duration_hours: 5 },
      { output: 50, duration_hours: 5 },
    ]),
    10
  );
});

// --- presence detection (SOLUX detector phases) ----------------------------

test("normalizeLightingProgram: preserves presence-detection metadata", () => {
  const p = normalizeLightingProgram([
    {
      output: 10,
      duration_hours: 11,
      presence_detection: true,
      detection_output: 100,
      detection_hold_seconds: 40,
      estimated_detections: 80,
    },
  ]);
  assert.deepEqual(p, [
    {
      output: 10,
      duration_hours: 11,
      presence_detection: true,
      detection_output: 100,
      detection_hold_seconds: 40,
      estimated_detections: 80,
    },
  ]);
});

test("normalizeLightingProgram: infers presence_detection from detection_output alone", () => {
  const p = normalizeLightingProgram([
    { output: 10, duration_hours: 5, detection_output: 100 },
  ]);
  assert.equal(p[0].presence_detection, true);
  assert.equal(p[0].detection_output, 100);
});

test("normalizeLightingProgram: a plain period carries no presence fields", () => {
  const p = normalizeLightingProgram([{ output: 100, duration_hours: 5 }]);
  assert.equal(p[0].presence_detection, undefined);
  assert.deepEqual(p, [{ output: 100, duration_hours: 5 }]);
});

test("validateLightingSetup: a presence-detection program is still complete", () => {
  const v = validateLightingSetup({
    ...completeSetup(),
    lighting_program: [
      { output: 100, duration_hours: 3 },
      {
        output: 10,
        duration_hours: 11,
        presence_detection: true,
        detection_output: 100,
        detection_hold_seconds: 40,
        estimated_detections: 80,
      },
      { output: 100, duration_hours: 2 },
    ],
  });
  assert.equal(v.ok, true);
});
