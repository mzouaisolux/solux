/**
 * Project Requests (m090) — pricing math + status/role catalog integrity.
 *
 * Run with:  npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeProjectMargins,
  fmtMarginPct,
  computeSectionPrice,
  computeProjectTotal,
  computeFreightTotal,
  buildCommercialDescription,
  projectContainerToDocumentType,
  buildShippingContainersFromFreight,
  buildShippingContainers,
} from "../lib/project-pricing.ts";
import {
  computeFreightStatus,
  validityFromPeriod,
} from "../lib/freight-validity.ts";
import {
  PROJECT_REQUEST_STATUSES,
  PROJECT_REQUEST_STATUS_LABEL,
  PROJECT_FILE_CATEGORY_LABEL,
  ROLE_LABEL,
  ROLE_SHORT_LABEL,
  ASSIGNABLE_ROLES,
  VIEW_AS_ROLES,
} from "../lib/types.ts";
import {
  summarizeProjects,
  countBuckets,
  BUCKET_STATUSES,
  computeWaitingStatus,
  assembleProjectActions,
  projectActionTotal,
} from "../lib/project-dashboard.ts";

test("computeProjectMargins — spec example (cost 438, price 600, qty 500)", () => {
  const m = computeProjectMargins({ costPerUnit: 438, sellingPricePerUnit: 600, quantity: 500 });
  assert.equal(m.marginPerUnit, 162);
  assert.equal(m.marginPct, 0.27);
  assert.equal(m.marginValueTotal, 81000);
  assert.equal(m.totalProjectValue, 300000);
  assert.equal(fmtMarginPct(m.marginPct), "27.0%");
});

test("computeProjectMargins — no divide-by-zero / NaN when price is 0", () => {
  const m = computeProjectMargins({ costPerUnit: 100, sellingPricePerUnit: 0, quantity: 10 });
  assert.equal(m.marginPct, 0); // guarded — not NaN/Infinity
  assert.ok(Number.isFinite(m.marginPct));
  assert.equal(m.totalProjectValue, 0);
  assert.equal(m.marginValueTotal, -1000); // -100/unit × 10 units
});

test("computeProjectMargins — negative margin when price < cost", () => {
  const m = computeProjectMargins({ costPerUnit: 700, sellingPricePerUnit: 600, quantity: 100 });
  assert.equal(m.marginPerUnit, -100);
  assert.ok(m.marginPct < 0);
  assert.equal(m.marginValueTotal, -10000);
});

test("computeProjectMargins — tolerates null/missing inputs", () => {
  const m = computeProjectMargins({});
  assert.equal(m.marginPerUnit, 0);
  assert.equal(m.marginPct, 0);
  assert.equal(m.totalProjectValue, 0);
});

test("status catalog — 11 statuses, all labelled", () => {
  assert.equal(PROJECT_REQUEST_STATUSES.length, 11);
  for (const s of PROJECT_REQUEST_STATUSES) {
    assert.ok(PROJECT_REQUEST_STATUS_LABEL[s], `missing label for ${s}`);
  }
  // The workflow-critical statuses exist.
  for (const s of [
    "draft",
    "waiting_director_approval",
    "waiting_factory_cost",
    "ready_for_pricing",
    "priced",
    "quotation_generated",
  ]) {
    assert.ok(PROJECT_REQUEST_STATUSES.includes(s as any), `missing status ${s}`);
  }
});

test("file categories — all labelled", () => {
  for (const k of Object.keys(PROJECT_FILE_CATEGORY_LABEL)) {
    assert.ok(PROJECT_FILE_CATEGORY_LABEL[k as keyof typeof PROJECT_FILE_CATEGORY_LABEL]);
  }
});

const approx = (a: number, b: number, eps = 0.01) => Math.abs(a - b) < eps;

test("computeSectionPrice — reuses the engine (3150 RMB, 6.85, 10% rebate, 30% margin, 5% commission)", () => {
  const r = computeSectionPrice({
    costRmb: 3150,
    exchangeRate: 6.85,
    taxRebate: 0.1,
    marginPct: 30,
    commissionPct: 5,
  });
  assert.ok(approx(r.usdCost, 459.85), `usdCost ${r.usdCost}`);
  // enginePrice = usdCost*(1-rebate)/(1-margin)
  assert.ok(approx(r.enginePrice, (459.854 * 0.9) / 0.7), `enginePrice ${r.enginePrice}`);
  assert.ok(approx(r.enginePrice, 591.24, 0.05), `enginePrice ${r.enginePrice}`);
  // commission folded on top
  assert.ok(approx(r.commissionPerUnit, r.enginePrice * 0.05));
  assert.ok(approx(r.finalUnitPrice, r.enginePrice * 1.05));
  assert.ok(approx(r.finalUnitPrice, 620.8, 0.05), `final ${r.finalUnitPrice}`);
  // After-tax margin: value = enginePrice − usdCost + rebate; pct == typed 30%.
  assert.ok(approx(r.marginPct, 0.3), `marginPct ${r.marginPct}`);
  assert.ok(approx(r.marginValuePerUnit, r.enginePrice - r.usdCost + r.rebatePerUnit), `marginValue ${r.marginValuePerUnit}`);
  assert.ok(r.marginValuePerUnit > r.enginePrice - r.usdCost, "rebate increases profit");
});

test("computeSectionPrice — Product (30%) prices higher than Pole (12%) at equal cost", () => {
  const args = { costRmb: 3150, exchangeRate: 6.85, taxRebate: 0.1, commissionPct: 0 };
  const product = computeSectionPrice({ ...args, marginPct: 30 });
  const pole = computeSectionPrice({ ...args, marginPct: 12 });
  assert.ok(product.finalUnitPrice > pole.finalUnitPrice);
});

test("computeSectionPrice — zero cost yields zero price (no NaN)", () => {
  const r = computeSectionPrice({ costRmb: 0, exchangeRate: 6.85, taxRebate: 0.1, marginPct: 30, commissionPct: 5 });
  assert.equal(r.finalUnitPrice, 0);
  assert.ok(Number.isFinite(r.finalUnitPrice));
});

test("computeProjectTotal — product + pole + optional freight", () => {
  const t = computeProjectTotal({
    productUnit: 620.8,
    poleUnit: 100,
    quantity: 500,
    freightTotal: 12400,
    includeProduct: true,
    includePole: true,
    includeFreight: true,
  });
  assert.ok(approx(t.product, 310400));
  assert.ok(approx(t.pole, 50000));
  assert.equal(t.freight, 12400);
  assert.ok(approx(t.total, 372800));
  // excluding pole + freight
  const p = computeProjectTotal({ productUnit: 620.8, poleUnit: 100, quantity: 500, freightTotal: 12400, includePole: false, includeFreight: false });
  assert.ok(approx(p.total, 310400));
});

test("summarizeProjects — counts by status, ignores archived, scopes mine", () => {
  const me = "u1";
  const rows = [
    { status: "draft", owner_id: "u1" },
    { status: "draft", owner_id: "u2" },
    { status: "waiting_factory_cost", owner_id: "u1" },
    { status: "priced", owner_id: "u2" },
    { status: "won", owner_id: "u1", archived_at: "2026-01-01" }, // archived → ignored
  ];
  const s = summarizeProjects(rows, me);
  assert.equal(s.total, 4); // archived excluded
  assert.equal(s.byStatus["draft"], 2);
  assert.equal(s.byStatus["waiting_factory_cost"], 1);
  assert.equal(s.byStatus["won"] ?? 0, 0); // archived not counted
  assert.equal(s.mineByStatus["draft"], 1); // only u1's draft
  assert.equal(s.mineByStatus["waiting_factory_cost"], 1);
  assert.equal(s.mineByStatus["priced"] ?? 0, 0); // u2's
});

test("countBuckets — sums multiple statuses (waiting_costing = factory_cost + logistics)", () => {
  const byStatus = { waiting_factory_cost: 3, waiting_logistics: 2, priced: 1 };
  assert.equal(countBuckets(byStatus, BUCKET_STATUSES.waiting_costing), 5);
  assert.equal(countBuckets(byStatus, ["priced"]), 1);
  assert.equal(countBuckets(byStatus, ["draft"]), 0);
});

test("summarizeProjects — null user yields empty mine scope", () => {
  const s = summarizeProjects([{ status: "draft", owner_id: "u1" }], null);
  assert.equal(s.byStatus["draft"], 1);
  assert.deepEqual(s.mineByStatus, {});
});

test("computeWaitingStatus (P6) — advances as inputs arrive, no stale status", () => {
  const base = { reqCost: true, reqPack: true, reqFreight: true, current: "waiting_factory_cost" };
  // Nothing done → still waiting for cost.
  assert.equal(computeWaitingStatus({ ...base, costDone: false, packDone: false, freightDone: false }), "waiting_factory_cost");
  // Cost submitted but packing/freight pending → MOVE to waiting_logistics (the bug: it used to stay 'waiting_factory_cost').
  assert.equal(computeWaitingStatus({ ...base, costDone: true, packDone: false, freightDone: false }), "waiting_logistics");
  // Cost + packing done, freight pending → still waiting_logistics.
  assert.equal(computeWaitingStatus({ ...base, costDone: true, packDone: true, freightDone: false }), "waiting_logistics");
  // All done → ready for pricing.
  assert.equal(computeWaitingStatus({ ...base, costDone: true, packDone: true, freightDone: true }), "ready_for_pricing");
});

test("computeWaitingStatus — only requested children gate; non-waiting phases untouched", () => {
  // Only cost requested, cost done → ready immediately.
  assert.equal(
    computeWaitingStatus({ reqCost: true, reqPack: false, reqFreight: false, costDone: true, packDone: false, freightDone: false, current: "waiting_factory_cost" }),
    "ready_for_pricing"
  );
  // Don't touch draft / priced / etc.
  for (const current of ["draft", "submitted", "waiting_director_approval", "priced", "quotation_generated", "won", "lost", "cancelled"]) {
    assert.equal(
      computeWaitingStatus({ reqCost: true, reqPack: true, reqFreight: true, costDone: true, packDone: true, freightDone: true, current }),
      null
    );
  }
});

test("buildCommercialDescription — category + name + specs", () => {
  const desc = buildCommercialDescription(
    {
      name: "Cotonou Phase 2",
      led_power: "60W",
      solar_panel_size: "120W",
      battery_spec: "12.8V 60Ah",
      controller: "MPPT 20A",
      pole_height: "8m",
      iot_required: true,
    },
    "AOSPRO+"
  );
  assert.equal(
    desc,
    "AOSPRO+ — Cotonou Phase 2 · LED 60W · Panel 120W · Battery 12.8V 60Ah · Controller MPPT 20A · Pole 8m · IoT"
  );
});

test("buildCommercialDescription — includes arm length when present (m096)", () => {
  const desc = buildCommercialDescription(
    { name: "P2", led_power: "60W", pole_height: "8m", arm_length: "1.5m" },
    "SSLXPRO"
  );
  assert.ok(desc.includes("Pole 8m · Arm 1.5m"), desc);
});

test("buildCommercialDescription — degrades gracefully (no specs / no category)", () => {
  assert.equal(buildCommercialDescription({ name: "Tender X" }, null), "Tender X");
  assert.equal(buildCommercialDescription({ name: "Tender X" }, "SSLXPRO"), "SSLXPRO — Tender X");
  assert.equal(buildCommercialDescription({ led_power: "40W" }, null), "LED 40W");
  assert.equal(buildCommercialDescription({}, null), "Project product");
  // IoT off → not appended
  assert.ok(!buildCommercialDescription({ name: "X", iot_required: false }, null).includes("IoT"));
});

test("assembleProjectActions — director sees approval + pricing only, count>0", () => {
  const items = assembleProjectActions(
    { canApprove: true, canCost: false, canLogistics: false, canCreate: false },
    { waitingApproval: 1, readyForPricing: 2, costPending: 5, packPending: 0, freightPending: 0, minePriced: 9, mineDraft: 9 }
  );
  assert.deepEqual(items.map((i) => i.key), ["approve", "price"]); // ops/owner buckets gated out
  assert.equal(projectActionTotal(items), 3); // 1 + 2 → "Projects (3)"
  assert.equal(items[0].href, "/projects/approvals");
});

test("assembleProjectActions — operations sees pending child requests; zero buckets hidden", () => {
  const items = assembleProjectActions(
    { canApprove: false, canCost: true, canLogistics: true, canCreate: false },
    { waitingApproval: 9, readyForPricing: 9, costPending: 2, packPending: 0, freightPending: 1, minePriced: 0, mineDraft: 0 }
  );
  assert.deepEqual(items.map((i) => i.key), ["cost", "freight"]); // pack=0 hidden, approval gated
  assert.equal(projectActionTotal(items), 3);
});

test("assembleProjectActions — sales sees own priced + drafts; empty when nothing", () => {
  const sales = { canApprove: false, canCost: false, canLogistics: false, canCreate: true };
  const items = assembleProjectActions(sales, { waitingApproval: 0, readyForPricing: 0, costPending: 0, packPending: 0, freightPending: 0, minePriced: 1, mineDraft: 2 });
  assert.deepEqual(items.map((i) => i.key), ["quote", "draft"]);
  assert.equal(projectActionTotal(items), 3);
  const none = assembleProjectActions(sales, { waitingApproval: 0, readyForPricing: 0, costPending: 0, packPending: 0, freightPending: 0, minePriced: 0, mineDraft: 0 });
  assert.deepEqual(none, []);
  assert.equal(projectActionTotal(none), 0);
});

test("computeFreightTotal (m097) — sum of quantity × per-unit across container rows", () => {
  // 2×40HQ @ 6200 + 2×20GP @ 3500 = 12400 + 7000 = 19400
  const total = computeFreightTotal([
    { type: "40HQ", quantity: 2, freight_per_unit: 6200 },
    { type: "20GP", quantity: 2, freight_per_unit: 3500 },
  ]);
  assert.equal(total, 19400);
  // empty / missing rates → 0, no NaN
  assert.equal(computeFreightTotal([]), 0);
  assert.equal(computeFreightTotal([{ type: "40HQ", quantity: 2, freight_per_unit: null }]), 0);
  assert.ok(Number.isFinite(computeFreightTotal(undefined)));
});

test("sales_director role is wired into every role list", () => {
  assert.equal(ROLE_LABEL.sales_director, "Sales director");
  assert.equal(ROLE_SHORT_LABEL.sales_director, "Director");
  assert.ok(ASSIGNABLE_ROLES.includes("sales_director"));
  assert.ok(VIEW_AS_ROLES.includes("sales_director"));
});

test("projectContainerToDocumentType — maps project types to document ContainerType", () => {
  assert.equal(projectContainerToDocumentType("20GP"), "20ft");
  assert.equal(projectContainerToDocumentType("40GP"), "40ft");
  assert.equal(projectContainerToDocumentType("40HQ"), "40ft HC");
  assert.equal(projectContainerToDocumentType("LCL"), "LCL");
  // case-insensitive + already-document forms pass through
  assert.equal(projectContainerToDocumentType("lcl"), "LCL");
  assert.equal(projectContainerToDocumentType("40ft HC"), "40ft HC");
  // unknown / empty → safe default (still a valid document ContainerType)
  assert.equal(projectContainerToDocumentType(undefined), "40ft HC");
  assert.equal(projectContainerToDocumentType("???"), "40ft HC");
});

test("buildShippingContainersFromFreight — freight breakdown → document Shipping rows", () => {
  const rows = buildShippingContainersFromFreight([
    { type: "40HQ", quantity: 2, freight_per_unit: 6200 },
    { type: "20GP", quantity: 1, freight_per_unit: 3500 },
    { type: "LCL", quantity: 0, freight_per_unit: 900 }, // dropped (qty 0)
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    container_type: "40ft HC",
    quantity: 2,
    unit_price: 6200,
    wooden_box_cost: 0,
  });
  assert.deepEqual(rows[1], {
    container_type: "20ft",
    quantity: 1,
    unit_price: 3500,
    wooden_box_cost: 0,
  });
  // document freight total (qty × unit_price) equals the project freight total
  const docFreight = rows.reduce((s, r) => s + r.quantity * r.unit_price, 0);
  assert.equal(docFreight, computeFreightTotal([
    { type: "40HQ", quantity: 2, freight_per_unit: 6200 },
    { type: "20GP", quantity: 1, freight_per_unit: 3500 },
  ]));
  // empty / nullish → no rows, no throw
  assert.deepEqual(buildShippingContainersFromFreight([]), []);
  assert.deepEqual(buildShippingContainersFromFreight(undefined), []);
});

test("buildShippingContainers — packing drives types/qty, freight supplies cost by type", () => {
  // Packing: 2×40HQ + 1×20GP. Freight has a rate only for 40HQ.
  const rows = buildShippingContainers(
    [
      { type: "40HQ", quantity: 2 },
      { type: "20GP", quantity: 1 },
    ],
    [{ type: "40HQ", quantity: 2, freight_per_unit: 6200 }]
  );
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { container_type: "40ft HC", quantity: 2, unit_price: 6200, wooden_box_cost: 0 });
  // no freight rate for 20GP → cost 0 (user fills it in / enters freight cost)
  assert.deepEqual(rows[1], { container_type: "20ft", quantity: 1, unit_price: 0, wooden_box_cost: 0 });
});

test("buildShippingContainers — falls back to freight rows when packing is empty", () => {
  const rows = buildShippingContainers(
    [],
    [{ type: "LCL", quantity: 3, freight_per_unit: 400 }]
  );
  assert.deepEqual(rows, [{ container_type: "LCL", quantity: 3, unit_price: 400, wooden_box_cost: 0 }]);
  // both empty → no rows, no throw
  assert.deepEqual(buildShippingContainers(undefined, undefined), []);
});

test("computeFreightStatus (m098) — valid / expiring_soon / expired / none", () => {
  const today = "2026-06-08";
  // none when no validity set
  assert.equal(computeFreightStatus(null, today).status, "none");
  // valid — far future
  const valid = computeFreightStatus("2026-07-15", today);
  assert.equal(valid.status, "valid");
  assert.equal(valid.daysRemaining, 37);
  // expiring soon — <7 days
  const soon = computeFreightStatus("2026-06-12", today); // 4 days
  assert.equal(soon.status, "expiring_soon");
  assert.equal(soon.daysRemaining, 4);
  assert.match(soon.label, /expires in 4 days/);
  // boundary: exactly 7 days out → still valid (threshold is < 7)
  assert.equal(computeFreightStatus("2026-06-15", today).status, "valid");
  // expires today → expiring_soon
  const todayExp = computeFreightStatus(today, today);
  assert.equal(todayExp.status, "expiring_soon");
  assert.equal(todayExp.daysRemaining, 0);
  assert.match(todayExp.label, /today/);
  // expired — past
  const exp = computeFreightStatus("2026-04-16", today); // 53 days ago
  assert.equal(exp.status, "expired");
  assert.equal(exp.daysExpired, 53);
  assert.match(exp.label, /Expired 53 days ago|expired 53 days ago/i);
});

test("validityFromPeriod (m098) — today + N days (7/15/30 pills, owner 2026-07-08)", () => {
  assert.equal(validityFromPeriod("2026-06-08", 7), "2026-06-15");
  assert.equal(validityFromPeriod("2026-06-08", 15), "2026-06-23");
  assert.equal(validityFromPeriod("2026-06-08", 30), "2026-07-08");
  // Generic date math still works past the pill values (custom periods).
  assert.equal(validityFromPeriod("2026-06-08", 60), "2026-08-07");
});
