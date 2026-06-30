// =====================================================================
// TEMP / ADMIN SCRIPT — reset EVERY Supabase Auth user's password.
//
// ⚠️  DESTRUCTIVE: this rewrites the password of *all* users in the
//     project's Auth instance to a single shared value (default "Test").
//     Run it only against a dev/test instance you own.
//
// It uses the SUPABASE_SERVICE_ROLE_KEY (admin key — full access, bypasses
// RLS), lists every user with pagination, and updates them one by one,
// printing each affected email.
//
// Run (service-role key passed inline so it is never written to a file):
//
//   SUPABASE_SERVICE_ROLE_KEY='<your-service-role-key>' \
//     node --env-file=.env.local --experimental-strip-types \
//     scripts/reset-all-passwords.ts
//
//   ( --env-file=.env.local provides NEXT_PUBLIC_SUPABASE_URL )
//
// Optional: override the new password (must be >= 6 chars for Supabase's
// default policy) with  NEW_PASSWORD='something' before the command.
// =====================================================================

import { createClient, type User } from "@supabase/supabase-js";

// ---- Config from environment ----------------------------------------
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
  process.env.SUPABASE_URL?.trim() ||
  "";

const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
  process.env.SUPABASE_SERVICE_KEY?.trim() ||
  "";

// Default per request. Note: Supabase's default minimum is 6 characters,
// so "Test" (4 chars) may be rejected — override with NEW_PASSWORD if so.
const NEW_PASSWORD = process.env.NEW_PASSWORD ?? "Test";

const PER_PAGE = 1000;

function die(message: string): never {
  console.error(`\n[reset-passwords] ${message}\n`);
  process.exit(1);
}

if (!SUPABASE_URL) {
  die(
    "Missing NEXT_PUBLIC_SUPABASE_URL. Run with --env-file=.env.local " +
      "(it already holds the URL).",
  );
}
if (!SERVICE_ROLE_KEY) {
  die(
    "Missing SUPABASE_SERVICE_ROLE_KEY. Find it in Supabase Dashboard → " +
      "Project Settings → API → service_role secret, then pass it inline:\n" +
      "  SUPABASE_SERVICE_ROLE_KEY='eyJ...' node --env-file=.env.local " +
      "--experimental-strip-types scripts/reset-all-passwords.ts",
  );
}

// Admin client: never persist or refresh a session for a one-shot script.
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---- Fetch every user, page by page ---------------------------------
async function fetchAllUsers(): Promise<User[]> {
  const all: User[] = [];
  let page = 1;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: PER_PAGE,
    });
    if (error) die(`listUsers failed on page ${page}: ${error.message}`);

    const users = data?.users ?? [];
    all.push(...users);

    // Prefer the server-advertised next page (robust even if perPage is
    // capped server-side); fall back to a manual full-page advance.
    const nextPage = (data as { nextPage?: number | null })?.nextPage ?? null;
    if (users.length === 0) break;
    if (nextPage && nextPage > page) {
      page = nextPage;
      continue;
    }
    if (users.length < PER_PAGE) break;
    page += 1;
  }

  return all;
}

// ---- Main ------------------------------------------------------------
async function main(): Promise<void> {
  console.log("=".repeat(64));
  console.log("  RESET ALL PASSWORDS");
  console.log(`  Target : ${SUPABASE_URL}`);
  console.log(`  New password for every user: "${NEW_PASSWORD}"`);
  console.log("=".repeat(64) + "\n");

  const users = await fetchAllUsers();
  console.log(`[reset-passwords] ${users.length} user(s) found.\n`);

  let ok = 0;
  const failures: { email: string; reason: string }[] = [];

  for (const user of users) {
    const email = user.email ?? `(no-email id=${user.id})`;
    const { error } = await admin.auth.admin.updateUserById(user.id, {
      password: NEW_PASSWORD,
    });
    if (error) {
      failures.push({ email, reason: error.message });
      console.log(`  [FAIL] ${email}  — ${error.message}`);
    } else {
      ok += 1;
      console.log(`  [OK]   ${email}`);
    }
  }

  console.log(
    `\n[reset-passwords] Done: ${ok} updated, ${failures.length} failed, ` +
      `${users.length} total.`,
  );

  if (failures.length > 0) {
    const looksTooShort = failures.some((f) =>
      /password/i.test(f.reason) && /(6|short|length|character)/i.test(f.reason),
    );
    if (looksTooShort) {
      console.error(
        `\n[reset-passwords] Hint: Supabase requires >= 6 characters by ` +
          `default. Re-run with e.g. NEW_PASSWORD='Test12' ...`,
      );
    }
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("[reset-passwords] crashed:", e);
  process.exit(1);
});
