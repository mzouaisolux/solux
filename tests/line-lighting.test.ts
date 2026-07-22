/**
 * Tests for the m180 per-line Lighting Setups + programming rules.
 *
 * Run with:  npm test
 *
 * Pure (no DB / no server imports). Proves the owner's confirmed decisions:
 *   - mode switches NEVER destroy data (outgoing state archived to history);
 *   - automatic stays editable (edit → review 'adjusted', recommendation kept);
 *   - apply-to-all is an independent COPY (mutating the copy never touches
 *     the source shape, provenance recorded);
 *   - status chips: required+empty=missing, auto+unreviewed=needs_review,
 *     not_applicable wins over everything;
 *   - rules: AND matchers, priority > specificity > strictness, glob SKU,
 *     default optional when nothing matches;
 *   - coherence validation (24h ceiling, stage bounds, hours mismatch warning).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  editedSetup,
  emptyLineValues,
  hasNewerStudy,
  lineLightingStatus,
  manualSetup,
  copiedSetup,
  normalizeLineLighting,
  setupFromRecommendation,
  switchToAutomatic,
  switchToManual,
  validateLineValues,
  type LineLightingRecommendation,
} from "../lib/lighting/line-setup.ts";
import {
  DEFAULT_OUTCOME,
  normalizeRule,
  resolveProgrammingRequirement,
  ruleSubjectFromLine,
  type ProgrammingRule,
} from "../lib/lighting/programming-rules.ts";

const NOW = "2026-07-22T10:00:00Z";
const REC: LineLightingRecommendation = {
  method: "energy_study",
  source_document: "Energy Study_45W_RV3.pdf",
  extracted_at: "2026-07-21T10:00:00Z",
  model: "claude-sonnet-4-6",
  confidence: { lighting_program: 0.97 },
  values: {
    operating_hours: 12,
    program: [
      { output: 100, duration_hours: 4 },
      { output: 50, duration_hours: 8 },
    ],
    control_mode: null,
  },
};

// ---------------------------------------------------------------------------
// Mode switches — nothing ever disappears
// ---------------------------------------------------------------------------

test("automatic → manual archives the outgoing state and keeps the recommendation", () => {
  const auto = setupFromRecommendation(REC, "u1", NOW);
  const manual = switchToManual(auto, "u2", "2026-07-22T11:00:00Z");
  assert.equal(manual.mode, "manual");
  assert.equal(manual.recommended?.source_document, REC.source_document); // still visible
  assert.equal(manual.history.length, 1);
  assert.equal(manual.history[0].event, "switched_to_manual");
  assert.deepEqual((manual.history[0].previous as any).final, auto.final);
});

test("manual → automatic archives the manual values before replacing", () => {
  const man = manualSetup(
    { ...emptyLineValues(), operating_hours: 6, program: [{ output: 70, duration_hours: 6 }] },
    "u1",
    NOW
  );
  const auto = switchToAutomatic(man, REC, "u2", "2026-07-22T11:00:00Z");
  assert.equal(auto.mode, "automatic");
  assert.equal(auto.final.operating_hours, 12); // recommendation applied
  assert.equal(auto.review.state, "unreviewed");
  const prev = auto.history[0].previous as any;
  assert.equal(auto.history[0].event, "switched_to_automatic");
  assert.equal(prev.final.operating_hours, 6); // manual values preserved
});

test("automatic stays EDITABLE — an edit marks 'adjusted' and keeps the recommendation", () => {
  const auto = setupFromRecommendation(REC, "u1", NOW);
  const edited = editedSetup(
    auto,
    { ...auto.final, operating_hours: 10 },
    "u2",
    "2026-07-22T12:00:00Z"
  );
  assert.equal(edited.mode, "automatic");
  assert.equal(edited.final.operating_hours, 10); // final = TLM's word
  assert.equal(edited.recommended?.values.operating_hours, 12); // study intact
  assert.equal(edited.review.state, "adjusted");
  assert.equal(edited.history[0].event, "edited");
});

// ---------------------------------------------------------------------------
// Apply-to-all — copy, never a link
// ---------------------------------------------------------------------------

test("copiedSetup is independent: mutating the copy never touches the source", () => {
  const src = setupFromRecommendation(REC, "u1", NOW);
  const copy = copiedSetup(src, "Product A", "u2", "2026-07-22T11:00:00Z");
  assert.equal(copy.source.kind, "copy");
  assert.equal(copy.source.copied_from, "Product A");
  copy.final.program[0].output = 1; // mutate the copy
  assert.equal(src.final.program[0].output, 100); // source untouched
});

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

test("status: not_applicable wins; required+empty=missing; auto+unreviewed=needs_review; confirmed=complete", () => {
  const auto = setupFromRecommendation(REC, "u1", NOW);
  assert.equal(lineLightingStatus("not_applicable", auto), "not_applicable");
  assert.equal(lineLightingStatus("required", null), "missing");
  assert.equal(lineLightingStatus("required", auto), "needs_review");
  const confirmed = { ...auto, review: { state: "confirmed" as const, by: "u1", at: NOW } };
  assert.equal(lineLightingStatus("required", confirmed), "complete");
  // Manual entry is reviewed by definition.
  const man = manualSetup(
    { ...emptyLineValues(), program: [{ output: 100, duration_hours: 4 }] },
    "u1",
    NOW
  );
  assert.equal(lineLightingStatus("optional", man), "complete");
});

// ---------------------------------------------------------------------------
// Coherence
// ---------------------------------------------------------------------------

test("validation: >24h total is an error, hours mismatch is a warning", () => {
  const over = validateLineValues({
    ...emptyLineValues(),
    program: [{ output: 100, duration_hours: 25 }],
  });
  assert.equal(over.errors.length, 1);
  const mismatch = validateLineValues({
    ...emptyLineValues(),
    operating_hours: 12,
    program: [{ output: 100, duration_hours: 4 }],
  });
  assert.equal(mismatch.errors.length, 0);
  assert.equal(mismatch.warnings.length, 1);
});

// ---------------------------------------------------------------------------
// Newer-study detection
// ---------------------------------------------------------------------------

test("hasNewerStudy: only when the extraction postdates the imported one", () => {
  const auto = setupFromRecommendation(REC, "u1", NOW);
  assert.equal(hasNewerStudy(auto, "2026-07-22T09:00:00Z"), true);
  assert.equal(hasNewerStudy(auto, "2026-07-20T09:00:00Z"), false);
  assert.equal(hasNewerStudy(auto, null), false);
  assert.equal(hasNewerStudy(null, "2026-07-22T09:00:00Z"), false);
});

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const rule = (over: Partial<ProgrammingRule>): ProgrammingRule => ({
  id: "r1",
  outcome: "required",
  priority: 0,
  category_id: null,
  product_id: null,
  sku_pattern: null,
  controller: null,
  config_match: null,
  active: true,
  notes: null,
  ...over,
});

const LINE = ruleSubjectFromLine({
  product_id: "p1",
  category_id: "cat-lum",
  product_sku: "SSLX-PRO-60",
  config_values: { Controller: "MPPT-X", Battery: "65Ah" },
});

test("subject derivation: controller found from config keys", () => {
  assert.equal(LINE.controller, "MPPT-X");
});

test("rules: matchers AND together; glob SKU works", () => {
  const r = rule({ category_id: "cat-lum", sku_pattern: "SSLX*" });
  assert.equal(resolveProgrammingRequirement(LINE, [r]).requirement, "required");
  const wrongCat = rule({ category_id: "cat-pole", sku_pattern: "SSLX*" });
  assert.equal(resolveProgrammingRequirement(LINE, [wrongCat]).requirement, DEFAULT_OUTCOME);
});

test("rules: priority beats specificity; specificity breaks ties", () => {
  const broad = rule({ id: "broad", outcome: "not_applicable", priority: 10, category_id: "cat-lum" });
  const specific = rule({ id: "spec", outcome: "required", priority: 0, product_id: "p1" });
  assert.equal(resolveProgrammingRequirement(LINE, [broad, specific]).rule?.id, "broad");
  const tieA = rule({ id: "a", outcome: "optional", category_id: "cat-lum" });
  const tieB = rule({ id: "b", outcome: "required", product_id: "p1" });
  assert.equal(resolveProgrammingRequirement(LINE, [tieA, tieB]).rule?.id, "b");
});

test("rules: default when nothing matches is OPTIONAL (documented decision)", () => {
  assert.equal(DEFAULT_OUTCOME, "optional");
  assert.equal(resolveProgrammingRequirement(LINE, []).requirement, "optional");
  const inactive = rule({ active: false });
  assert.equal(resolveProgrammingRequirement(LINE, [inactive]).requirement, "optional");
});

test("rules: normalize drops junk outcomes and empty config matchers", () => {
  assert.equal(normalizeRule({ id: "x", outcome: "banana" })?.outcome, "optional");
  assert.equal(normalizeRule({ id: "x", outcome: "required", config_match: {} })?.config_match, null);
  assert.equal(normalizeRule(null), null);
});

// ---------------------------------------------------------------------------
// Normalization round-trip
// ---------------------------------------------------------------------------

test("normalizeLineLighting: round-trips a real setup and rejects junk", () => {
  const auto = setupFromRecommendation(REC, "u1", NOW);
  const round = normalizeLineLighting(JSON.parse(JSON.stringify(auto)))!;
  assert.equal(round.mode, "automatic");
  assert.equal(round.final.operating_hours, 12);
  assert.equal(round.recommended?.confidence.lighting_program, 0.97);
  assert.equal(normalizeLineLighting(null), null);
  assert.equal(normalizeLineLighting("junk"), null);
});
