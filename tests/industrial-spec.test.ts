/**
 * Tests for the m159 industrial production file (lib/industrial-spec.ts).
 *
 * Run with:  npm test
 *
 * Pure (no DB / no server imports). Proves the normalizer both the task-list
 * page and updateIndustrialFile rely on:
 *   - defaults: the 3 catalog pole accessories arrive INCLUDED (owner spec);
 *   - normalization survives legacy/partial/garbage blobs;
 *   - explicit unchecks are preserved (default never resurrects them);
 *   - enum fields (packaging version, manual brand, languages) reject junk;
 *   - spare-part rows are cleaned and empty rows dropped;
 *   - tilt-angle parsing (cleanTiltAngle) bounds 0–90°.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanTiltAngle,
  defaultIndustrialSpec,
  normalizeIndustrialSpec,
  packagingRequiresBranding,
  manualRequiresArtwork,
  POLE_ACCESSORY_CATALOG,
} from "../lib/industrial-spec.ts";

test("defaults: the 3 catalog pole accessories are INCLUDED by default", () => {
  const d = defaultIndustrialSpec();
  assert.equal(d.pole_accessories.items.length, POLE_ACCESSORY_CATALOG.length);
  for (const it of d.pole_accessories.items) {
    assert.equal(it.included, true, `${it.key} must default to included`);
  }
  assert.deepEqual(
    d.pole_accessories.items.map((i) => i.key),
    ["anchor_bolts", "nut_caps", "nut_cap_grease"]
  );
  assert.equal(d.packaging.version, null);
  assert.equal(d.user_manual.brand, null);
  assert.deepEqual(d.spare_parts, []);
});

test("normalize: null / garbage / non-object → full default spec", () => {
  for (const raw of [null, undefined, "junk", 42, []]) {
    const s = normalizeIndustrialSpec(raw);
    assert.equal(s.pole_accessories.items.length, 3);
    assert.equal(s.packaging.version, null);
  }
});

test("normalize: an explicit uncheck is preserved; untouched rows stay included", () => {
  const s = normalizeIndustrialSpec({
    pole_accessories: {
      items: [{ key: "nut_caps", label: "Nut caps", included: false, note: "client has own" }],
      notes: "  ",
    },
  });
  const byKey = new Map(s.pole_accessories.items.map((i) => [i.key, i]));
  assert.equal(byKey.get("nut_caps")?.included, false);
  assert.equal(byKey.get("nut_caps")?.note, "client has own");
  assert.equal(byKey.get("anchor_bolts")?.included, true);
  assert.equal(byKey.get("nut_cap_grease")?.included, true);
  assert.equal(s.pole_accessories.notes, null); // blank string → null
});

test("normalize: custom accessory rows survive after the catalog rows", () => {
  const s = normalizeIndustrialSpec({
    pole_accessories: {
      items: [
        { key: "custom", label: "Template gabarit", included: true, note: null, custom: true },
      ],
      notes: null,
    },
  });
  assert.equal(s.pole_accessories.items.length, 4);
  const last = s.pole_accessories.items[3];
  assert.equal(last.custom, true);
  assert.equal(last.label, "Template gabarit");
});

test("normalize: packaging version — valid values pass, junk → null", () => {
  assert.equal(
    normalizeIndustrialSpec({ packaging: { version: "french_branch" } }).packaging.version,
    "french_branch"
  );
  assert.equal(
    normalizeIndustrialSpec({ packaging: { version: "gold_plated" } }).packaging.version,
    null
  );
});

test("normalize: user manual — brand + languages filtered, duplicates deduped", () => {
  const s = normalizeIndustrialSpec({
    user_manual: { brand: "neutral", languages: ["en", "ar", "en", "de", 3], notes: "n" },
  });
  assert.equal(s.user_manual.brand, "neutral");
  assert.deepEqual(s.user_manual.languages, ["en", "ar"]);
  assert.equal(
    normalizeIndustrialSpec({ user_manual: { brand: "acme" } }).user_manual.brand,
    null
  );
});

test("normalize: spare parts — cleaned rows, empty rows dropped, qty floored at 0", () => {
  const s = normalizeIndustrialSpec({
    spare_parts: [
      { part: "Battery", model: "LFP-60", quantity: "2", notes: "" },
      { part: "Controller", model: null, quantity: -3, factory_name: "MPPT Controller V6", customer_name: "Solar Controller", factory_notes: "exact wording" },
      { part: "", model: null, quantity: 5 }, // no name, no model → dropped
      "junk",
    ],
  });
  assert.equal(s.spare_parts.length, 2);
  assert.deepEqual(s.spare_parts[0], {
    part: "Battery",
    model: "LFP-60",
    product_id: null,
    quantity: 2,
    notes: null,
    factory_name: null,
    customer_name: null,
    factory_notes: null,
  });
  assert.equal(s.spare_parts[1].quantity, 0);
  assert.equal(s.spare_parts[1].factory_name, "MPPT Controller V6");
  assert.equal(s.spare_parts[1].customer_name, "Solar Controller");
});

test("branding/artwork requirements — only the custom options require assets", () => {
  const custom = normalizeIndustrialSpec({ packaging: { version: "custom_client" } });
  assert.equal(packagingRequiresBranding(custom), true);
  const solux = normalizeIndustrialSpec({ packaging: { version: "solux_standard" } });
  assert.equal(packagingRequiresBranding(solux), false);
  const manual = normalizeIndustrialSpec({ user_manual: { brand: "custom" } });
  assert.equal(manualRequiresArtwork(manual), true);
});

test("normalize: an EXPLICIT included=true survives; qty strings are rounded", () => {
  // included saved as true stays true (not just the default); decimal/string
  // quantities round to integers (Excel-paste survivors).
  const s = normalizeIndustrialSpec({
    pole_accessories: {
      items: [{ key: "anchor_bolts", label: "Anchor bolts", included: true, note: null }],
      notes: "keep",
    },
    spare_parts: [{ part: "Screws", model: "M8", quantity: "2.7" }],
  });
  assert.equal(s.pole_accessories.items[0].included, true);
  assert.equal(s.pole_accessories.notes, "keep");
  assert.equal(s.spare_parts[0].quantity, 3);
});

test("normalize: custom accessory with empty label is kept (UI lets the user finish typing)", () => {
  const s = normalizeIndustrialSpec({
    pole_accessories: {
      items: [{ key: "custom", label: "", included: true, note: null, custom: true }],
      notes: null,
    },
  });
  assert.equal(s.pole_accessories.items.length, 4);
  assert.equal(s.pole_accessories.items[3].label, "Custom accessory");
});

test("normalize: languages only apply to solux/neutral; custom keeps them harmlessly", () => {
  const s = normalizeIndustrialSpec({
    user_manual: { brand: "custom", languages: ["fr"], notes: null },
  });
  assert.equal(s.user_manual.brand, "custom");
  assert.deepEqual(s.user_manual.languages, ["fr"]); // stored but UI hides them
});

test("cleanTiltAngle — presets, custom, strings, out-of-range and junk", () => {
  assert.equal(cleanTiltAngle(15), 15);
  assert.equal(cleanTiltAngle("20"), 20);
  assert.equal(cleanTiltAngle("22.5°"), 22.5);
  assert.equal(cleanTiltAngle(0), 0);
  assert.equal(cleanTiltAngle(90), 90);
  assert.equal(cleanTiltAngle(91), null);
  assert.equal(cleanTiltAngle(-5), null);
  assert.equal(cleanTiltAngle(""), null);
  assert.equal(cleanTiltAngle(null), null);
  assert.equal(cleanTiltAngle("abc"), null);
});
