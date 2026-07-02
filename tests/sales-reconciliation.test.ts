/**
 * Sales & Analytics — reconciliation §7 against the REAL source CSVs.
 *
 * This is the guard-rail the spec demands as a real automated test (not a
 * print). It runs only when data/*.csv are present (they are gitignored — real
 * customer financials); in a bare CI checkout it self-skips with a clear reason.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseOrdersCsv, parseClientsCsv, parseMonthlySalesCsv } from "../lib/sales/csv.ts";
import { reconcile } from "../lib/sales/reconcile.ts";

const DATA = path.join(process.cwd(), "data");
const FILES = ["orders.csv", "clients.csv", "monthly_sales.csv"];
const hasData = FILES.every((f) => fs.existsSync(path.join(DATA, f)));
const read = (f: string) => fs.readFileSync(path.join(DATA, f), "utf8");

test(
  "§7 control figures reconcile against data/*.csv",
  { skip: hasData ? false : "data/*.csv not present (real financials, gitignored)" },
  () => {
    const result = reconcile({
      orders: parseOrdersCsv(read("orders.csv")),
      clients: parseClientsCsv(read("clients.csv")),
      monthly: parseMonthlySalesCsv(read("monthly_sales.csv")),
    });
    assert.deepEqual(result.failures, [], "no reconciliation failures");
    assert.equal(result.ok, true);

    const byLabel = new Map(result.checks.map((c) => [c.label, c]));
    assert.equal(byLabel.get("orders total")?.actual, 1314);
    assert.equal(byLabel.get("orders 2026")?.actual, 96);
    assert.equal(byLabel.get("clients total")?.actual, 203);
    assert.equal(byLabel.get("CA total")?.ok, true);
    assert.equal(byLabel.get("HAMZA 2026")?.ok, true);
    assert.equal(byLabel.get("MEHDI 2019")?.ok, true);
    assert.equal(byLabel.get("SALES TEAM 2025")?.ok, true);
  },
);
