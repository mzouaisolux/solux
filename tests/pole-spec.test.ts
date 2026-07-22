/**
 * Tests for the m181 pole manufacturing spec (lib/pole-spec.ts).
 *
 * Run with:  npm test
 *
 * Pure. Proves the vocabulary normalizes defensively and the one-line
 * summary (which rides the pole line name end to end) formats correctly.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyPoleSpec,
  formatPoleSpec,
  normalizePoleSpec,
  poleSpecHasContent,
} from "../lib/pole-spec.ts";

test("normalize: junk falls back to unset, valid values survive", () => {
  assert.deepEqual(normalizePoleSpec(null), emptyPoleSpec());
  assert.deepEqual(normalizePoleSpec("x"), emptyPoleSpec());
  const r = normalizePoleSpec({
    surface_treatment: "C4",
    finish: "galvanized_powder_coated",
    colour_mode: "custom",
    colour: " RAL 7016 ",
  });
  assert.equal(r.surface_treatment, "C4");
  assert.equal(r.finish, "galvanized_powder_coated");
  assert.equal(r.colour, "RAL 7016");
  const junk = normalizePoleSpec({ surface_treatment: "C9", finish: "chrome", colour_mode: "wat" });
  assert.deepEqual(junk, emptyPoleSpec());
});

test("hasContent: any cost-impacting choice counts, empty does not", () => {
  assert.equal(poleSpecHasContent(emptyPoleSpec()), false);
  assert.equal(poleSpecHasContent(normalizePoleSpec({ surface_treatment: "C3" })), true);
  assert.equal(poleSpecHasContent(normalizePoleSpec({ colour: "RAL 9006" })), true);
});

test("format: the factory one-liner", () => {
  assert.equal(
    formatPoleSpec(
      normalizePoleSpec({
        surface_treatment: "C4",
        finish: "galvanized_powder_coated",
        colour_mode: "custom",
        colour: "RAL 7016",
      })
    ),
    "C4 · hot-dip galvanized + powder coated · RAL 7016 (custom colour)"
  );
  assert.equal(
    formatPoleSpec(normalizePoleSpec({ finish: "hot_dip_galvanized" })),
    "hot-dip galvanized (raw)"
  );
  assert.equal(formatPoleSpec(emptyPoleSpec()), "");
});
