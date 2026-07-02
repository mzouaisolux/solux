// =====================================================================
// SALES-HISTORY IMPORT — idempotent loader for the Sales & Analytics module.
//
//   Dry-run (no DB, just parse + reconcile the CSVs — proves the data):
//     node --experimental-strip-types scripts/import-sales-history.ts --dry-run
//
//   Import (needs the Postgres connection string + the `pg` package):
//     npm i pg
//     DATABASE_URL='postgres://…@…supabase.co:5432/postgres' \
//       node --experimental-strip-types scripts/import-sales-history.ts
//   (or: DATABASE_URL='…' npm run import:sales)
//
// Reads data/{orders,clients,monthly_sales,merge_suggestions}.csv. Every write
// is an UPSERT keyed on a stable natural key (salers.name, sales_clients.code,
// aliases.normalized_key, sales_orders.import_key, monthly (year,month,saler)),
// so re-running never duplicates. It reconciles the CSVs BEFORE touching the DB
// and again AFTER (counts + control figures) and fails loudly + rolls back if a
// single §7 control is off. The bulk load runs as the postgres role (bypasses
// RLS), so it is the owner's job, exactly like migrate.ts --apply.
// =====================================================================
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  parseOrdersCsv,
  parseClientsCsv,
  parseMonthlySalesCsv,
  parseMergeSuggestionsCsv,
  type OrderRow,
} from "../lib/sales/csv.ts";
import { normalizedClientKey } from "../lib/sales/client-key.ts";
import { reconcile, EXPECTED } from "../lib/sales/reconcile.ts";

const DATA = path.join(process.cwd(), "data");
const DRY = process.argv.includes("--dry-run");
const HISTORICAL_CURRENCY = "USD"; // orders.csv has no currency column; editable per-row afterwards
const MONEY_TOL = 2;

function read(f: string): string {
  return fs.readFileSync(path.join(DATA, f), "utf8");
}

/** Deterministic per-row key → idempotent re-import (same file ⇒ same keys). */
function importKey(o: OrderRow): string {
  const parts = [
    o.client_id, o.pi_no, o.year, o.month, o.order_date, o.pi_amount, o.sales_amount,
    o.transportation, o.received_amount, o.bank_charge, o.balance, o.shipment_date,
    o.eta_note, o.pickup, o.client_raw, o.country_raw, o.saler_raw,
  ];
  return crypto.createHash("sha1")
    .update(parts.map((p) => (p == null ? "" : String(p))).join(""))
    .digest("hex");
}

