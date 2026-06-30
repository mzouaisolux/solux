// =====================================================================
// TEMP / VERIFY SCRIPT — confirm each test account can authenticate.
//
// Read-only: it calls signInWithPassword (the same call the real /login
// form makes) with the ANON key for each of the 6 role accounts, prints
// OK/FAIL per account, signs out, and never mutates any data.
//
// Run:
//   node --env-file=.env.local --env-file=.env.e2e \
//     --experimental-strip-types scripts/verify-login.ts
//
//   ( .env.local → URL + anon key ; .env.e2e → the 6 E2E_*_EMAIL )
//
// Password tested defaults to "Test12"; override with TEST_PASSWORD=...
// =====================================================================

import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || "";
const PASSWORD = process.env.TEST_PASSWORD ?? "Test12";

if (!URL || !ANON) {
  console.error(
    "[verify-login] Missing NEXT_PUBLIC_SUPABASE_URL / " +
      "NEXT_PUBLIC_SUPABASE_ANON_KEY — run with --env-file=.env.local",
  );
  process.exit(1);
}

interface Account {
  label: string;
  email: string | undefined;
}

const ACCOUNTS: Account[] = [
  { label: "Sales", email: process.env.E2E_SALES_EMAIL },
  { label: "Director", email: process.env.E2E_DIR_EMAIL },
  { label: "Finance", email: process.env.E2E_FINANCE_EMAIL },
  { label: "Task List Manager", email: process.env.E2E_TLM_EMAIL },
  { label: "Operations", email: process.env.E2E_OPERATION_EMAIL },
  { label: "Admin", email: process.env.E2E_ADMIN_EMAIL },
];

async function main(): Promise<void> {
  console.log("=".repeat(64));
  console.log("  VERIFY LOGIN");
  console.log(`  Target   : ${URL}`);
  console.log(`  Password : "${PASSWORD}"`);
  console.log("=".repeat(64) + "\n");

  const present = ACCOUNTS.filter((a) => a.email);
  const missing = ACCOUNTS.filter((a) => !a.email);
  for (const m of missing) {
    console.log(`  [SKIP] ${m.label.padEnd(18)} (no email in .env.e2e)`);
  }

  let ok = 0;
  const failures: { label: string; email: string; reason: string }[] = [];

  for (const acct of present) {
    const email = acct.email as string;
    // Fresh client per account so sessions never bleed across logins.
    const sb = createClient(URL, ANON, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await sb.auth.signInWithPassword({
      email,
      password: PASSWORD,
    });
    if (error) {
      failures.push({ label: acct.label, email, reason: error.message });
      console.log(
        `  [FAIL] ${acct.label.padEnd(18)} ${email} — ${error.message}`,
      );
    } else {
      ok += 1;
      console.log(
        `  [OK]   ${acct.label.padEnd(18)} ${email}  (uid ${data.user?.id})`,
      );
      await sb.auth.signOut();
    }
  }

  console.log(
    `\n[verify-login] ${ok}/${present.length} account(s) authenticated.`,
  );
  if (failures.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error("[verify-login] crashed:", e);
  process.exit(1);
});
