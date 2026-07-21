/**
 * Tests for the D1.1 release-gate logic (lib/task-list-mapping-status.ts).
 *
 * Run with:  npm test
 *
 * Pure (no DB / no server imports). These prove the SHARED logic that both the
 * task-list page and the server-side validateTaskList / markProductionReady
 * guards rely on:
 *   - countMissingMappings: what counts as an unresolved factory mapping
 *     (override → client preset → global mapping → missing).
 *   - evaluateRelease: validateTaskList must refuse on wrong status, on an open
 *     revision, or on missing mappings — and pass only when all three are clear.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countMissingMappings,
  countRequiredEmpty,
  evaluateRelease,
  type MappingLine,
} from "../lib/task-list-mapping-status.ts";
import { optionLookupKey, resolveFactoryInstruction } from "../lib/types.ts";

const dropdown = (field_name: string) =>
  ({ field_name, field_type: "dropdown" }) as any;

const cat = (fields: any[]) => new Map([["cat1", fields]]);

// Build the option-id lookup the SAME way production does — through
// optionLookupKey — so fixtures can never drift from the key format
// resolveFactoryInstruction actually uses. (Hand-writing bare
// "field|value" keys is exactly what silently broke the realistic
// "a global mapping resolves it" case once the key became category-scoped.)
const lookup = (
  entries: Array<[categoryId: string, field: string, value: string, optionId: string]>
): Map<string, string> => {
  const m = new Map<string, string>();
  for (const [c, f, v, id] of entries) m.set(optionLookupKey(c, f, v), id);
  return m;
};

// A live (active by default) global mapping row for `optionId`.
const mappingRow = (optionId: string, active = true) =>
  ({
    id: `m-${optionId}`,
    option_id: optionId,
    factory_instruction: `INSTR-${optionId}`,
    active,
  }) as any;

test("countMissingMappings: an unmapped dropdown value counts as missing", () => {
  const line: MappingLine = {
    productId: "p1",
    categoryId: "cat1",
    config: { Battery: "922Wh" },
    overrides: {},
  };
  assert.equal(
    countMissingMappings({
      lines: [line],
      salesFieldsByCategory: cat([dropdown("Battery")]),
      mappingsByOption: new Map(),
      optionIdByFieldValue: new Map(),
      clientOverridesByProduct: new Map(),
    }),
    1
  );
});

test("countMissingMappings: a global mapping resolves it (value matched case-insensitively)", () => {
  assert.equal(
    countMissingMappings({
      lines: [
        { productId: "p1", categoryId: "cat1", config: { Battery: "922Wh" }, overrides: {} },
      ],
      salesFieldsByCategory: cat([dropdown("Battery")]),
      // Keyed through optionLookupKey (lower-cases value) — proves the
      // case-insensitive match AND that the key is category-scoped.
      optionIdByFieldValue: lookup([["cat1", "Battery", "922Wh", "opt1"]]),
      mappingsByOption: new Map([["opt1", mappingRow("opt1")]]),
      clientOverridesByProduct: new Map(),
    }),
    0
  );
});

test("countMissingMappings: an INACTIVE global mapping does NOT resolve it", () => {
  assert.equal(
    countMissingMappings({
      lines: [
        { productId: "p1", categoryId: "cat1", config: { Battery: "922Wh" }, overrides: {} },
      ],
      salesFieldsByCategory: cat([dropdown("Battery")]),
      optionIdByFieldValue: lookup([["cat1", "Battery", "922Wh", "opt1"]]),
      mappingsByOption: new Map([["opt1", mappingRow("opt1", false)]]),
      clientOverridesByProduct: new Map(),
    }),
    1
  );
});

test("countMissingMappings: an order override resolves it", () => {
  assert.equal(
    countMissingMappings({
      lines: [
        {
          productId: "p1",
          categoryId: "cat1",
          config: { Battery: "922Wh" },
          overrides: { Battery: "one-off factory note" },
        },
      ],
      salesFieldsByCategory: cat([dropdown("Battery")]),
      mappingsByOption: new Map(),
      optionIdByFieldValue: new Map(),
      clientOverridesByProduct: new Map(),
    }),
    0
  );
});

test("countMissingMappings: a client preset resolves it", () => {
  assert.equal(
    countMissingMappings({
      lines: [
        { productId: "p1", categoryId: "cat1", config: { Battery: "922Wh" }, overrides: {} },
      ],
      salesFieldsByCategory: cat([dropdown("Battery")]),
      mappingsByOption: new Map(),
      optionIdByFieldValue: new Map(),
      clientOverridesByProduct: new Map([["p1", { Battery: "client preset note" }]]),
    }),
    0
  );
});

test("countMissingMappings: empty values and non-dropdown fields are skipped", () => {
  assert.equal(
    countMissingMappings({
      lines: [
        {
          productId: "p1",
          categoryId: "cat1",
          config: { Battery: "", Note: "free text" },
          overrides: {},
        },
      ],
      salesFieldsByCategory: cat([
        dropdown("Battery"),
        { field_name: "Note", field_type: "text" } as any,
      ]),
      mappingsByOption: new Map(),
      optionIdByFieldValue: new Map(),
      clientOverridesByProduct: new Map(),
    }),
    0
  );
});

test("countMissingMappings: sums across lines and fields", () => {
  assert.equal(
    countMissingMappings({
      lines: [
        { productId: "p1", categoryId: "cat1", config: { Battery: "922Wh", Optic: "T35" }, overrides: {} },
        { productId: "p2", categoryId: "cat1", config: { Battery: "538Wh" }, overrides: {} },
      ],
      salesFieldsByCategory: cat([dropdown("Battery"), dropdown("Optic")]),
      mappingsByOption: new Map(),
      optionIdByFieldValue: new Map(),
      clientOverridesByProduct: new Map(),
    }),
    3
  );
});

// ---- m133: line-level category closes the free-text blind spot ----
// A Service-Request line has product_id = null (its specs are flattened into the
// name). Pre-m133 its categoryId was derived from products via product_id → null,
// so `if (!categoryId) continue` SILENTLY skipped it: a free-text product could
// reach production with NO factory-mapping check. m133 carries category_id on the
// line itself, so it's evaluated like any other line and its missing mappings are
// caught. countMissingMappings already keys on categoryId (not productId); these
// two cases lock that contract in.

test("countMissingMappings: a free-text line WITHOUT a category (pre-m133) is a blind spot — skipped", () => {
  const line: MappingLine = {
    productId: "", // free-text line — no catalog product
    categoryId: null, // pre-m133: nothing derivable from a null product_id
    config: { Battery: "922Wh" },
    overrides: {},
  };
  assert.equal(
    countMissingMappings({
      lines: [line],
      salesFieldsByCategory: cat([dropdown("Battery")]),
      mappingsByOption: new Map(),
      optionIdByFieldValue: new Map(),
      clientOverridesByProduct: new Map(),
    }),
    0 // skipped — exactly the blind spot m133 closes
  );
});

test("countMissingMappings: a free-text line WITH a category (m133) is evaluated — missing caught", () => {
  const line: MappingLine = {
    productId: "", // still no catalog product…
    categoryId: "cat1", // …but m133 carries the request's family on the line
    config: { Battery: "922Wh" },
    overrides: {},
  };
  assert.equal(
    countMissingMappings({
      lines: [line],
      salesFieldsByCategory: cat([dropdown("Battery")]),
      mappingsByOption: new Map(),
      optionIdByFieldValue: new Map(),
      clientOverridesByProduct: new Map(),
    }),
    1 // now caught — no longer a blind spot
  );
});

// ---- #12 regression: duplicated families share field names + values ----
// duplicateCategory copies field_name AND option_value verbatim, so a family
// and its copy both expose e.g. Battery=460Wh on DIFFERENT option_ids. The
// page / export / server-gate all build ONE option map spanning ALL categories.
// A bare `${field}|${value}` key collapsed both families onto one (last-wins)
// option_id, so a mapping created on the copy's option resolved to "missing"
// (and the duplicated family could never reach production). optionLookupKey
// scopes the key by category_id so each line resolves within its own family.

test("optionLookupKey: scopes by category so identical field+value don't collide", () => {
  assert.notEqual(
    optionLookupKey("catA", "Battery", "460Wh"),
    optionLookupKey("catB", "Battery", "460Wh")
  );
  // value is lower-cased, field + category verbatim
  assert.equal(optionLookupKey("catA", "Battery", "460Wh"), "catA|Battery|460wh");
});

test("countMissingMappings: duplicated family — copy's mapping does NOT satisfy the source line", () => {
  // Two families, identical Battery=460Wh, on distinct option_ids. Only the
  // COPY (catB) has been mapped. The SOURCE line (catA) must still read missing
  // — the pre-fix global key would have let catB's mapping cover both → 0 (bug).
  const optionIdByFieldValue = lookup([
    ["catA", "Battery", "460Wh", "optA"],
    ["catB", "Battery", "460Wh", "optB"],
  ]);
  const mappingsByOption = new Map([["optB", mappingRow("optB")]]);
  assert.equal(
    countMissingMappings({
      lines: [
        { productId: "pA", categoryId: "catA", config: { Battery: "460Wh" }, overrides: {} },
        { productId: "pB", categoryId: "catB", config: { Battery: "460Wh" }, overrides: {} },
      ],
      salesFieldsByCategory: new Map([
        ["catA", [dropdown("Battery")]],
        ["catB", [dropdown("Battery")]],
      ]),
      mappingsByOption,
      optionIdByFieldValue,
      clientOverridesByProduct: new Map(),
    }),
    1
  );
});

test("resolveFactoryInstruction: each duplicated family resolves to its OWN mapping", () => {
  const optionIdByFieldValue = lookup([
    ["catA", "Battery", "460Wh", "optA"],
    ["catB", "Battery", "460Wh", "optB"],
  ]);
  const mappingsByOption = new Map([
    ["optA", mappingRow("optA")],
    ["optB", mappingRow("optB")],
  ]);
  const resolveIn = (categoryId: string) =>
    resolveFactoryInstruction({
      categoryId,
      fieldName: "Battery",
      salesValue: "460Wh",
      overrides: {},
      mappingsByOption,
      optionIdByFieldValue,
    });

  const a = resolveIn("catA");
  const b = resolveIn("catB");
  assert.equal(a.source, "mapping");
  assert.equal(b.source, "mapping");
  assert.equal(a.text, "INSTR-optA");
  assert.equal(b.text, "INSTR-optB"); // NOT optA — proves no cross-family bleed
  assert.equal(a.mapping_id, "m-optA");
  assert.equal(b.mapping_id, "m-optB");
});

// ---- countRequiredEmpty (#7) — required-for-production fields left blank ----
// Complements countMissingMappings (which SKIPS empty fields). Surfaces the
// BUG-6 class — a required dropdown blank after launch — at the top of the page.

const requiredField = (field_name: string) =>
  ({ field_name, field_type: "dropdown", required_for_production: true }) as any;

test("countRequiredEmpty: a required-for-production field with no value counts", () => {
  assert.equal(
    countRequiredEmpty({
      lines: [{ productId: "p1", categoryId: "cat1", config: {}, overrides: {} }],
      salesFieldsByCategory: cat([requiredField("SolarPanel")]),
    }),
    1
  );
});

test("countRequiredEmpty: a required field WITH a value is not counted", () => {
  assert.equal(
    countRequiredEmpty({
      lines: [
        { productId: "p1", categoryId: "cat1", config: { SolarPanel: "120W" }, overrides: {} },
      ],
      salesFieldsByCategory: cat([requiredField("SolarPanel")]),
    }),
    0
  );
});

test("countRequiredEmpty: non-required fields are ignored even when empty", () => {
  assert.equal(
    countRequiredEmpty({
      lines: [{ productId: "p1", categoryId: "cat1", config: {}, overrides: {} }],
      salesFieldsByCategory: cat([dropdown("Optional")]), // no required_for_production
    }),
    0
  );
});

test("countRequiredEmpty: a CUSTOM-sentinel value with free text fills the field", () => {
  assert.equal(
    countRequiredEmpty({
      lines: [
        {
          productId: "p1",
          categoryId: "cat1",
          config: { SolarPanel: "__custom__", SolarPanel__custom: "Bespoke 137W" },
          overrides: {},
        },
      ],
      salesFieldsByCategory: cat([requiredField("SolarPanel")]),
    }),
    0
  );
});

test("countRequiredEmpty: sums across lines + skips lines with no category", () => {
  assert.equal(
    countRequiredEmpty({
      lines: [
        { productId: "p1", categoryId: "cat1", config: {}, overrides: {} }, // SolarPanel + Optic empty → 2
        { productId: "p2", categoryId: "cat1", config: { SolarPanel: "120W" }, overrides: {} }, // Optic empty → 1
        { productId: "p3", categoryId: null, config: {}, overrides: {} }, // no category → skipped
      ],
      salesFieldsByCategory: cat([requiredField("SolarPanel"), requiredField("Optic")]),
    }),
    3
  );
});

// ---- evaluateRelease — the validate / mark-production-ready gate ----

test("evaluateRelease: REFUSES when status is not releasable (highest precedence)", () => {
  const r = evaluateRelease({ statusAllowed: false, missingCount: 5, hasOpenRevision: true });
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /state that can be released/i);
});

test("evaluateRelease: REFUSES when a revision request is open", () => {
  const r = evaluateRelease({ statusAllowed: true, missingCount: 3, hasOpenRevision: true });
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /open revision request/i);
});

test("evaluateRelease: REFUSES when required mappings are missing", () => {
  const r = evaluateRelease({ statusAllowed: true, missingCount: 2, hasOpenRevision: false });
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /2 required factory mappings/);
});

test("evaluateRelease: PASSES only when status ok + no open revision + 0 missing", () => {
  const r = evaluateRelease({ statusAllowed: true, missingCount: 0, hasOpenRevision: false });
  assert.equal(r.ok, true);
  assert.equal(r.reason, null);
});

test("evaluateRelease: singular wording for a single missing mapping", () => {
  const r = evaluateRelease({ statusAllowed: true, missingCount: 1, hasOpenRevision: false });
  assert.match(r.reason ?? "", /1 required factory mapping /);
});

// ---- m159 — pole-drawing ↔ tilt-angle checkpoint --------------------------

test("evaluateRelease (m159): REFUSES when the tilt checkpoint is pending", () => {
  const r = evaluateRelease({
    statusAllowed: true,
    missingCount: 0,
    hasOpenRevision: false,
    lineCount: 3,
    tiltCheckpointPending: true,
  });
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /pole drawing checkpoint pending/i);
});

test("evaluateRelease (m159): mappings outrank the tilt checkpoint (most blocking reason first)", () => {
  const r = evaluateRelease({
    statusAllowed: true,
    missingCount: 2,
    hasOpenRevision: false,
    tiltCheckpointPending: true,
  });
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /factory mapping/i);
});

// ---- m176 — AI/production tilt conflict -----------------------------------

test("evaluateRelease (m176): REFUSES while an Energy-Study tilt conflict is unresolved", () => {
  const r = evaluateRelease({
    statusAllowed: true,
    missingCount: 0,
    hasOpenRevision: false,
    lineCount: 3,
    tiltConflictPending: true,
  });
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /tilt angle conflict/i);
});

test("evaluateRelease (m176): the conflict outranks the drawing checkpoint", () => {
  // While the angle itself is disputed there is nothing settled to verify a
  // drawing against — the conflict is the actionable reason of the two.
  const r = evaluateRelease({
    statusAllowed: true,
    missingCount: 0,
    hasOpenRevision: false,
    lineCount: 3,
    tiltCheckpointPending: true,
    tiltConflictPending: true,
  });
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /tilt angle conflict/i);
});

test("evaluateRelease (m176): PASSES when resolved or absent (undefined pre-migration)", () => {
  const resolved = evaluateRelease({
    statusAllowed: true,
    missingCount: 0,
    hasOpenRevision: false,
    lineCount: 1,
    tiltCheckpointPending: false,
    tiltConflictPending: false,
  });
  assert.equal(resolved.ok, true);
});

test("evaluateRelease (m159): PASSES when the checkpoint is verified or absent (undefined pre-migration)", () => {
  const verified = evaluateRelease({
    statusAllowed: true,
    missingCount: 0,
    hasOpenRevision: false,
    lineCount: 1,
    tiltCheckpointPending: false,
  });
  assert.equal(verified.ok, true);
  const legacy = evaluateRelease({
    statusAllowed: true,
    missingCount: 0,
    hasOpenRevision: false,
    lineCount: 1,
  });
  assert.equal(legacy.ok, true);
});
