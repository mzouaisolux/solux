/**
 * Tests for the Approved Optics production synthesis (lib/lighting/optics.ts).
 *
 * Run with:  npm test
 *
 * Pure. These lock the ⇄ serialization between the structured breakdown the UI
 * edits ("T35 → 3 luminaires") and the canonical `approved_optics` TEXT column
 * ("T35 ×3 + T38 ×3"), plus the Dialux aggregation (per-optic luminaire sums).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatApprovedOptics,
  parseApprovedOptics,
  aggregateDialuxOptics,
  sameOpticsBreakdown,
} from "../lib/lighting/optics.ts";
import type { DialuxConfiguration } from "../lib/lighting/types.ts";

function config(over: Partial<DialuxConfiguration>): DialuxConfiguration {
  return {
    label: null,
    power: null,
    mounting_height: null,
    optic_code: null,
    optic_lens_type: null,
    optic_beam_distribution: null,
    cct: null,
    quantity: null,
    confidence: {},
    ...over,
  };
}

// --- format ------------------------------------------------------------------

test("formatApprovedOptics: breakdown with quantities → canonical string", () => {
  assert.equal(
    formatApprovedOptics([
      { optic: "T35", quantity: 3 },
      { optic: "T38", quantity: 3 },
    ]),
    "T35 ×3 + T38 ×3"
  );
});

test("formatApprovedOptics: unknown quantity → plain optic name; blanks dropped", () => {
  assert.equal(
    formatApprovedOptics([
      { optic: "Type III", quantity: null },
      { optic: "  ", quantity: 4 },
    ]),
    "Type III"
  );
});

// --- parse -------------------------------------------------------------------

test("parseApprovedOptics: canonical round-trip", () => {
  assert.deepEqual(parseApprovedOptics("T35 ×3 + T38 ×3"), [
    { optic: "T35", quantity: 3 },
    { optic: "T38", quantity: 3 },
  ]);
});

test("parseApprovedOptics: legacy plain values keep working", () => {
  assert.deepEqual(parseApprovedOptics("Type III"), [
    { optic: "Type III", quantity: null },
  ]);
  assert.deepEqual(parseApprovedOptics("T35 + T38"), [
    { optic: "T35", quantity: null },
    { optic: "T38", quantity: null },
  ]);
});

test("parseApprovedOptics: tolerant quantity syntaxes (x3, (3))", () => {
  assert.deepEqual(parseApprovedOptics("T35 x3, T38 (5)"), [
    { optic: "T35", quantity: 3 },
    { optic: "T38", quantity: 5 },
  ]);
});

test("parseApprovedOptics: empty/null → []", () => {
  assert.deepEqual(parseApprovedOptics(""), []);
  assert.deepEqual(parseApprovedOptics(null), []);
});

test("format(parse(s)) is stable on the canonical form", () => {
  const s = "T35 ×3 + T38 ×3";
  assert.equal(formatApprovedOptics(parseApprovedOptics(s)), s);
});

// --- aggregate ---------------------------------------------------------------

test("aggregateDialuxOptics: one entry per distinct optic, quantities summed", () => {
  const entries = aggregateDialuxOptics([
    config({ optic_code: "T35", quantity: 3 }),
    config({ optic_code: "T38", quantity: 3 }),
    config({ optic_code: "T35", quantity: 2 }),
  ]);
  assert.deepEqual(entries, [
    { optic: "T35", quantity: 5 },
    { optic: "T38", quantity: 3 },
  ]);
});

test("aggregateDialuxOptics: unknown quantity poisons only its own optic", () => {
  const entries = aggregateDialuxOptics([
    config({ optic_code: "T35", quantity: 3 }),
    config({ optic_code: "T35", quantity: null }),
    config({ optic_code: "T38", quantity: 4 }),
  ]);
  assert.deepEqual(entries, [
    { optic: "T35", quantity: null },
    { optic: "T38", quantity: 4 },
  ]);
});

test("aggregateDialuxOptics: falls back to beam/lens when no code; skips optic-less configs", () => {
  const entries = aggregateDialuxOptics([
    config({ optic_beam_distribution: "Type II", quantity: 6 }),
    config({ quantity: 9 }), // no optic at all → skipped
  ]);
  assert.deepEqual(entries, [{ optic: "Type II", quantity: 6 }]);
});

// --- compare -----------------------------------------------------------------

test("sameOpticsBreakdown: case-insensitive on names, strict on quantities", () => {
  const a = [{ optic: "t35", quantity: 3 }];
  assert.equal(sameOpticsBreakdown(a, [{ optic: "T35", quantity: 3 }]), true);
  assert.equal(sameOpticsBreakdown(a, [{ optic: "T35", quantity: 4 }]), false);
  assert.equal(sameOpticsBreakdown(a, []), false);
});
