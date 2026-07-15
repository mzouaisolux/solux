// =====================================================================
// packing-apply-local.mjs — apply ONE packing migration to LOCAL Supabase.
//
// SAFETY: refuses to run against anything that is not a local host. This
// module's Phase-1 rule is "LOCAL dev only, never production".
//
//   node scripts/packing-apply-local.mjs supabase/migrations/173_packing_module.sql
//
// Connection: PACKING_LOCAL_DB_URL, else the Supabase-local default
// (postgres:postgres @ 127.0.0.1:54322/postgres).
// =====================================================================
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const DEFAULT_LOCAL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const url = process.env.PACKING_LOCAL_DB_URL || DEFAULT_LOCAL;

// Hard guard: only localhost / 127.0.0.1 is allowed.
const host = new URL(url).hostname;
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  console.error(`REFUSED: target host "${host}" is not local. This helper only touches local Supabase.`);
  process.exit(2);
}

const file = process.argv[2];
if (!file) { console.error("usage: node scripts/packing-apply-local.mjs <migration.sql>"); process.exit(2); }
const sql = fs.readFileSync(path.resolve(file), "utf8");

const client = new pg.Client({ connectionString: url });
await client.connect();
console.log(`connected to LOCAL db @ ${host}:${new URL(url).port}`);
try {
  await client.query(sql); // file owns its begin/commit + schema_migrations self-insert
  console.log(`✅ applied ${path.basename(file)}`);

  // Smoke — prove the seed landed.
  const c = await client.query(
    "select code, operational_cbm, rules_validated from packing_container_type order by code"
  );
  console.table(c.rows);
  const cfg = await client.query("select key, value from packing_config order by key");
  console.table(cfg.rows.map((r) => ({ key: r.key, value: JSON.stringify(r.value) })));
  const p = await client.query(
    "select reference, has_discrepancy from packing_pole_profile order by length_mm desc, flange_mm"
  );
  console.table(p.rows);
  const t = await client.query(
    "select count(*)::int as packing_tables from information_schema.tables where table_schema='public' and table_name like 'packing\\_%'"
  );
  console.log("packing_* tables present:", t.rows[0].packing_tables);
} catch (e) {
  console.error(`FAILED: ${e.message}\n(the file's own transaction rolled back — nothing partial committed)`);
  await client.end();
  process.exit(1);
}
await client.end();
