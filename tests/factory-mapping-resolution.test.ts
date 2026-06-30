/**
 * Realistic factory-mapping RESOLUTION tests (the 2026-06-19 E2E regression).
 *
 * Run with:  npm test
 *
 * Pure (no DB / no server imports). These drive countMissingMappings →
 * resolveFactoryInstruction through the REAL key builder (optionLookupKey) on a
 * realistic multi-field family, and lock in two invariants the production
 * non-determinism bug violated:
 *
 *  1. When the option-id lookup + mappings maps are COMPLETE (every saved +
 *     active mapping present), the AOS PRO+ line with 5 mapped dropdowns
 *     resolves to 0 missing. The live bug saw the count oscillate 5→3→5 because
 *     the UNSCOPED config_field_options / factory_mappings fetch hit the
 *     PostgREST row cap and returned a non-deterministic subset — i.e. the maps
 *     were intermittently incomplete. These tests prove the count is a pure
 *     function of complete inputs, so the fix is to make the fetch always
 *     complete (scoping it by the task list's categories).
 *
 *  2. Keys are CATEGORY-SCOPED: a mapping bound to another family's option must
 *     not resolve this family's line, and two families sharing a field + value
 *     each resolve against their own option.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countMissingMappings,
  type MappingLine,
} from "../lib/task-list-mapping-status.ts";
import { optionLookupKey } from "../lib/types.ts";

const dropdown = (field_name: string) =>
  ({ field_name, field_type: "dropdown" }) as any;

// Build optionIdByFieldValue through optionLookupKey — the SAME helper the
// resolver uses — so the fixture can never drift from production's key format.
const lookup = (
  entries: Array<[categoryId: string, field: string, value: string, optionId: string]>
): Map<string, string> => {
  const m = new Map<string, string>();
  for (const [c, f, v, id] of entries) m.set(optionLookupKey(c, f, v), id);
  return m;
};

const activeMapping = (optionId: string, active = true) =>
  ({
    id: `m-${optionId}`,
    option_id: optionId,
    factory_instruction: `TEST_DU_JOUR_${optionId}`,
    factory_code: null,
    notes: null,
    active,
  }) as any;

// The exact AOS PRO+ line from the E2E test: 5 sales dropdowns + their values.
const AOS = "aos-pro-plus";
const AOS_FIELDS = [
  dropdown("SOLAR PANEL"),
  dropdown("Battery"),
  dropdown("OPTIC"),
  dropdown("CCT"),
  dropdown("Spigot"),
];
const AOS_LINE: MappingLine = {
  productId: "aos-1",
  categoryId: AOS,
  config: {
    "SOLAR PANEL": "18V/60W",
    Battery: "230Wh",
    OPTIC: "T1",
    CCT: "2200k",
    Spigot: "60mm",
  },
  overrides: {},
};
const AOS_OPTIONS: Array<[string, string, string, string]> = [
  [AOS, "SOLAR PANEL", "18V/60W", "o-sp"],
  [AOS, "Battery", "230Wh", "o-bat"],
  [AOS, "OPTIC", "T1", "o-opt"],
  [AOS, "CCT", "2200k", "o-cct"],
  [AOS, "Spigot", "60mm", "o-spig"],
];
const AOS_OPTION_IDS = AOS_OPTIONS.map((e) => e[3]);

test("AOS PRO+: 5 saved + active mappings → 0 missing (deterministic when maps are complete)", () => {
  assert.equal(
    countMissingMappings({
      lines: [AOS_LINE],
      salesFieldsByCategory: new Map([[AOS, AOS_FIELDS]]),
      optionIdByFieldValue: lookup(AOS_OPTIONS),
      mappingsByOption: new Map(AOS_OPTION_IDS.map((id) => [id, activeMapping(id)])),
      clientOverridesByProduct: new Map(),
    }),
    0
  );
});

test("AOS PRO+: an option dropped from the lookup map (truncated fetch) → that field reads missing", () => {
  // Reproduces the MECHANISM of the live 5→3→5 bug: when the unscoped fetch
  // truncated config_field_options, OPTIC's option_id was intermittently absent
  // from optionIdByFieldValue, so OPTIC resolved to "missing".
  const partial = lookup(AOS_OPTIONS.filter(([, f]) => f !== "OPTIC"));
  assert.equal(
    countMissingMappings({
      lines: [AOS_LINE],
      salesFieldsByCategory: new Map([[AOS, AOS_FIELDS]]),
      optionIdByFieldValue: partial,
      mappingsByOption: new Map(AOS_OPTION_IDS.map((id) => [id, activeMapping(id)])),
      clientOverridesByProduct: new Map(),
    }),
    1
  );
});

test("AOS PRO+: a mapping row dropped from mappingsByOption (truncated fetch) → 1 missing", () => {
  // The other half of the same mechanism: the OPTION resolves to an option_id,
  // but the factory_mappings fetch truncated that mapping row away.
  const partialMappings = new Map(
    AOS_OPTION_IDS.filter((id) => id !== "o-opt").map((id) => [id, activeMapping(id)])
  );
  assert.equal(
    countMissingMappings({
      lines: [AOS_LINE],
      salesFieldsByCategory: new Map([[AOS, AOS_FIELDS]]),
      optionIdByFieldValue: lookup(AOS_OPTIONS),
      mappingsByOption: partialMappings,
      clientOverridesByProduct: new Map(),
    }),
    1
  );
});

test("category-scoped key: a mapping in ANOTHER family does NOT resolve this family's line", () => {
  // cat2 has Battery=230Wh mapped; cat1's identical Battery=230Wh line must
  // still read missing (no cross-family leakage via a bare field|value key).
  assert.equal(
    countMissingMappings({
      lines: [
        { productId: "p1", categoryId: "cat1", config: { Battery: "230Wh" }, overrides: {} },
      ],
      salesFieldsByCategory: new Map([["cat1", [dropdown("Battery")]]]),
      optionIdByFieldValue: lookup([["cat2", "Battery", "230Wh", "opt-cat2"]]),
      mappingsByOption: new Map([["opt-cat2", activeMapping("opt-cat2")]]),
      clientOverridesByProduct: new Map(),
    }),
    1
  );
});

test("category-scoped key: two families sharing field+value each resolve against their OWN option", () => {
  assert.equal(
    countMissingMappings({
      lines: [
        { productId: "p1", categoryId: "cat1", config: { Battery: "230Wh" }, overrides: {} },
        { productId: "p2", categoryId: "cat2", config: { Battery: "230Wh" }, overrides: {} },
      ],
      salesFieldsByCategory: new Map([
        ["cat1", [dropdown("Battery")]],
        ["cat2", [dropdown("Battery")]],
      ]),
      optionIdByFieldValue: lookup([
        ["cat1", "Battery", "230Wh", "opt-cat1"],
        ["cat2", "Battery", "230Wh", "opt-cat2"],
      ]),
      mappingsByOption: new Map([
        ["opt-cat1", activeMapping("opt-cat1")],
        ["opt-cat2", activeMapping("opt-cat2")],
      ]),
      clientOverridesByProduct: new Map(),
    }),
    0
  );
});
