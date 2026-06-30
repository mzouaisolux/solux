// =====================================================================
// MIGRATION RUNNER — replaces the manual "paste each migration into the
// Supabase SQL editor" convention with a deterministic, ordered runner.
//
//   Dry-run (no DB creds needed — reads schema_migrations via the anon key):
//     node --env-file=.env.local --env-file=.env.e2e --experimental-strip-types scripts/migrate.ts
//
//   Apply (needs the Postgres connection string + the `pg` package):
//     npm i pg
//     DATABASE_URL='postgres://…@…supabase.co:5432/postgres' \
//       node --env-file=.env.local --env-file=.env.e2e --experimental-strip-types scripts/migrate.ts --apply
//
// Each migration carries its own `begin; … commit;` + self-insert into
// schema_migrations (project convention, m113), so the runner just executes
// the file. Migrations already applied (filename present in schema_migrations)
// are skipped. Run order = numeric prefix.
// =====================================================================
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const MIG_DIR = path.join(process.cwd(), "supabase/migrations");

function migrationFiles(): string[] {
  return fs
    .readdirSync(MIG_DIR)
    .filter((f) => /^\d+.*\.sql$/.test(f))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10) || a.localeCompare(b));
}

async function appliedSet(): Promise<Set<string> | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anon) return null;
  const sb = createClient(url, anon, { auth: { persistSession: false } });
  if (process.env.E2E_ADMIN_EMAIL && process.env.E2E_PASSWORD) {
    await sb.auth.signInWithPassword({
      email: process.env.E2E_ADMIN_EMAIL,
      password: process.env.E2E_PASSWORD,
    });
  }
  const { data, error } = await sb.from("schema_migrations").select("filename");
  if (error) {
    console.error(`Could not read schema_migrations (${error.code}): ${error.message}`);
    return null;
  }
  return new Set((data ?? []).map((r: any) => String(r.filename)));
}

async function main(): Promise<void> {
  const all = migrationFiles();
  const applied = await appliedSet();
  if (!applied) {
    console.error("Cannot determine applied migrations — aborting (need anon key + a signed-in read).");
    process.exit(2);
  }
  const isApplied = (f: string) => applied.has(f) || applied.has(f.replace(/\.sql$/, ""));
  const pending = all.filter((f) => !isApplied(f));

  console.log(`migrations: ${all.length} total · ${applied.size} recorded applied · ${pending.length} pending`);
  for (const f of pending) console.log("  ⏳ pending: " + f);

  // The schema_migrations LEDGER was introduced at m113. Migrations applied
  // before it (001..112) ran but were never recorded, so they show as
  // "pending" here even though they ARE applied. Guard against re-applying
  // them (some pre-m113 migrations are not idempotent): require a one-time
  // backfill of the ledger first.
  const preLedger = pending.filter((f) => parseInt(f, 10) < 113);
  if (preLedger.length) {
    console.log(
      `\n⚠ ${preLedger.length} of the pending are PRE-LEDGER (< m113) and are almost certainly ALREADY applied` +
        ` — the schema_migrations ledger only started at m113. Backfill the ledger before --apply:` +
        `\n    insert into schema_migrations (filename) values ${preLedger.map((f) => `('${f}')`).join(", ")}\n    on conflict do nothing;` +
        `\n  Then this runner will only see genuinely-new migrations.`,
    );
  }

  if (!process.argv.includes("--apply")) {
    console.log(pending.length ? "\n(dry-run) after backfilling the ledger, re-run with --apply + DATABASE_URL." : "\n✅ schema up to date.");
    return;
  }
  if (!pending.length) { console.log("✅ nothing to apply."); return; }
  if (preLedger.length) { console.error("\nRefusing --apply while pre-ledger migrations show as pending (backfill the ledger first — see above)."); process.exit(2); }

  const dburl = process.env.DATABASE_URL;
  if (!dburl) { console.error("\n--apply needs DATABASE_URL (Supabase → Project Settings → Database → Connection string)."); process.exit(2); }
  let pg: any;
  // Computed specifier so tsc doesn't require the optional `pg` dep at build time
  // (it's only needed for --apply; install with `npm i pg`).
  const pgModule = "pg";
  try { pg = (await import(pgModule)).default; } catch { console.error("\n--apply needs the 'pg' package:  npm i pg"); process.exit(2); }

  const client = new pg.Client({ connectionString: dburl });
  await client.connect();
  try {
    for (const f of pending) {
      const sql = fs.readFileSync(path.join(MIG_DIR, f), "utf8");
      process.stdout.write(`applying ${f} … `);
      await client.query(sql); // file owns its begin/commit + schema_migrations self-insert
      console.log("ok");
    }
  } catch (e: any) {
    console.error(`\nFAILED: ${e.message}\n(transaction in the file rolled back; nothing partial committed)`);
    await client.end();
    process.exit(1);
  }
  await client.end();
  console.log(`\n✅ applied ${pending.length} migration(s).`);
}
main().catch((e) => { console.error(e); process.exit(1); });
