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
        // Disabled rows (coming-soon request types) are inert by design:
        // they render without navigation, so "#" is their only honest href.
        if (i.disabled) continue;
        assert.ok(i.href.startsWith("/"), `href must be a route: ${i.href}`);
        // Uniqueness applies to plain routes. Parameterized deep-links (the
        // "?services=" request-type presets into the shared SR wizard) may
        // legitimately collide — two request types can preset the same
        // services today and diverge later.
        if (!i.href.includes("?")) hrefs.push(i.href);
      }
    }
  }
  assert.equal(new Set(hrefs).size, hrefs.length, "duplicate item href in NAVIGATION");
});

test("super-admin (all caps, admin-like) sees every category", () => {
  const cats = buildVisibleNavigation(asSuperAdmin);
  assert.deepEqual(categoryIds(cats), [
    "dashboard",
    "clients-projects",
    "requests",
    "requests-inbox",
    "task-lists",
    "orders",
    "sales",
    "catalog",
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
  assert.ok(ids.includes("clients-projects"));
  assert.ok(ids.includes("task-lists"));
  assert.ok(ids.includes("orders"));
});

/* ------------------------------------------------------------------ */
/*  Incoming "Requests" menu (requests-inbox) — the processing side.    */
/*  Sales CREATE requests (id "requests"); Operations / TLM PROCESS     */
/*  them here. Each queue entry mirrors its page guard.                 */
/* ------------------------------------------------------------------ */

test("incoming Requests menu is hidden from a capability-less sales user", () => {
  const ids = categoryIds(buildVisibleNavigation(asSales));
  assert.ok(
    !ids.includes("requests-inbox"),
    "requests-inbox must hide when the user processes no request queue"
  );
});

test("ops with shipping.process_update sees the shipping queues (incl. Transport Requests)", () => {
  const ops = {
    granted: grant("shipping.process_update"),
    adminLike: false,
    technical: false,
    finance: false,
  };
  const cats = buildVisibleNavigation(ops);
  const inbox = cats.find((c) => c.id === "requests-inbox");
  assert.ok(inbox, "requests-inbox should show for an ops processor");
  const labels = inbox!.groups.flatMap((g) => g.items.map((i) => i.label));
  assert.ok(labels.includes("Transport Requests"));
  assert.ok(labels.includes("Packing List Requests"));
  assert.ok(labels.includes("Price Update Requests"));
  assert.ok(
    !labels.includes("Product Cost Requests"),
    "cost queues need project.enter_cost — must be pruned for shipping-only ops"
  );
  // No category href in the config: the click target must fall back to the
  // first VISIBLE queue, always a page this user can open.
  assert.equal(inbox!.href, "/operations/transport-requests");
});

test("TLM with task_list.validate sees the custom-product queue", () => {
  const cats = buildVisibleNavigation(asTLM("task_list.validate"));
  const inbox = cats.find((c) => c.id === "requests-inbox");
  assert.ok(inbox, "requests-inbox should show for a TLM processor");
  const labels = inbox!.groups.flatMap((g) => g.items.map((i) => i.label));
  assert.deepEqual(labels, ["Custom Product Requests"]);
});

test("cost viewer sees Product Cost Requests → the real /projects/cost-requests page", () => {
  const viewer = {
    granted: grant("project.view_cost"),
    adminLike: false,
    technical: false,
    finance: false,
  };
  const cats = buildVisibleNavigation(viewer);
  const inbox = cats.find((c) => c.id === "requests-inbox");
  assert.ok(inbox, "requests-inbox should show for a cost viewer");
  const items = inbox!.groups.flatMap((g) => g.items);
  const pc = items.find((i) => i.label === "Product Cost Requests");
  assert.ok(pc, "Product Cost Requests entry missing");
  assert.equal(pc!.href, "/projects/cost-requests", "must point to the real queue page");
});

test("Transport Requests moved OUT of Orders into the incoming Requests menu", () => {
  const cats = buildVisibleNavigation(asSuperAdmin);
  const orders = cats.find((c) => c.id === "orders")!;
  const orderLabels = orders.groups.flatMap((g) => g.items.map((i) => i.label));
  assert.ok(
    !orderLabels.includes("Transport Requests"),
    "Transport Requests must no longer live under Orders"
  );
  const inbox = cats.find((c) => c.id === "requests-inbox")!;
  const inboxHrefs = inbox.groups.flatMap((g) => g.items.map((i) => i.href));
  assert.ok(inboxHrefs.includes("/operations/transport-requests"));
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
  // Component mappings moved to the Catalog category (still technical-gated):
  // it must NOT remain under Factory configuration, and it MUST appear in Catalog.
  assert.ok(
    !labels.includes("Industrial dictionary"),
    "Industrial dictionary no longer lives under Factory configuration"
  );
  const catalog = cats.find((c) => c.id === "catalog");
  assert.ok(catalog, "Catalog category shows for a technical TLM (Industrial dictionary)");
  const catalogLabels = catalog!.groups.flatMap((g) => g.items.map((i) => i.label));
  // m160 — the entry was renamed "Industrial dictionary" (Product Dictionary).
  assert.ok(
    catalogLabels.includes("Industrial dictionary"),
    "Industrial dictionary now lives under Catalog"
  );
});

test("finance sees Pricing only via Cost entry (mirrors the route guards)", () => {
  const cats = buildVisibleNavigation(asFinance);
  const pricing = cats.find((c) => c.id === "pricing");
  assert.ok(pricing, "finance should see Pricing (Cost entry is finance-allowed)");
  const labels = pricing!.groups.flatMap((g) => g.items.map((i) => i.label));
  assert.deepEqual(labels, ["Cost Entry"], "finance sees only Cost Entry under Pricing");
});

/* ------------------------------------------------------------------ */
/*  Phase 3B — capability → menu delegation (capabilityOrAdmin kind).   */
/*  The 4 owner-required scenarios, at the resolver level.              */
/* ------------------------------------------------------------------ */

import { isVisible } from "../lib/navigation.ts";

const pricingItem = () => {
  for (const cat of NAVIGATION)
    for (const g of cat.groups)
      for (const i of g.items)
        if (i.href === "/admin/pricing") return i;
  throw new Error("pricing item not found");
};
const costEntryItem = () => {
  for (const cat of NAVIGATION)
    for (const g of cat.groups)
      for (const i of g.items)
        if (i.href === "/cost-entry") return i;
  throw new Error("cost-entry item not found");
};

test("delegated role WITH pricing.manage sees Price Lists; WITHOUT does not", () => {
  const item = pricingItem();
  const withCap = { granted: new Set(["pricing.manage"]) as Set<any>, adminLike: false, technical: false, finance: false };
  const without = { granted: new Set() as Set<any>, adminLike: false, technical: false, finance: false };
  assert.equal(isVisible(item.visibility, withCap), true);
  assert.equal(isVisible(item.visibility, without), false);
});

test("admin/super_admin see pricing even with an EMPTY matrix (anti-lockout)", () => {
  const item = pricingItem();
  const admin = { granted: new Set() as Set<any>, adminLike: true, technical: false, finance: false };
  assert.equal(isVisible(item.visibility, admin), true);
});

test("finance still sees Cost Entry (includeFinance), and so does pricing.manage_costs", () => {
  const item = costEntryItem();
  const finance = { granted: new Set() as Set<any>, adminLike: false, technical: false, finance: true };
  const delegated = { granted: new Set(["pricing.manage_costs"]) as Set<any>, adminLike: false, technical: false, finance: false };
  const sales = { granted: new Set() as Set<any>, adminLike: false, technical: false, finance: false };
  assert.equal(isVisible(item.visibility, finance), true);
  assert.equal(isVisible(item.visibility, delegated), true);
  assert.equal(isVisible(item.visibility, sales), false);
});

test("all 6 Phase 3B capabilities are referenced by the menu (binding intact)", () => {
  const caps = new Set(navCapabilities());
  for (const c of [
    "pricing.manage", "pricing.manage_costs",
    "admin.manage_products", "admin.manage_categories",
    "admin.manage_banks", "admin.manage_sales_conditions",
  ]) {
    assert.ok(caps.has(c), `menu should reference ${c}`);
  }
});
