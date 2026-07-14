/**
 * Tests for the m170 "Use as Catalogue Pricing" list selection —
 * lib/price-lists.ts `selectCatalogueLists` (PURE core).
 *
 * Run with:  npm test
 *
 * These lock the quote-builder gating rule: per category, price only from a
 * PUBLISHED list that is ALSO flagged use_as_catalogue_pricing; a category
 * that has published lists but none catalogue-enabled is "blocked" (its
 * products require an approved Service Request). The seller's assigned list
 * wins over the newest; a pre-m170 env (flag inactive) treats every published
 * list as catalogue-enabled so behaviour is unchanged until the column exists.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { selectCatalogueLists, type PublishedList } from "../lib/price-list-select.ts";

const L = (
  id: string,
  category_id: string | null,
  created_at: string,
  use_as_catalogue_pricing?: boolean | null
): PublishedList => ({ id, name: id.toUpperCase(), category_id, created_at, use_as_catalogue_pricing });

test("catalogue-enabled list feeds its category; disabled-only category is blocked", () => {
  const published = [
    L("std", "catA", "2026-01-01", true),
    L("tender", "catB", "2026-01-01", false),
  ];
  const sel = selectCatalogueLists(published, new Set(), true);
  assert.equal(sel.categoryListMap.get("catA")?.id, "std");
  assert.equal(sel.categoryListMap.has("catB"), false);
  assert.ok(sel.blockedCategoryIds.has("catB"));
  assert.equal(sel.blockedCategoryIds.has("catA"), false);
});

test("within a category, only catalogue-enabled candidates are eligible; newest wins", () => {
  const published = [
    L("old", "catA", "2026-01-01", true),
    L("new", "catA", "2026-06-01", true),
    L("newest-but-off", "catA", "2026-09-01", false),
  ];
  const sel = selectCatalogueLists(published, new Set(), true);
  // The newest list is OFF → excluded; newest ENABLED ("new") is chosen.
  assert.equal(sel.categoryListMap.get("catA")?.id, "new");
  // The category has an enabled list, so it is NOT blocked.
  assert.equal(sel.blockedCategoryIds.has("catA"), false);
});

test("seller's assigned catalogue list beats the newest catalogue list", () => {
  const published = [
    L("assigned", "catA", "2026-01-01", true),
    L("newer", "catA", "2026-06-01", true),
  ];
  const sel = selectCatalogueLists(published, new Set(["assigned"]), true);
  assert.equal(sel.categoryListMap.get("catA")?.id, "assigned");
});

test("an assigned list that is NOT catalogue-enabled does not win (and can't unblock)", () => {
  const published = [
    L("assigned-off", "catA", "2026-06-01", false),
    L("enabled", "catA", "2026-01-01", true),
  ];
  const sel = selectCatalogueLists(published, new Set(["assigned-off"]), true);
  // The assigned one is OFF → fall back to the newest ENABLED list.
  assert.equal(sel.categoryListMap.get("catA")?.id, "enabled");
});

test("category whose lists are ALL disabled is blocked, none chosen", () => {
  const published = [
    L("a", "catA", "2026-01-01", false),
    L("b", "catA", "2026-06-01", false),
  ];
  const sel = selectCatalogueLists(published, new Set(), true);
  assert.equal(sel.categoryListMap.has("catA"), false);
  assert.ok(sel.blockedCategoryIds.has("catA"));
});

test("pre-m170 env (flag inactive) treats every published list as catalogue-enabled", () => {
  const published = [
    L("std", "catA", "2026-01-01", undefined),
    L("tender", "catB", "2026-01-01", undefined),
  ];
  const sel = selectCatalogueLists(published, new Set(), false);
  assert.equal(sel.categoryListMap.get("catA")?.id, "std");
  assert.equal(sel.categoryListMap.get("catB")?.id, "tender");
  assert.equal(sel.blockedCategoryIds.size, 0);
});

test("legacy null-category lists are ignored (never priced, never block)", () => {
  const published = [L("legacy", null, "2026-01-01", true)];
  const sel = selectCatalogueLists(published, new Set(), true);
  assert.equal(sel.categoryListMap.size, 0);
  assert.equal(sel.blockedCategoryIds.size, 0);
});
