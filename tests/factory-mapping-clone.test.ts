/**
 * Tests for "Copy factory mappings from an existing family"
 * (lib/factory-mapping-clone.ts).
 *
 * Run with:  npm test
 *
 * Pure (no DB / no server imports). These prove the option-matching + cloning
 * logic shared by BOTH integration points (the standalone copy action and the
 * duplicateCategory "also copy factory mappings" checkbox):
 *   - factoryOptionKey: the normalized match key matches resolveFactoryInstruction
 *     (field name verbatim, value lower-cased).
 *   - buildFactoryMappingClonePlan: which target options receive a clone, what
 *     they carry, and the copied / skipped counters.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildFactoryMappingClonePlan,
  factoryOptionKey,
  type SourceMappedOption,
  type TargetOption,
} from "../lib/factory-mapping-clone.ts";

// Convenience builders ------------------------------------------------------

const src = (
  field_name: string,
  option_value: string,
  factory_instruction: string,
  extra: Partial<SourceMappedOption> = {}
): SourceMappedOption => ({
  field_name,
  option_value,
  factory_instruction,
  factory_code: null,
  notes: null,
  active: true,
  ...extra,
});

const tgt = (
  field_id: string,
  option_id: string,
  field_name: string,
  option_value: string
): TargetOption => ({ field_id, option_id, field_name, option_value });

// factoryOptionKey ----------------------------------------------------------

test("factoryOptionKey: value is lower-cased, field name kept verbatim", () => {
  assert.equal(factoryOptionKey("Battery", "922Wh"), "Battery|922wh");
  // Same key the resolver builds in lib/types.ts.
  assert.equal(
    factoryOptionKey("Battery", "922WH"),
    factoryOptionKey("Battery", "922wh")
  );
  // Field name is NOT lower-cased — distinct casing → distinct keys.
  assert.notEqual(factoryOptionKey("Battery", "x"), factoryOptionKey("battery", "x"));
});

// buildFactoryMappingClonePlan ---------------------------------------------

test("clones instruction + factory_code onto the matching target option_id", () => {
  const plan = buildFactoryMappingClonePlan({
    sourceMappedOptions: [
      src("Battery", "922Wh", "Use LiFePO4 922Wh pack", { factory_code: "LFP-922" }),
    ],
    targetOptions: [tgt("f-new", "opt-new", "Battery", "922Wh")],
  });
  assert.equal(plan.copied, 1);
  assert.equal(plan.skipped, 0);
  assert.equal(plan.sourceMappings, 1);
  assert.deepEqual(plan.rows, [
    {
      field_id: "f-new",
      option_id: "opt-new",
      factory_instruction: "Use LiFePO4 922Wh pack",
      factory_code: "LFP-922",
      notes: null,
      active: true,
    },
  ]);
});

test("value match is case-insensitive (source 'Red' → target 'red')", () => {
  const plan = buildFactoryMappingClonePlan({
    sourceMappedOptions: [src("Color", "Red", "RAL 3020")],
    targetOptions: [tgt("f1", "o1", "Color", "red")],
  });
  assert.equal(plan.copied, 1);
  assert.equal(plan.rows[0].factory_instruction, "RAL 3020");
});

test("field name disambiguates identical values across different fields", () => {
  const plan = buildFactoryMappingClonePlan({
    sourceMappedOptions: [src("Battery", "Large", "BAT-L"), src("Frame", "Large", "FRM-L")],
    targetOptions: [
      tgt("fB", "oB", "Battery", "Large"),
      tgt("fF", "oF", "Frame", "Large"),
    ],
  });
  assert.equal(plan.copied, 2);
  const byOption = new Map(plan.rows.map((r) => [r.option_id, r.factory_instruction]));
  assert.equal(byOption.get("oB"), "BAT-L");
  assert.equal(byOption.get("oF"), "FRM-L");
});

test("target option with no source mapping is skipped, not written", () => {
  const plan = buildFactoryMappingClonePlan({
    sourceMappedOptions: [src("Battery", "922Wh", "BAT-922")],
    targetOptions: [
      tgt("f1", "o1", "Battery", "922Wh"), // matched → copied
      tgt("f1", "o2", "Battery", "461Wh"), // no source mapping → skipped
      tgt("f2", "o3", "Color", "Blue"), // no source mapping → skipped
    ],
  });
  assert.equal(plan.copied, 1);
  assert.equal(plan.skipped, 2);
  assert.equal(plan.rows.length, 1);
  assert.equal(plan.rows[0].option_id, "o1");
});

test("a source mapping with no target option produces no row (and no crash)", () => {
  const plan = buildFactoryMappingClonePlan({
    sourceMappedOptions: [src("Battery", "922Wh", "BAT-922"), src("Color", "Red", "RAL")],
    targetOptions: [tgt("f1", "o1", "Battery", "922Wh")],
  });
  assert.equal(plan.copied, 1); // only the target that exists
  assert.equal(plan.skipped, 0);
  assert.equal(plan.sourceMappings, 2);
});

test("two target options sharing a value both receive the source mapping", () => {
  const plan = buildFactoryMappingClonePlan({
    sourceMappedOptions: [src("Battery", "922Wh", "BAT-922")],
    targetOptions: [
      tgt("f1", "o1", "Battery", "922Wh"),
      tgt("f1", "o2", "Battery", "922WH"), // duplicate value, different casing
    ],
  });
  assert.equal(plan.copied, 2);
  assert.deepEqual(
    plan.rows.map((r) => r.option_id).sort(),
    ["o1", "o2"]
  );
});

test("factory_code / notes / active are carried over faithfully", () => {
  const plan = buildFactoryMappingClonePlan({
    sourceMappedOptions: [
      src("Battery", "922Wh", "BAT-922", {
        factory_code: "LFP-922",
        notes: "tested at 0.5C",
        active: false,
      }),
    ],
    targetOptions: [tgt("f1", "o1", "Battery", "922Wh")],
  });
  assert.deepEqual(plan.rows[0], {
    field_id: "f1",
    option_id: "o1",
    factory_instruction: "BAT-922",
    factory_code: "LFP-922",
    notes: "tested at 0.5C",
    active: false,
  });
});

test("empty source ⇒ everything skipped, nothing written", () => {
  const plan = buildFactoryMappingClonePlan({
    sourceMappedOptions: [],
    targetOptions: [tgt("f1", "o1", "Battery", "922Wh"), tgt("f1", "o2", "Battery", "461Wh")],
  });
  assert.equal(plan.copied, 0);
  assert.equal(plan.skipped, 2);
  assert.equal(plan.rows.length, 0);
});

test("deterministic / idempotent: same input ⇒ identical rows", () => {
  const args = {
    sourceMappedOptions: [src("Battery", "922Wh", "BAT-922", { factory_code: "C1" })],
    targetOptions: [tgt("f1", "o1", "Battery", "922Wh")],
  };
  assert.deepEqual(
    buildFactoryMappingClonePlan(args).rows,
    buildFactoryMappingClonePlan(args).rows
  );
});
