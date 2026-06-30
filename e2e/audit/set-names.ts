// One-off: give the test accounts a display_name (audit F7) so the UI shows
// names instead of "User · xxxx". user_profiles write is ADMIN-only (regular
// users get RLS 42501 — they can't self-edit their name), so this signs in as
// the admin test account and upserts each profile by UID. Idempotent.
//   node --env-file=.env.local --env-file=.env.e2e --experimental-strip-types e2e/audit/set-names.ts
import { createClient } from "@supabase/supabase-js";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim();
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim();
const PW = process.env.E2E_PASSWORD!;
// Full UIDs captured by whoami.ts earlier.
const PROFILES: [string, string][] = [
  ["a5e93040-c734-4fe9-b9de-423f81108e61", "Sam Sales"],
  ["056233e1-2615-4cbc-ba3c-ce36ae7a7cb1", "Dana Director"],
  ["ad0815a2-d1db-4ae6-a122-ae3ca06372a1", "Tom TaskList"],
  ["127c91d6-611f-4349-818c-09305aaf0a92", "Olivia Ops"],
  ["544c17f5-9407-4a80-b9b5-48c007d7f254", "Fiona Finance"],
];
async function main() {
  const sb = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: e1 } = await sb.auth.signInWithPassword({ email: process.env.E2E_ADMIN_EMAIL!, password: PW });
  if (e1) { console.error("admin login failed:", e1.message); process.exit(1); }
  for (const [uid, name] of PROFILES) {
    const { error } = await sb.from("user_profiles").upsert({ user_id: uid, display_name: name }, { onConflict: "user_id" });
    console.log(`  ${uid.slice(0, 8)}…  → "${name}"  ${error ? "ERR: " + error.code + " " + error.message : "✓"}`);
  }
  await sb.auth.signOut();
}
main().catch((e) => { console.error(e); process.exit(1); });
