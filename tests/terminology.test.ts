/**
 * Tests for the m177 centralized terminology (lib/terminology.ts).
 *
 * Run with:  npm test
 *
 * Pure (no DB / no server imports). Proves the guarantees the factory
 * documents depend on:
 *   - the FALLBACK ORDER: validated row → built-in default → English → key;
 *   - a DRAFT row is never rendered (half-finished Chinese must not reach a
 *     factory) and never overwrites the built-in default;
 *   - the catalog is internally consistent — no key renders blank, and the
 *     drift the migration fixed (数量/备注/运输方式) stays fixed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TERM_DEFAULTS,
  TERM_KEYS,
  TERM_CATEGORIES,
  DEFAULT_TERM_DICT,
  buildTermDict,
  normalizeTermRow,
  resolveTerm,
  bi,
  makeTerms,
  type TermRow,
} from "../lib/terminology.ts";

const row = (over: Partial<TermRow> & { key: string }): TermRow => ({
  category: "field",
  en: "English",
  zh: null,
  fr: null,
  status: "validated",
  notes: null,
  updated_at: null,
  updated_by: null,
  ...over,
});

// ---------------------------------------------------------------------------
// Fallback order
// ---------------------------------------------------------------------------

test("fallback 1: a validated row wins over the built-in default", () => {
  const dict = buildTermDict([
    row({ key: "table.qty", en: "Quantity", zh: "件数", status: "validated" }),
  ]);
  assert.equal(resolveTerm(dict, "table.qty", "zh"), "件数");
  assert.equal(resolveTerm(dict, "table.qty", "en"), "Quantity");
});

test("fallback 2: no row → the built-in default", () => {
  assert.equal(resolveTerm(DEFAULT_TERM_DICT, "table.qty", "zh"), "数量");
  assert.equal(resolveTerm(DEFAULT_TERM_DICT, "table.qty", "en"), "Qty");
});

test("fallback 3: a validated row without Chinese falls back to English", () => {
  // buildTermDict keeps the built-in zh, so force a key that has none.
  const dict = buildTermDict([
    row({ key: "custom.new_term", en: "Crate label", zh: null }),
  ]);
  assert.equal(resolveTerm(dict, "custom.new_term", "zh"), "Crate label");
  assert.equal(resolveTerm(dict, "custom.new_term", "fr"), "Crate label");
});

test("fallback 4: an unknown key resolves to itself, never to a blank", () => {
  assert.equal(resolveTerm(DEFAULT_TERM_DICT, "nope.missing", "zh"), "nope.missing");
  assert.equal(resolveTerm(DEFAULT_TERM_DICT, "nope.missing", "en"), "nope.missing");
});

// ---------------------------------------------------------------------------
// Draft / deprecated are never rendered
// ---------------------------------------------------------------------------

test("a DRAFT row is ignored — the built-in default still renders", () => {
  const dict = buildTermDict([
    row({ key: "table.qty", en: "WRONG", zh: "错误", status: "draft" }),
  ]);
  assert.equal(resolveTerm(dict, "table.qty", "zh"), "数量");
  assert.equal(resolveTerm(dict, "table.qty", "en"), "Qty");
});

test("a DEPRECATED row is ignored too", () => {
  const dict = buildTermDict([
    row({ key: "table.note", en: "Old", zh: "旧", status: "deprecated" }),
  ]);
  assert.equal(resolveTerm(dict, "table.note", "zh"), "备注");
});

test("an unknown status is treated as unvalidated (fail safe)", () => {
  const r = normalizeTermRow({ key: "x.y", en: "X", zh: "艾克斯", status: "approved" });
  assert.equal(r?.status, "draft");
  const dict = buildTermDict([r!]);
  // Not validated → never contributes, so the key falls through to itself.
  assert.equal(resolveTerm(dict, "x.y", "zh"), "x.y");
});

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

test("normalize: a row without a key is unusable", () => {
  assert.equal(normalizeTermRow(null), null);
  assert.equal(normalizeTermRow({ en: "No key" }), null);
  assert.equal(normalizeTermRow("nope"), null);
});

test("normalize: a missing English value falls back to the built-in, then the key", () => {
  assert.equal(normalizeTermRow({ key: "table.qty" })?.en, "Qty");
  assert.equal(normalizeTermRow({ key: "brand.new" })?.en, "brand.new");
});

test("normalize: blank strings become null, not empty labels", () => {
  const r = normalizeTermRow({ key: "table.qty", en: "Qty", zh: "   ", fr: "" });
  assert.equal(r?.zh, null);
  assert.equal(r?.fr, null);
});

test("normalize: an unknown category falls back to the built-in category", () => {
  assert.equal(normalizeTermRow({ key: "table.qty", category: "bogus" })?.category, "table");
  assert.equal(normalizeTermRow({ key: "brand.new", category: "bogus" })?.category, "field");
});

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

test("bi() returns the zh/en pair the dossier renders", () => {
  assert.deepEqual(bi(DEFAULT_TERM_DICT, "section.tilt_angle"), {
    zh: "太阳能板倾角",
    en: "Solar Panel Tilt Angle",
  });
});

test("dot() joins the pair, and collapses when there is no distinct Chinese", () => {
  const T = makeTerms(DEFAULT_TERM_DICT);
  assert.equal(T.dot("table.qty"), "数量 · Qty");
  // A term whose Chinese falls back to English must not print "X · X".
  const T2 = makeTerms(buildTermDict([row({ key: "solo.term", en: "Crate", zh: null })]));
  assert.equal(T2.dot("solo.term"), "Crate");
});

// ---------------------------------------------------------------------------
// Catalog integrity — these are what the factory documents render
// ---------------------------------------------------------------------------

test("catalog: every term has a non-empty English AND Chinese value", () => {
  for (const key of TERM_KEYS) {
    const t = (TERM_DEFAULTS as Record<string, any>)[key];
    assert.ok(t.en && t.en.trim() !== "", `${key} has no English value`);
    assert.ok(t.zh && t.zh.trim() !== "", `${key} has no Chinese value`);
  }
});

test("catalog: every category is one of the declared categories", () => {
  for (const key of TERM_KEYS) {
    const t = (TERM_DEFAULTS as Record<string, any>)[key];
    assert.ok(
      (TERM_CATEGORIES as readonly string[]).includes(t.category),
      `${key} has an unknown category ${t.category}`
    );
  }
});

test("catalog: keys follow the module.name convention the admin validates", () => {
  const KEY_RE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;
  for (const key of TERM_KEYS) {
    assert.ok(KEY_RE.test(key), `${key} is not a valid term key`);
  }
});

test("catalog: no two keys share the same English value in the same category", () => {
  // Two keys with an identical label in one category is the shape the drift
  // took (数量 as both "Qty" and "Quantity"); catch a reintroduction.
  const seen = new Map<string, string>();
  for (const key of TERM_KEYS) {
    const t = (TERM_DEFAULTS as Record<string, any>)[key];
    const id = `${t.category}::${t.en.toLowerCase()}`;
    const prev = seen.get(id);
    assert.equal(prev, undefined, `${key} duplicates ${prev} (${t.category} "${t.en}")`);
    seen.set(id, key);
  }
});

test("catalog: the drift m177 fixed stays fixed — one key per concept", () => {
  // 数量 was "Qty" three times and "Quantity" once; 备注 "Note"/"Notes";
  // 运输方式 "Shipping"/"Shipping method". One key, one English value each.
  const byZh = new Map<string, string[]>();
  for (const key of TERM_KEYS) {
    const t = (TERM_DEFAULTS as Record<string, any>)[key];
    byZh.set(t.zh, [...(byZh.get(t.zh) ?? []), t.en]);
  }
  for (const zh of ["数量", "备注", "运输方式"]) {
    const ens = new Set(byZh.get(zh) ?? []);
    assert.equal(ens.size, 1, `${zh} maps to several English values: ${[...ens].join(" / ")}`);
  }
});
