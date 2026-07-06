/**
 * Sales & Analytics — decision engine. Built ONLY from existing register fields.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseTerms, cadence, clientSignal, arAging, baseForecast, retentionCohorts,
  growthDecomposition, hhi, collectionRisk, classifyNoise,
} from "../lib/sales/decision.ts";
import type { IntelOrder } from "../lib/sales/intelligence.ts";

const O = (p: Partial<IntelOrder>): IntelOrder => ({ year: null, month: null, saler: null, sales_amount: null, date: null, country: "—", clientCode: "C", clientName: "C", received: null, balance: null, ...p });

test("parseTerms decodes deposit % + corridor", () => {
  assert.deepEqual(parseTerms("5/5TT"), { depositPct: 50, corridor: null });
  assert.deepEqual(parseTerms("3/7TT"), { depositPct: 30, corridor: null });
  assert.deepEqual(parseTerms("100% TT HK"), { depositPct: 100, corridor: "HK" });
  assert.deepEqual(parseTerms("LC"), { depositPct: 0, corridor: null });
  assert.deepEqual(parseTerms(""), { depositPct: null, corridor: null });
});

test("cadence: mean / p90 / regularity", () => {
  const c = cadence(["2025-01-01", "2025-03-02", "2025-05-01"]);
  assert.equal(c.meanDays, 60);
  assert.equal(c.p90Days, 60);
  assert.equal(c.cv, 0);
});

test("clientSignal: personalised churn + reorder prediction", () => {
  const regular = [O({ date: "2025-01-01", sales_amount: 100 }), O({ date: "2025-03-02", sales_amount: 120 }), O({ date: "2025-05-01", sales_amount: 140 })];
  const s1 = clientSignal("C1", regular, "2025-05-15");
  assert.equal(s1.churnLevel, "ok");
  assert.equal(s1.nextAmount, 120); // avg of last 3
  assert.equal(s1.nextDate, "2025-06-30"); // last + mean(60d)

  const overdue = [O({ date: "2024-01-01", sales_amount: 100 }), O({ date: "2024-03-01", sales_amount: 100 }), O({ date: "2024-05-01", sales_amount: 100 })];
  assert.equal(clientSignal("C2", overdue, "2025-05-15").churnLevel, "lost"); // ~1 an sans commande vs cadence ~60j
});

test("arAging: buckets anchored on shipment date + top debtors", () => {
  const orders = [
    O({ clientCode: "A", clientName: "A", balance: 500, shipmentDate: "2025-02-21" }), // ~100j
    O({ clientCode: "B", clientName: "B", balance: 200, shipmentDate: "2025-05-12" }), // ~20j
    O({ clientCode: "A", clientName: "A", balance: 0, shipmentDate: "2025-05-01" }),   // paid → ignored
  ];
  const a = arAging(orders, "2025-06-01");
  assert.equal(a.totalOutstanding, 700);
  assert.equal(a.buckets.find((b) => b.label === "> 90 j")!.amount, 500);
  assert.equal(a.buckets.find((b) => b.label === "0–30 j")!.amount, 200);
  assert.equal(a.debtors[0].code, "A");
});

test("baseForecast: bottom-up (baseline × momentum, floored at YTD)", () => {
  const A = [O({ clientCode: "A", year: 2025, month: 1, date: "2025-01-15", sales_amount: 1000 }), O({ clientCode: "A", year: 2025, month: 8, date: "2025-08-10", sales_amount: 500 }), O({ clientCode: "A", year: 2026, month: 3, date: "2026-03-05", sales_amount: 1200 })];
  const f = baseForecast(A, 2026);
  assert.equal(f.curYTD, 1200);
  assert.equal(f.prevFull, 1500);
  assert.equal(f.forecastFullYear, 1800); // 1500 × 1.2 momentum
  assert.equal(f.remaining, 600);
});

test("retentionCohorts: survival by first-order year", () => {
  const orders = [
    O({ clientCode: "C1", year: 2024 }), O({ clientCode: "C1", year: 2025 }),
    O({ clientCode: "C2", year: 2024 }),
    O({ clientCode: "C3", year: 2025 }),
  ];
  const r = retentionCohorts(orders);
  const c2024 = r.cohorts.find((c) => c.year === 2024)!;
  assert.equal(c2024.size, 2);
  assert.deepEqual(c2024.retention, [1, 0.5]); // both active y0, only C1 active y+1
  assert.equal(r.avg[1], 0.5);
});

test("growthDecomposition: new / expansion / contraction / churn sum to total", () => {
  const orders = [
    O({ clientCode: "N", year: 2026, month: 1, sales_amount: 300 }),
    O({ clientCode: "E", year: 2025, month: 1, sales_amount: 100 }), O({ clientCode: "E", year: 2026, month: 1, sales_amount: 250 }),
    O({ clientCode: "K", year: 2025, month: 1, sales_amount: 200 }), O({ clientCode: "K", year: 2026, month: 1, sales_amount: 120 }),
    O({ clientCode: "X", year: 2025, month: 1, sales_amount: 300 }),
  ];
  const d = growthDecomposition(orders, 2026);
  assert.equal(d.newC, 300);
  assert.equal(d.expansion, 150);
  assert.equal(d.contraction, -80);
  assert.equal(d.churn, -300);
  assert.equal(d.newC + d.expansion + d.contraction + d.churn, d.total);
});

test("hhi concentration + collectionRisk + noise", () => {
  assert.equal(hhi([50, 50]), 0.5);
  assert.equal(hhi([100]), 1);
  assert.ok(collectionRisk([O({ piAmount: 1000, sales_amount: 1000, received: 200, balance: 800, paymentTerms: "LC" })]) >= 70);
  assert.equal(collectionRisk([O({ piAmount: 1000, sales_amount: 1000, received: 1000, balance: 0, paymentTerms: "100% TT" })]), 0);
  assert.equal(classifyNoise({ pi_no: "SLXAKA25002-C" }), "amendment");
  assert.equal(classifyNoise({ clientName: "ARTLUX 赔偿2" }), "compensation");
  assert.equal(classifyNoise({ clientName: "样品SKT15" }), "sample");
  assert.equal(classifyNoise({ clientName: "Beyond solar" }), null);
});
