// Reusable read-only DB probe under a real role JWT (anon key, no service key).
// Verifies state the UI may hide (RLS read-back, list scoping, etc.).
//   node --env-file=.env.local --env-file=.env.e2e --experimental-strip-types \
//     e2e/audit/q.ts <role> <table> [ilikeCol] [ilikePattern] [selectCols] [limit]
import { createClient } from "@supabase/supabase-js";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim();
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim();
const PW = process.env.E2E_PASSWORD!;
const [role, table, icol, ipat, cols, limit] = process.argv.slice(2);

async function main() {
  const email = process.env[`E2E_${(role || "").toUpperCase()}_EMAIL`]!;
  const sb = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: e } = await sb.auth.signInWithPassword({ email, password: PW });
  if (e) { console.error(`login ${role} failed: ${e.message}`); process.exit(1); }
  let qb: any = sb.from(table).select(cols || "*").limit(Number(limit || 50));
  if (icol && ipat) qb = qb.ilike(icol, ipat);
  const { data, error } = await qb;
  if (error) { console.log(`[${role}] ${table} ERROR: ${error.code} ${error.message}`); }
  else {
    console.log(`[${role}] ${table}${icol ? ` ${icol} ilike '${ipat}'` : ""}: ${data.length} row(s)`);
    for (const r of data) console.log("  " + JSON.stringify(r));
  }
  await sb.auth.signOut();
}
main().catch((e) => { console.error(e); process.exit(1); });
