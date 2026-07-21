/**
 * Tests for the m176 tilt AI provenance (lib/tilt-provenance.ts).
 *
 * Run with:  npm test
 *
 * Pure (no DB / no server imports). Proves the two decisions that keep a
 * wrong tilt out of production:
 *   - SOURCE PRIORITY: the winning candidate is chosen by the owner's ranking,
 *     in code — not left to the model's own pick;
 *   - CONFLICT: an extraction NEVER silently overwrites a stored angle. It
 *     applies only into an empty field or when it agrees; anything else is
 *     pending human validation (this is the m159 bug the migration fixes);
 *   - normalization survives legacy/partial/garbage blobs.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeTiltProvenance,
  normalizeTiltCandidate,
  pickTiltCandidate,
  resolveExtraction,
  tiltConflictPending,
  cleanConfidence,
  type TiltCandidate,
} from "../lib/tilt-provenance.ts";

const cand = (
  value: number,
  basis: TiltCandidate["basis"] = null,
  page: number | null = null
): TiltCandidate => ({ value, basis, source_text: `Tilt = ${value}°`, source_page: page });

// ---------------------------------------------------------------------------
// Source priority
// ---------------------------------------------------------------------------

test("priority: the final recommended tilt beats every other basis", () => {
  const { picked, ambiguous } = pickTiltCandidate([
    cand(30, "general_default"),
    cand(15, "final_recommended"),
    cand(20, "simulation_input"),
  ]);
  assert.equal(picked?.value, 15);
  assert.equal(ambiguous, false);
});

test("priority: full ranking order is honoured", () => {
  const order: TiltCandidate["basis"][] = [
    "final_recommended",
    "product_specific",
    "project_installation",
    "simulation_input",
    "general_default",
  ];
  // Each basis must beat every basis below it.
  for (let i = 0; i < order.length - 1; i++) {
    const { picked } = pickTiltCandidate([cand(1, order[i + 1]), cand(2, order[i])]);
    assert.equal(picked?.value, 2, `${order[i]} should beat ${order[i + 1]}`);
  }
});

test("priority: a single candidate is never ambiguous", () => {
  const { picked, ambiguous } = pickTiltCandidate([cand(15)]);
  assert.equal(picked?.value, 15);
  assert.equal(ambiguous, false);
});

test("priority: no candidates → nothing picked, not ambiguous", () => {
  assert.deepEqual(pickTiltCandidate([]), { picked: null, ambiguous: false });
});

// ---------------------------------------------------------------------------
// Ambiguity — flagged for a human instead of guessed
// ---------------------------------------------------------------------------

test("ambiguity: two DIFFERENT values tied at the top rank flag for review", () => {
  const { ambiguous } = pickTiltCandidate([
    cand(15, "final_recommended"),
    cand(20, "final_recommended"),
  ]);
  assert.equal(ambiguous, true);
});

test("ambiguity: the SAME value stated twice at the top rank is not ambiguous", () => {
  const { picked, ambiguous } = pickTiltCandidate([
    cand(15, "final_recommended", 2),
    cand(15, "final_recommended", 7),
  ]);
  assert.equal(picked?.value, 15);
  assert.equal(ambiguous, false);
});

test("ambiguity: unranked candidates that disagree cannot justify a pick", () => {
  const { ambiguous } = pickTiltCandidate([cand(15), cand(25)]);
  assert.equal(ambiguous, true);
});

test("ambiguity: unranked duplicates of one value are fine", () => {
  const { picked, ambiguous } = pickTiltCandidate([cand(15), cand(15)]);
  assert.equal(picked?.value, 15);
  assert.equal(ambiguous, false);
});

// ---------------------------------------------------------------------------
// Conflict resolution — the m159 bug
// ---------------------------------------------------------------------------

test("conflict: an empty field takes the AI value", () => {
  assert.deepEqual(resolveExtraction(15, null, false), {
    resolution: "applied",
    writeValue: 15,
  });
});

test("conflict: agreement with the stored value writes nothing and settles", () => {
  assert.deepEqual(resolveExtraction(15, 15, false), {
    resolution: "applied",
    writeValue: null,
  });
});

test("conflict: DISAGREEMENT never overwrites production — it goes pending", () => {
  // The m159 regression: the task list is seeded from the SR, so this is the
  // path every real extraction takes. It must not silently drop the AI value
  // (old bug) and must not silently overwrite the drawing's angle either.
  assert.deepEqual(resolveExtraction(15, 30, false), {
    resolution: "pending",
    writeValue: null,
  });
});

test("conflict: an ambiguous study stays pending even on an EMPTY field", () => {
  assert.deepEqual(resolveExtraction(15, null, true), {
    resolution: "pending",
    writeValue: null,
  });
});

test("conflict: 0° is a real tilt, not an empty field", () => {
  // Guards the `?? null` / falsy-zero class of bug: a flat panel is 0°, and a
  // study stating 15° against it is a genuine conflict.
  assert.deepEqual(resolveExtraction(15, 0, false), {
    resolution: "pending",
    writeValue: null,
  });
  assert.deepEqual(resolveExtraction(0, 0, false), {
    resolution: "applied",
    writeValue: null,
  });
});

test("tiltConflictPending: only a pending resolution blocks", () => {
  const base = { value: 15, resolution: "pending" };
  assert.equal(tiltConflictPending(normalizeTiltProvenance(base)), true);
  for (const r of ["applied", "accepted_ai", "kept_manual"]) {
    assert.equal(
      tiltConflictPending(normalizeTiltProvenance({ ...base, resolution: r })),
      false,
      `${r} must not block`
    );
  }
  assert.equal(tiltConflictPending(null), false);
});

// ---------------------------------------------------------------------------
// Normalization — never trust the stored shape
// ---------------------------------------------------------------------------

test("normalize: null / junk / a value-less blob yield null", () => {
  assert.equal(normalizeTiltProvenance(null), null);
  assert.equal(normalizeTiltProvenance("15"), null);
  assert.equal(normalizeTiltProvenance({}), null);
  assert.equal(normalizeTiltProvenance({ confidence: 0.9 }), null);
  // Out of the physical 0–90 range → not a tilt at all.
  assert.equal(normalizeTiltProvenance({ value: 120 }), null);
});

test("normalize: a minimal blob gets safe defaults", () => {
  const p = normalizeTiltProvenance({ value: 15 })!;
  assert.equal(p.value, 15);
  assert.equal(p.unit, "degrees");
  assert.equal(p.resolution, "applied");
  assert.equal(p.ambiguous, false);
  assert.equal(p.manually_modified_after, false);
  assert.deepEqual(p.candidates, []);
  assert.equal(p.confidence, null);
});

test("normalize: units are stripped and confidence clamped to 0..1", () => {
  const p = normalizeTiltProvenance({
    value: "15°",
    confidence: 4.2,
    resolution: "nonsense",
    source_page: 0,
  })!;
  assert.equal(p.value, 15);
  assert.equal(p.confidence, 1);
  assert.equal(p.resolution, "applied", "an unknown resolution must not block a release");
  assert.equal(p.source_page, null, "page 0 is not a 1-based page");
});

test("normalize: the source sentence is flattened and bounded", () => {
  const p = normalizeTiltProvenance({
    value: 15,
    source_text: "Recommended tilt\n\n   angle:   15 degrees",
  })!;
  assert.equal(p.source_text, "Recommended tilt angle: 15 degrees");

  const long = normalizeTiltProvenance({ value: 15, source_text: "x".repeat(900) })!;
  assert.ok(long.source_text!.length <= 400);
  assert.ok(long.source_text!.endsWith("…"));
});

test("normalize: unusable candidates are dropped, good ones kept", () => {
  const p = normalizeTiltProvenance({
    value: 15,
    candidates: [
      { value: 15, basis: "final_recommended" },
      { value: 999 }, // out of range
      null,
      "junk",
      { value: 30, basis: "not-a-basis" }, // basis rejected, value kept
    ],
  })!;
  assert.equal(p.candidates.length, 2);
  assert.equal(p.candidates[0].basis, "final_recommended");
  assert.equal(p.candidates[1].value, 30);
  assert.equal(p.candidates[1].basis, null);
});

test("normalizeTiltCandidate: rejects non-objects and out-of-range values", () => {
  assert.equal(normalizeTiltCandidate(null), null);
  assert.equal(normalizeTiltCandidate({ value: -5 }), null);
  assert.equal(normalizeTiltCandidate({ value: 91 }), null);
  assert.equal(normalizeTiltCandidate({ value: 0 })?.value, 0);
});

test("cleanConfidence: clamps, and rejects junk", () => {
  assert.equal(cleanConfidence(0.87), 0.87);
  assert.equal(cleanConfidence(-1), 0);
  assert.equal(cleanConfidence(2), 1);
  assert.equal(cleanConfidence("nope"), null);
  assert.equal(cleanConfidence(undefined), null);
});
