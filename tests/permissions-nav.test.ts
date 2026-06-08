/**
 * Guard tests for the central navigation config + the capability→nav binding.
 *
 * Run with:  npm test
 *
 * These lock in two invariants:
 *  1. Every capability-gated page still has a menu entry (the Factory Mapping
 *     bug): "checked in the matrix" can't drift from "missing from the menu".
 *  2. buildVisibleNavigation() prunes items/groups/categories the user can't
 *     see — so the mega menu is permission-aware and hides empty containers.
 *
 * Pure (no DB / no server imports) so they run under the native node test
 * runner with type-stripping.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NAVIGATION,
  navCapabilities,
  buildVisibleNavigation,
} from "../lib/navigation.ts";

// Build a typed granted-capability Set from the menu's own capability list.
const grant = (...keys: string[]) =>
  new Set(navCapabilities().filter((c) => keys.includes(c)));
const grantAll = () => new Set(navCapabilities());

const categoryIds = (cats: ReturnType<typeof buildVisibleNavigation>) =>
  cats.map((c) => c.id);

// Context builders mirroring how Nav.tsx computes role flags (isAdminLike /
// isTechnicalRole / finance) from the effective role.
const asSuperAdmin = { granted: grantAll(), adminLike: true, technical: true, finance: false };
const asSales = { granted: grant(), adminLike: false, technical: false, finance: false };
const asFinance = { granted: grant(), adminLike: false, technical: false, finance: true };
const asTLM = (...caps: string[]) => ({
  granted: grant(...caps),
  adminLike: false,
  technical: true,
  finance: false,
});

// Every capability-gated item in the central config, as {capability, href}.
const capabilityLinks = NAVIGATION.flatMap((c) =>
  c.groups.flatMap((g) =>
    g.items
      .filter((i) => i.visibility.kind === "capability")
      .map((i) => ({
        capability: (i.visibility as { kind: "capability"; capability: string })
          .capability,
        href: i.href,
      }))
  )
);

test("every capability-gated page has a menu entry (binding intact)", () => {
  const hrefByCap = new Map(capabilityLinks.map((l) => [l.capability, l.href]));
  assert.equal(
    hrefByCap.get("factory_mapping.access"),
    "/factory-mapping",
    "factory_mapping.access must surface Factory Mapping in the menu"
  );
  assert.ok(hrefByCap.has("admin.manage_users"), "Users link missing from config");
  assert.ok(
    hrefByCap.has("admin.manage_permissions"),
    "Permissions link missing from config"
  );
});

test("navigation config is well-formed: unique hrefs, real labels, ids", () => {
  const hrefs: string[] = [];
  for (const cat of NAVIGATION) {
    assert.ok(cat.id && cat.label, "category needs id + label");
    for (const g of cat.groups) {
      assert.ok(g.title.trim().length > 0, "group needs a title");
      for (const i of g.items) {
        assert.ok(i.label.trim().length > 0, `empty label at ${i.href}`);
        assert.ok(i.href.startsWith("/"), `href must be a route: ${i.href}`);
        hrefs.push(i.href);
      }
    }
  }
  assert.equal(new Set(hrefs).size, hrefs.length, "duplicate item href in NAVIGATION");
});

test("super-admin (all caps, admin-like) sees every category", () => {
  const cats = buildVisibleNavigation(asSuperAdmin);
  assert.deepEqual(categoryIds(cats), [
    "dashboard",
    "clients-business",
    "projects",
    "task-lists",
    "operations",
    "pricing",
    "admin",
  ]);
});

test("sales with no caps: Pricing and Admin categories are hidden (empty)", () => {
  const cats = buildVisibleNavigation(asSales);
  const ids = categoryIds(cats);
  assert.ok(!ids.includes("admin"), "Admin must hide when it has no visible item");
  assert.ok(!ids.includes("pricing"), "Pricing must hide for non-admin/non-finance");
  // Always-visible categories remain.
  assert.ok(ids.includes("dashboard"));
  assert.ok(ids.includes("clients-business"));
  assert.ok(ids.includes("task-lists"));
  assert.ok(ids.includes("operations"));
});

test("sales: Task Lists shows, but the Factory configuration group is pruned", () => {
  const cats = buildVisibleNavigation(asSales);
  const taskLists = cats.find((c) => c.id === "task-lists");
  assert.ok(taskLists, "Task Lists category should show (always-visible items)");
  const groupTitles = taskLists!.groups.map((g) => g.title);
  assert.ok(
    !groupTitles.includes("Factory configuration"),
    "Factory configuration group must hide when sales has no factory/technical access"
  );
});

test("Task List Manager with factory_mapping.access sees Factory mapping", () => {
  const cats = buildVisibleNavigation(asTLM("factory_mapping.access"));
  const taskLists = cats.find((c) => c.id === "task-lists")!;
  const factoryGroup = taskLists.groups.find(
    (g) => g.title === "Factory configuration"
  );
  assert.ok(factoryGroup, "Factory configuration group should appear for TLM");
  const labels = factoryGroup!.items.map((i) => i.label);
  assert.ok(labels.includes("Factory mapping"));
  // Component mappings is technical-role gated; TLM is technical → visible.
  assert.ok(labels.includes("Component mappings"));
});

test("finance sees Pricing only via Cost entry (mirrors the route guards)", () => {
  const cats = buildVisibleNavigation(asFinance);
  const pricing = cats.find((c) => c.id === "pricing");
  assert.ok(pricing, "finance should see Pricing (Cost entry is finance-allowed)");
  const labels = pricing!.groups.flatMap((g) => g.items.map((i) => i.label));
  assert.deepEqual(labels, ["Cost Entry"], "finance sees only Cost Entry under Pricing");
});
