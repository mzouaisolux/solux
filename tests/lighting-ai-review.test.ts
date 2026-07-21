/**
 * Tests for the phase-2 AI review states (lib/lighting/ai-review.ts).
 *
 * Run with:  npm test
 *
 * Pure (no DB / no server imports). Proves the correction-detection rules:
 *   - a save whose value differs from the AI's stamps `corrected` with both
 *     values, who and when;
 *   - a save matching the AI changes NOTHING (matching is not review, and an
 *     earlier correction is history a later identical save must not erase);
 *   - a correction overwrites an earlier confirmation (newest human act wins);
 *   - normalization drops junk states/fields.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyCorrectionsAfterSave,
  normalizeAiReview,
  AI_REVIEWABLE_FIELDS,
} from "../lib/lighting/ai-review.ts";

const NOW = "2026-07-21T12:00:00Z";
const AI = { lighting_power: 15, operating_hours: 12, lighting_program: [{ output: 100, duration_hours: 5 }] };
const SAVED_SAME = { lighting_power: 15, operating_hours: 12, lighting_program: [{ output: 100, duration_hours: 5 }] };

test("saving a DIFFERENT value stamps corrected with both values + audit", () => {
  const r = applyCorrectionsAfterSave({
    aiFields: AI,
    existingReview: {},
    saved: { ...SAVED_SAME, lighting_power: 20 },
    userId: "u1",
    now: NOW,
  });
  assert.deepEqual(Object.keys(r), ["lighting_power"]);
  assert.equal(r.lighting_power!.state, "corrected");
  assert.equal(r.lighting_power!.ai_value, 15);
  assert.equal(r.lighting_power!.saved_value, 20);
  assert.equal(r.lighting_power!.by, "u1");
  assert.equal(r.lighting_power!.at, NOW);
});

test("saving values MATCHING the AI changes nothing — matching is not review", () => {
  const r = applyCorrectionsAfterSave({
    aiFields: AI,
    existingReview: {},
    saved: SAVED_SAME,
    userId: "u1",
    now: NOW,
  });
  assert.deepEqual(r, {});
});

test("an earlier correction survives a later identical save (history, not state)", () => {
  const prior = {
    operating_hours: { state: "corrected" as const, by: "u0", at: "2026-07-20T00:00:00Z", ai_value: 12, saved_value: 13 },
  };
  const r = applyCorrectionsAfterSave({
    aiFields: AI,
    existingReview: prior,
    saved: SAVED_SAME, // hours back to the AI value
    userId: "u1",
    now: NOW,
  });
  assert.deepEqual(r.operating_hours, prior.operating_hours);
});

test("a correction OVERWRITES an earlier confirmation — the newer human act wins", () => {
  const r = applyCorrectionsAfterSave({
    aiFields: AI,
    existingReview: { lighting_power: { state: "confirmed", by: "u0", at: "2026-07-20T00:00:00Z" } },
    saved: { ...SAVED_SAME, lighting_power: 18 },
    userId: "u1",
    now: NOW,
  });
  assert.equal(r.lighting_power!.state, "corrected");
  assert.equal(r.lighting_power!.by, "u1");
});

test("program changes detected by content (order/values), null AI program ignored", () => {
  const changed = applyCorrectionsAfterSave({
    aiFields: AI,
    existingReview: {},
    saved: { ...SAVED_SAME, lighting_program: [{ output: 80, duration_hours: 5 }] },
    userId: "u1",
    now: NOW,
  });
  assert.equal(changed.lighting_program!.state, "corrected");

  const noAi = applyCorrectionsAfterSave({
    aiFields: { lighting_power: null, operating_hours: null, lighting_program: null },
    existingReview: {},
    saved: { ...SAVED_SAME, lighting_power: 99 },
    userId: "u1",
    now: NOW,
  });
  assert.deepEqual(noAi, {}); // nothing AI-extracted → nothing to correct
});

test("REGRESSION: key order / representation differences are NOT corrections", () => {
  // Caught live 2026-07-21: normalizeLightingProgram rebuilds periods with a
  // different key order than the stored AI blob — content-equal programs were
  // stamped `corrected` with identical ai/saved values. Canonical compare.
  const r = applyCorrectionsAfterSave({
    aiFields: {
      lighting_power: 15,
      operating_hours: 16,
      lighting_program: [
        { output: 10, duration_hours: 11, detection_output: 100, presence_detection: true, estimated_detections: 80, detection_hold_seconds: 40 } as any,
      ],
    },
    existingReview: {},
    saved: {
      lighting_power: 15,
      operating_hours: 16,
      lighting_program: [
        { output: 10, duration_hours: 11, presence_detection: true, detection_output: 100, detection_hold_seconds: 40, estimated_detections: 80 } as any,
      ],
    },
    userId: "u1",
    now: NOW,
  });
  assert.deepEqual(r, {});
});

test("normalizeAiReview: keeps valid entries, drops junk fields and states", () => {
  const r = normalizeAiReview({
    lighting_power: { state: "confirmed", by: "u1", at: NOW },
    operating_hours: { state: "wat" },
    tilt_angle: { state: "confirmed" }, // m176 owns tilt — not reviewable here
    junk: 42,
  });
  assert.deepEqual(Object.keys(r), ["lighting_power"]);
  assert.equal(normalizeAiReview(null) && Object.keys(normalizeAiReview(null)).length, 0);
  assert.equal(AI_REVIEWABLE_FIELDS.length, 3);
});
