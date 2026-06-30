// =====================================================================
// AUDIT — ground-truth role resolution WITHOUT a service key.
// For each test account: sign in with the ANON key (a real user JWT),
// then replay EXACTLY what lib/auth.ts getCurrentUserRole() does:
//   supabase.from("user_roles").select("role, super_admin")
//     .eq("user_id", user.id).maybeSingle()
// If RLS blocks a user from reading its own role row, data === null →
// the app resolves role=null → non-technical → wrong UI. This isolates
// "misconfigured account" vs "RLS self-read bug" empirically.
//
// Run (from ~/dev/facturation):
//   node --env-file=.env.local --env-file=.env.e2e \
//     --experimental-strip-types e2e/audit/whoami.ts
// =====================================================================

import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || "";
const PASSWORD = process.env.E2E_PASSWORD || "";
const EMAILS = [
  ["sales", process.env.E2E_SALES_EMAIL],
  ["dir", process.env.E2E_DIR_EMAIL],
  ["finance", process.env.E2E_FINANCE_EMAIL],
  ["tlm", process.env.E2E_TLM_EMAIL],
  ["operation", process.env.E2E_OPERATION_EMAIL],
  ["admin", process.env.E2E_ADMIN_EMAIL],
].filter(([, e]) => !!e) as [string, string][];

if (!URL || !ANON || !PASSWORD) {
  console.error("missing URL/ANON/PASSWORD env");
  process.exit(1);
}

async function check(label: string, email: string): Promise<void> {
  const sb = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: signIn, error: signErr } = await sb.auth.signInWithPassword({ email, password: PASSWORD });
  if (signErr || !signIn.user) {
    console.log(`  ${label.padEnd(10)} ${email.padEnd(34)} LOGIN ERROR: ${signErr?.message}`);
    return;
  }
  const uid = signIn.user.id;
  // Exact replay of getCurrentUserRole's self-read (RLS-bound).
  const { data, error } = await sb
    .from("user_roles")
    .select("role, super_admin")
    .eq("user_id", uid)
    .maybeSingle();
  const resolved = error
    ? `RLS/ERROR: ${error.code} ${error.message}`
    : data
      ? `role=${JSON.stringify(data.role)} super_admin=${JSON.stringify(data.super_admin)}`
      : "data=null  ⟵ self-read returned NOTHING (role resolves to null!)";
  console.log(`  ${label.padEnd(10)} ${email.padEnd(34)} uid=${uid.slice(0, 8)}…  ${resolved}`);
  await sb.auth.signOut();
}

async function main(): Promise<void> {
  console.log(`[whoami] self-read of user_roles under each account's own JWT @ ${URL}\n`);
  for (const [label, email] of EMAILS) {
    try { await check(label, email); } catch (e) { console.log(`  ${label} crashed: ${(e as Error).message}`); }
  }
  console.log("\nlegend: data=null means RLS forbids a user reading its OWN role → getCurrentUserRole()=null");
}
main().catch((e) => { console.error("whoami crashed:", e); process.exit(1); });