async function main(): Promise<void> {
  const orders = parseOrdersCsv(read("orders.csv"));
  const clients = parseClientsCsv(read("clients.csv"));
  const monthly = parseMonthlySalesCsv(read("monthly_sales.csv"));
  const mergePath = path.join(DATA, "merge_suggestions.csv");
  const merges = fs.existsSync(mergePath) ? parseMergeSuggestionsCsv(fs.readFileSync(mergePath, "utf8")) : [];

  // Pre-flight: reconcile the CSVs before touching the DB.
  const pre = reconcile({ orders, clients, monthly });
  if (!pre.ok) {
    console.error("✗ Pre-import reconciliation FAILED:\n  " + pre.failures.join("\n  "));
    process.exit(1);
  }
  console.log(`✓ CSV reconciliation OK — ${orders.length} orders, ${clients.length} clients, ${monthly.length} monthly rows, ${merges.length} merge suggestions.`);

  if (DRY) {
    console.log("(dry-run) parsed + reconciled; no database writes.");
    return;
  }

  const dburl = process.env.DATABASE_URL;
  if (!dburl) {
    console.error("✗ Set DATABASE_URL to import (Supabase → Project Settings → Database → Connection string). Dry-run works without it.");
    process.exit(2);
  }
  let pg: any;
  const pgModule = "pg"; // computed specifier so tsc doesn't require the optional dep
  try { pg = (await import(pgModule)).default; }
  catch { console.error("✗ needs the 'pg' package:  npm i pg"); process.exit(2); }

  const client = new pg.Client({ connectionString: dburl });
  await client.connect();
  try {
    await client.query("begin");

    // 1. salers (distinct across both files) -----------------------------------
    const salerNames = [...new Set(
      [...monthly.map((m) => m.saler), ...orders.map((o) => (o.saler ?? "").toUpperCase())].filter(Boolean),
    )];
    const salerId = new Map<string, string>();
    for (const name of salerNames) {
      const { rows } = await client.query(
        `insert into salers (name) values ($1)
           on conflict (name) do update set name = excluded.name
         returning id`, [name]);
      salerId.set(name, rows[0].id);
    }

    // 2. sales_clients (editable master, keyed on canonical code) ---------------
    const clientId = new Map<string, string>();
    for (const c of clients) {
      const { rows } = await client.query(
        `insert into sales_clients (code, name, main_country, first_year, last_year)
           values ($1,$2,$3,$4,$5)
           on conflict (code) do update set
             name = excluded.name, main_country = excluded.main_country,
             first_year = excluded.first_year, last_year = excluded.last_year, updated_at = now()
         returning id`,
        [c.client_id, c.client_name, c.main_country, c.first_year, c.last_year]);
      clientId.set(c.client_id, rows[0].id);
    }

    // 3. aliases — canonical name + every spelling variant, deduped by key ------
    let aliasInserted = 0, aliasCollisions = 0;
    for (const c of clients) {
      const scid = clientId.get(c.client_id);
      const seen = new Set<string>();
      for (const raw of [c.client_name, ...c.spelling_variants]) {
        const key = normalizedClientKey(raw);
        if (!key || seen.has(key)) continue;   // skip empty (all-CJK labels) + intra-client dups
        seen.add(key);
        const res = await client.query(
          `insert into sales_client_aliases (sales_client_id, raw_text, normalized_key, source)
             values ($1,$2,$3,'import') on conflict (normalized_key) do nothing`,
          [scid, raw, key]);
        if (res.rowCount === 1) aliasInserted++;
        else { aliasCollisions++; console.warn(`  · alias key collision (kept separate): "${raw}" → ${key} (client ${c.client_id})`); }
      }
    }

    // 4. sales_orders — stable occurrence suffix for BYTE-IDENTICAL duplicate
    //    rows (orders.csv genuinely contains some; the 1314 control counts them).
    const keySeen = new Map<string, number>();
    for (const o of orders) {
      const scid = clientId.get(o.client_id) ?? null;
      const sid = o.saler ? (salerId.get(o.saler.toUpperCase()) ?? null) : null;
      const base = importKey(o);
      const nOcc = (keySeen.get(base) ?? 0) + 1;
      keySeen.set(base, nOcc);
      const ikey = nOcc === 1 ? base : `${base}#${nOcc}`;
      await client.query(
        `insert into sales_orders (
           sales_client_id, saler_id, year, month, order_date, country, pi_no, payment_terms,
           pi_amount, sales_amount, transportation, received_amount, bank_charge, balance,
           amount_status, currency, shipment_date, eta_note, pickup,
           client_raw, country_raw, saler_raw, source, import_key)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'invoiced',$15,$16,$17,$18,$19,$20,$21,'excel_import',$22)
         on conflict (import_key) do update set
           sales_client_id=excluded.sales_client_id, saler_id=excluded.saler_id, year=excluded.year,
           month=excluded.month, order_date=excluded.order_date, country=excluded.country,
           pi_no=excluded.pi_no, payment_terms=excluded.payment_terms, pi_amount=excluded.pi_amount,
           sales_amount=excluded.sales_amount, transportation=excluded.transportation,
           received_amount=excluded.received_amount, bank_charge=excluded.bank_charge,
           balance=excluded.balance, currency=excluded.currency, shipment_date=excluded.shipment_date,
           eta_note=excluded.eta_note, pickup=excluded.pickup, client_raw=excluded.client_raw,
           country_raw=excluded.country_raw, saler_raw=excluded.saler_raw, updated_at=now()`,
        [scid, sid, o.year, o.month, o.order_date, o.country, o.pi_no, o.payment_terms,
         o.pi_amount, o.sales_amount, o.transportation, o.received_amount, o.bank_charge, o.balance,
         HISTORICAL_CURRENCY, o.shipment_date, o.eta_note, o.pickup, o.client_raw, o.country_raw, o.saler_raw,
         ikey]);
    }

    // 5. monthly_sales_history (the frozen §3 truth) ---------------------------
    for (const m of monthly) {
      await client.query(
        `insert into monthly_sales_history (year, month, label, saler_id, sales, is_reconstructed)
           values ($1,$2,$3,$4,$5,$6)
           on conflict (year, month, saler_id) do update set
             label=excluded.label, sales=excluded.sales, is_reconstructed=excluded.is_reconstructed`,
        [m.year, m.month, m.label, salerId.get(m.saler) ?? null, m.sales, m.is_reconstructed]);
    }

    // 6. merge suggestions → pending queue (resolved by exact canonical name) --
    const byName = new Map<string, string[]>();
    for (const c of clients) {
      const k = c.client_name.trim().toLowerCase();
      if (!k) continue;
      const arr = byName.get(k) ?? [];
      arr.push(clientId.get(c.client_id) as string);
      byName.set(k, arr);
    }
    let mergeLoaded = 0, mergeSkipped = 0;
    for (const s of merges) {
      const a = byName.get(s.client_a.trim().toLowerCase());
      const b = byName.get(s.client_b.trim().toLowerCase());
      if (!a || !b || a.length !== 1 || b.length !== 1) {
        mergeSkipped++;
        console.warn(`  · merge suggestion skipped (unknown/ambiguous name): "${s.client_a}" ↔ "${s.client_b}"`);
        continue;
      }
      await client.query(
        `insert into sales_merge_suggestions (client_a_id, client_b_id, score, source, status)
           values ($1,$2,$3,'import','pending') on conflict (client_a_id, client_b_id) do nothing`,
        [a[0], b[0], s.score]);
      mergeLoaded++;
    }

    // ── POST-IMPORT reconciliation (fail loudly, roll back) ──────────────────
    const failures: string[] = [];
    const one = async (sql: string, params: any[] = []) => (await client.query(sql, params)).rows;

    const oc = (await one(`select count(*)::int n from sales_orders`))[0].n;
    if (oc !== EXPECTED.ordersTotal) failures.push(`sales_orders = ${oc} (expected ${EXPECTED.ordersTotal})`);
    const cc = (await one(`select count(*)::int n from sales_clients`))[0].n;
    if (cc !== EXPECTED.clientsTotal) failures.push(`sales_clients = ${cc} (expected ${EXPECTED.clientsTotal})`);

    const yearRows = await one(`select year, count(*)::int n from sales_orders group by year`);
    const yearMap = new Map<number, number>(yearRows.map((r: any) => [Number(r.year), r.n]));
    for (const [y, exp] of Object.entries(EXPECTED.ordersByYear)) {
      const got = yearMap.get(Number(y)) ?? 0;
      if (got !== exp) failures.push(`orders ${y} = ${got} (expected ${exp})`);
    }

    for (const c of EXPECTED.salerControls) {
      const rows = await one(
        `select coalesce(sum(m.sales),0)::float total
           from monthly_sales_history m join salers s on s.id = m.saler_id
          where s.name = $1 and m.year = $2`, [c.saler, c.year]);
      const got = rows[0].total;
      if (Math.abs(got - c.expected) > MONEY_TOL) failures.push(`${c.saler} ${c.year} = ${got} (expected ${c.expected})`);
    }

    if (failures.length) {
      console.error("✗ POST-IMPORT reconciliation FAILED:\n  " + failures.join("\n  "));
      await client.query("rollback");
      process.exit(1);
    }

    await client.query("commit");
    console.log(`✅ imported — ${clients.length} clients, ${aliasInserted} aliases (${aliasCollisions} collisions surfaced), ${orders.length} orders, ${monthly.length} monthly rows, ${mergeLoaded} merge suggestions (${mergeSkipped} skipped).`);
    console.log(`✅ post-import reconciliation OK — 1314 orders / 203 clients / saler controls all green.`);
  } catch (e) {
    try { await client.query("rollback"); } catch { /* ignore */ }
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
