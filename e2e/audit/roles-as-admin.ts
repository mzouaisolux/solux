// Disambiguate "row missing" vs "RLS self-read blocked": sign in as the
// admin test account (which CAN read user_roles) and dump the rows for the
// finance/operation uids that returned data=null under their own JWT.
//   node --env-file=.env.local --env-file=.env.e2e --experimental-strip-types e2e/audit/roles-as-admin.ts
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim();
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim();
const PW = process.env.E2E_PASSWORD!;

async function main() {
  const sb = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: s, error: e1 } = await sb.auth.signInWithPassword({
    email: process.env.E2E_ADMIN_EMAIL!, password: PW,
  });
  if (e1) { console.error("admin login failed:", e1.message); process.exit(1); }
  console.log(`signed in as admin uid=${s.user!.id.slice(0,8)}…\n`);

  // Can admin read ALL user_roles rows? (admin RLS policy)
  const { data, error } = await sb
    .from("user_roles")
    .select("user_id, role, super_admin")
    .order("role");
  if (error) { console.log(`admin user_roles read ERROR: ${error.code} ${error.message}`); }
  else {
    console.log(`admin sees ${data.length} user_roles rows. Test accounts:`);
    const focus: Record<string,string> = {
      "544c17f5": "finance(testfinance@)", "127c91d6": "operation(testoperation@)",
      "a5e93040": "sales", "056233e1": "dir", "ad0815a2": "tlm", "27b3b5e9": "admin",
    };
    for (const r of data) {
      const tag = focus[String(r.user_id).slice(0,8)];
      if (tag) console.log(`   ${tag.padEnd(26)} role=${JSON.stringify(r.role)} super_admin=${JSON.stringify(r.super_admin)}`);
    }
  }
  await sb.auth.signOut();
}
main().catch((e)=>{console.error(e);process.exit(1);});
