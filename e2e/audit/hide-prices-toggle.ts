// =====================================================================
// m142 test helper — flip the 'pricing.hide_catalogue_prices' flag.
// DML only (app_settings upsert) under a real ADMIN JWT: the RLS write
// policy (m120) allows admin/super_admin. No DDL, no service key.
//   node --env-file=.env.e2e --env-file=.env.local --experimental-strip-types \
//     e2e/audit/hide-prices-toggle.ts <0|1|read>
// =====================================================================
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const email = process.env.E2E_ADMIN_EMAIL!;
const password = process.env.E2E_PASSWORD!;
const arg = process.argv[2];

const KEY = "pricing.hide_catalogue_prices";

async function main() {
  const supabase = createClient(url, anon);
  const { error: authErr } = await supabase.auth.signInWithPassword({ email, password });
  if (authErr) throw new Error(`admin login failed: ${authErr.message}`);

  if (arg === "read" || arg === undefined) {
    const { data, error } = await supabase.from("app_settings").select("value, updated_at").eq("key", KEY).maybeSingle();
    if (error) throw new Error(error.message);
    console.log(`flag ${KEY} =`, data ? JSON.stringify(data) : "(absent → OFF)");
    return;
  }
  const v = arg === "1" ? 1 : 0;
  const { error } = await supabase.from("app_settings").upsert({
    key: KEY,
    value: { value: v },
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  console.log(`flag ${KEY} set to ${v} (${v === 1 ? "HIDDEN for non-exempt roles" : "OFF — prices visible"})`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
