/**
 * Sales & Analytics — client/country/saler intelligence. Register = truth,
 * NULL amounts excluded. Trend (date-based, configurable, seasonal-aware),
 * lists, rollups, filters, insights.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildClientProfiles, clientLists, buildCountryStats, buildSalerStats, buildInsights, filterOrders, type IntelOrder,
} from "../lib/sales/intelligence.ts";

const O: IntelOrder[] = [
  { year: 2024, month: 1, date: "2024-01-01", saler: "HAMZA", country: "France", clientCode: "C1", clientName: "Alpha", sales_amount: 100, received: 100, balance: 0 },
  { year: 2025, month: 2, date: "2025-02-01", saler: "HAMZA", country: "France", clientCode: "C1", clientName: "Alpha", sales_amount: 200, received: 200, balance: 0 },
  { year: 2026, month: 2, date: "2026-02-01", saler: "HAMZA", country: "France", clientCode: "C1", clientName: "Alpha", sales_amount: 400, received: 100, balance: 300 },
  { year: 2024, month: 5, date: "2024-05-01", saler: "MEHDI", country: "USA", clientCode: "C2", clientName: "Beta", sales_amount: 500, received: 500, balance: 0 },
  { year: 2026, month: 1, date: "2026-01-01", saler: "MEHDI", country: "USA", clientCode: "C3", clientName: "Gamma", sales_amount: 50, received: 0, balance: 50 },
  { year: 2025, month: 1, date: "2025-01-01", saler: "HAMZA", country: "Spain", clientCode: "C4", clientName: "Delta", sales_amount: 300, received: 0, balance: 0 },
  { year: 2026, month: 1, date: "2026-01-05", saler: "HAMZA", country: "Spain", clientCode: "C4", clientName: "Delta", sales_amount: 100, received: 0, balance: 0 },
];

test("trend classification (date-based dormancy)", () => {
  const by = new Map(buildClientProfiles(O, 2026).map((x) => [x.code, x]));
  assert.equal(by.get("C1")!.trend, "croissance");
  assert.equal(by.get("C4")!.trend, "baisse");
  assert.equal(by.get("C3")!.trend, "nouveau");
  assert.equal(by.get("C2")!.trend, "dormant"); // last order 2024-05, >12 mois avant 2026-02
  assert.ok(by.get("C1")!.score >= by.get("C2")!.score, "active client scores higher than dormant");
  assert.ok(["Partenaire en croissance", "Compte stratégique"].includes(by.get("C1")!.label));
});

test("dormancy window is configurable + seasonal-aware", () => {
  // A recurring customer that just placed an order must NOT be dormant even with
  // a large historical gap — and the window changes what counts as dormant.
  const near = new Map(buildClientProfiles(O, 2026, { dormancyMonths: 24 }).map((x) => [x.code, x]));
  assert.notEqual(near.get("C2")!.trend, "dormant"); // 21 mois < 24 → plus dormant

  // Seasonal: orders ~ every 18 months; last was ~14 months ago → NOT dormant at a 12-month window.
  const seasonal: IntelOrder[] = [
    { year: 2023, month: 1, date: "2023-01-01", saler: "X", country: "P", clientCode: "S", clientName: "Sea", sales_amount: 100, received: 0, balance: 0 },
    { year: 2024, month: 7, date: "2024-07-01", saler: "X", country: "P", clientCode: "S", clientName: "Sea", sales_amount: 100, received: 0, balance: 0 },
    { year: 2025, month: 12, date: "2025-12-01", saler: "X", country: "P", clientCode: "S", clientName: "Sea", sales_amount: 100, received: 0, balance: 0 },
  ];
  const p = buildClientProfiles(seasonal, 2027, { dormancyMonths: 12, referenceDate: "2027-02-01" }).find((x) => x.code === "S")!;
  assert.notEqual(p.trend, "dormant"); // ~14 mois < 2× cadence (~18 mois)
});

test("filterOrders: categorical + status + missing-amount", () => {
  assert.equal(filterOrders(O, { country: "France" }).length, 3);
  assert.equal(filterOrders(O, { saler: "MEHDI" }).length, 2);
  assert.equal(filterOrders(O, { status: "paid" }).length, 3); // fully-received orders
  assert.equal(filterOrders(O, { status: "unpaid" }).length, 3); // received 0 (Gamma + 2 Delta)
  assert.equal(filterOrders(O, { minAmount: 300 }).length, 3);
});

test("client lists + rollups + insights", () => {
  const L = clientLists(buildClientProfiles(O, 2026));
  assert.equal(L.top[0].code, "C1");
  assert.ok(L.dormant.some((x) => x.code === "C2"));
  const c = new Map(buildCountryStats(O, 2026).map((x) => [x.country, x]));
  assert.equal(c.get("France")!.totalCA, 700);
  const s = new Map(buildSalerStats(O, 2026).map((x) => [x.saler, x]));
  assert.equal(s.get("HAMZA")!.curCA, 500);
  const ins = buildInsights({ refYear: 2026, prevYear: 2025, curYTD: 550, prevYTD: 500, projection: 3300, prevFull: 500, nullCount: 0, profiles: buildClientProfiles(O, 2026), countries: buildCountryStats(O, 2026), topClientShareOfYear: 0.7, topClientName: "Alpha" });
  assert.ok(ins.some((i) => /dormants/.test(i.title)) && ins.some((i) => /\+10\.0%/.test(i.title)));
});
