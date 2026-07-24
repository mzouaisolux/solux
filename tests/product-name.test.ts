/**
 * Product naming convention — name = family + variant.
 *
 * Run with: npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  composeProductName,
  looksLikeCodeName,
  inferVariant,
} from "../lib/product-name.ts";

test("composeProductName — multi-variant family", () => {
  assert.equal(composeProductName("Vandal", "B-80"), "Vandal B-80");
  assert.equal(composeProductName("AOS Performance", "120"), "AOS Performance 120");
  assert.equal(composeProductName("Totem", "40"), "Totem 40");
});

test("composeProductName — single-variant family yields family only", () => {
  assert.equal(composeProductName("Kansa", ""), "Kansa");
  assert.equal(composeProductName("Kansa", null), "Kansa");
  assert.equal(composeProductName("Kansa", undefined), "Kansa");
});

test("composeProductName — trims and collapses whitespace", () => {
  assert.equal(composeProductName("  Vandal  ", "  B-80 "), "Vandal B-80");
  assert.equal(composeProductName("AOS   Performance", "120"), "AOS Performance 120");
});

test("composeProductName — missing family falls back to variant", () => {
  assert.equal(composeProductName("", "B-80"), "B-80");
  assert.equal(composeProductName(null, "B-80"), "B-80");
});

test("composeProductName — both empty gives empty string", () => {
  assert.equal(composeProductName("", ""), "");
  assert.equal(composeProductName(null, null), "");
});

test("looksLikeCodeName — name equal to sku (the code-as-name tell)", () => {
  assert.equal(looksLikeCodeName("VDL B-80", "VDL B-80"), true);
  assert.equal(looksLikeCodeName("vdl b-80", "VDL B-80"), true); // case-insensitive
  assert.equal(looksLikeCodeName(" VDL B-80 ", "VDL B-80"), true); // whitespace-insensitive
});

test("looksLikeCodeName — distinct name and code", () => {
  assert.equal(looksLikeCodeName("AOS Performance 120", "APF-120"), false);
});

test("looksLikeCodeName — blank sides are never a match", () => {
  assert.equal(looksLikeCodeName("VDL B-80", ""), false);
  assert.equal(looksLikeCodeName("", "VDL B-80"), false);
  assert.equal(looksLikeCodeName(null, null), false);
});

test("inferVariant — strips a leading family prefix", () => {
  assert.equal(inferVariant("AOS Performance 120", "AOS Performance"), "120");
  assert.equal(inferVariant("Vandal B-80", "Vandal"), "B-80");
});

test("inferVariant — name equal to family means no variant", () => {
  assert.equal(inferVariant("Kansa", "Kansa"), "");
});

test("inferVariant — no prefix match returns the name unchanged", () => {
  assert.equal(inferVariant("VDL B-80", "Vandal"), "VDL B-80");
});

test("compose/infer round-trip", () => {
  const family = "AOS Performance";
  const name = composeProductName(family, "120");
  assert.equal(inferVariant(name, family), "120");
});
