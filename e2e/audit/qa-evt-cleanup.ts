// QA Event Registry cleanup — restore the dev DB to the pre-test baseline.
// Deletes the override/routing rows this QA session created and removes the
// throwaway QA client. Run under the real ADMIN JWT (admin has m136 write RLS).
//   node --env-file=.env.local --env-file=.env.e2e --experimental-strip-types e2e/audit/qa-evt-cleanup.ts
import { createClient } from "@supabase/supabase-js";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim();
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim();
const PW = process.env.E2E_PASSWORD!;
const KEYS = [
  "client.deleted",
  "client.created",
  "admin.permissions_changed",
  "pr.quotation_generated",
  "pr.ready_for_pricing",
];
const QA_CLIENT_ID = "b32a48a8-1fe6-4d4d-8b85-2600011580d8"; // ZZZ_E2E_QA_EVT_READ (ZQR)

async function main() {
  const email = process.env.E2E_ADMIN_EMAIL!;
  const sb = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: e } = await sb.auth.signInWithPassword({ email, password: PW });
  if (e) { console.error("admin login failed:", e.message); process.exit(1); }

  const r1 = await sb.from("event_routing").delete().in("event_key", KEYS).select("event_key");
  console.log("event_routing rows deleted:", r1.error ? `ERR ${r1.error.message}` : (r1.data?.length ?? 0));
  const r2 = await sb.from("event_catalog_overrides").delete().in("event_key", KEYS).select("event_key");
  console.log("event_catalog_overrides rows deleted:", r2.error ? `ERR ${r2.error.message}` : (r2.data?.length ?? 0));

  const r3 = await sb.rpc("delete_client_safe", { target_client_id: QA_CLIENT_ID });
  console.log("delete QA client (delete_client_safe):", r3.error ? `ERR ${r3.error.message}` : "ok");

  const v1 = await sb.from("event_routing").select("event_key");
  const v2 = await sb.from("event_catalog_overrides").select("event_key");
  const v3 = await sb.from("clients").select("id").eq("id", QA_CLIENT_ID);
  console.log("REMAINING event_routing:", v1.error ? `ERR ${v1.error.message}` : v1.data?.length);
  console.log("REMAINING event_catalog_overrides:", v2.error ? `ERR ${v2.error.message}` : v2.data?.length);
  console.log("REMAINING QA client rows:", v3.error ? `ERR ${v3.error.message}` : v3.data?.length);
  await sb.auth.signOut();
}
main().catch((e) => { console.error(e); process.exit(1); });
