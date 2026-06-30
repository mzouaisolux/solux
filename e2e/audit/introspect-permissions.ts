// =====================================================================
// AUDIT — READ-ONLY introspection of the live permission ground truth.
// Uses the service-role key to SELECT (no writes) the actual role
// assignment of each test account (user_roles) and the live permission
// matrix (role_permissions × permissions), so UI anomalies can be
// classified as real permission bugs vs misconfigured test accounts.
//
// Run (service key inline, never written to a file):
//   SUPABASE_SERVICE_ROLE_KEY='...' node --env-file=.env.local \
//     --experimental-strip-types e2e/audit/introspect-permissions.ts
// =====================================================================

import { createClient } from "@supabase/supabase-js";

const URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
  process.env.SUPABASE_URL?.trim() ||
  "";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";

if (!URL || !KEY) {
  console.error(
    "[audit] Missing URL or SUPABASE_SERVICE_ROLE_KEY. Run with " +
      "--env-file=.env.local and pass the service key inline.",
  );
  process.exit(1);
}

const TEST_EMAILS = [
  "testsales@solux-light.com",
  "testlm@solux-light.com",
  "testoperation@solux-light.com",
  "testfinance@solux-light.com",
  "testdir@solux-light.com",
  "testadmin@solux-light.com",
];

const FOCUS_CAPS = [
  "finance.view",
  "forecast.view_global",
  "factory_mapping.access",
  "prospect.access",
  "project.approve",
  "project.create",
  "pricing.manage",
  "pricing.manage_costs",
  "quotation.create",
  "task_list.validate",
  "admin.manage_users",
  "admin.manage_permissions",
  "admin.diagnostics",
];

const admin = createClient(URL, KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function asKeyVal(row: Record<string, unknown>): string {
  return Object.entries(row)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(" ");
}

async function main(): Promise<void> {
  console.log(`[audit] permission introspection @ ${URL}\n`);

  // 1) Map the 6 test emails → user id.
  const idByEmail = new Map<string, string>();
  let page = 1;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) { console.error("listUsers:", error.message); break; }
    const users = data?.users ?? [];
    for (const u of users) {
      if (u.email && TEST_EMAILS.includes(u.email)) idByEmail.set(u.email, u.id);
    }
    const next = (data as { nextPage?: number | null })?.nextPage ?? null;
    if (users.length === 0) break;
    if (next && next > page) { page = next; continue; }
    if (users.length < 1000) break;
    page += 1;
  }

  // 2) user_roles for those ids (defensive on super_admin column).
  const ids = [...idByEmail.values()];
  let roleRows: Record<string, unknown>[] = [];
  {
    let r: any = await admin.from("user_roles").select("user_id, role, super_admin").in("user_id", ids);
    if (r.error) r = await admin.from("user_roles").select("user_id, role").in("user_id", ids);
    if (r.error) console.error("user_roles:", r.error.message);
    else roleRows = (r.data as Record<string, unknown>[]) ?? [];
  }
  const roleByUser = new Map<string, Record<string, unknown>>();
  for (const row of roleRows) roleByUser.set(String(row.user_id), row);

  console.log("================ TEST ACCOUNT ROLES (user_roles) ================");
  for (const email of TEST_EMAILS) {
    const id = idByEmail.get(email);
    const row = id ? roleByUser.get(id) : undefined;
    console.log(
      `  ${email.padEnd(34)} → ${
        row ? `role=${JSON.stringify(row.role)} super_admin=${JSON.stringify(row.super_admin ?? "(col?)")}` : "NO user_roles ROW (defaults to minimal/sales?)"
      }`,
    );
  }

  // 3) permissions catalog + role_permissions matrix (schema-agnostic dump).
  const permsRes = await admin.from("permissions").select("*");
  const rpRes = await admin.from("role_permissions").select("*");
  if (permsRes.error) console.error("permissions:", permsRes.error.message);
  if (rpRes.error) console.error("role_permissions:", rpRes.error.message);
  const perms = (permsRes.data as Record<string, unknown>[]) ?? [];
  const rps = (rpRes.data as Record<string, unknown>[]) ?? [];

  console.log(`\n[schema] permissions sample: ${perms[0] ? asKeyVal(perms[0]) : "(none)"}`);
  console.log(`[schema] role_permissions sample: ${rps[0] ? asKeyVal(rps[0]) : "(none)"}`);

  // Build permission_id → key map if rp references an id.
  const keyById = new Map<string, string>();
  for (const p of perms) {
    const id = (p.id ?? p.permission_id) as string | undefined;
    const key = (p.key ?? p.capability ?? p.name ?? p.slug) as string | undefined;
    if (id && key) keyById.set(String(id), String(key));
  }

  // Resolve each role_permission row to { role, capKey, enabled }.
  const grants: { role: string; cap: string; enabled: boolean }[] = [];
  for (const rp of rps) {
    const role = String(rp.role ?? rp.role_name ?? "");
    const rawCap = (rp.capability ?? rp.permission ?? rp.permission_key ?? rp.key) as string | undefined;
    const capId = (rp.permission_id ?? rp.capability_id) as string | undefined;
    const cap = rawCap ?? (capId ? keyById.get(String(capId)) : undefined) ?? "(?)";
    // enabled flag: try common column names; default true if a row simply exists.
    const enabledRaw = rp.allowed ?? rp.enabled ?? rp.granted ?? rp.value ?? true;
    const enabled = enabledRaw === true || enabledRaw === "true" || enabledRaw === 1;
    grants.push({ role, cap, enabled });
  }

  const ROLES = ["super_admin", "admin", "sales_director", "task_list_manager", "operations", "sales", "finance"];
  const has = (role: string, cap: string): string => {
    const g = grants.find((x) => x.role === role && x.cap === cap);
    if (!g) return " · ";
    return g.enabled ? " ✓ " : " ✗ ";
  };

  console.log("\n================ LIVE MATRIX (focus capabilities) ================");
  const header = "capability".padEnd(26) + ROLES.map((r) => r.slice(0, 9).padStart(10)).join("");
  console.log(header);
  console.log("-".repeat(header.length));
  for (const cap of FOCUS_CAPS) {
    console.log(cap.padEnd(26) + ROLES.map((r) => has(r, cap).padStart(10)).join(""));
  }
  console.log("\nlegend:  ✓ granted   ✗ explicit deny   · no row");

  console.log("\n================ FULL GRANTS per relevant role ================");
  const DETAIL_ROLES = ["operations", "finance", "task_list_manager", "sales_director", "sales"];
  for (const role of DETAIL_ROLES) {
    const caps = grants
      .filter((g) => g.role === role && g.enabled)
      .map((g) => g.cap)
      .sort();
    console.log(`\n${role} (${caps.length} caps):`);
    console.log("  " + (caps.join(", ") || "(none)"));
  }

  // Also dump the full capability catalog so we see every cap that exists.
  console.log("\n================ ALL CAPABILITIES (catalog) ================");
  const allKeys = perms
    .map((p) => String(p.key ?? p.capability ?? p.name ?? ""))
    .filter(Boolean)
    .sort();
  console.log("  " + allKeys.join(", "));

  console.log(`\n[audit] total role_permissions rows: ${rps.length}, permissions: ${perms.length}`);
}

main().catch((e) => {
  console.error("[audit] introspect crashed:", e);
  process.exit(1);
});
