// Revert ONLY the 5 global factory_mappings the TLM filled with Chinese test
// text (they had no mapping before → delete restores the prior empty state).
// TAP test data is intentionally kept. Verifies by re-counting.
//   node --env-file=.env.local --env-file=.env.e2e --experimental-strip-types e2e/audit/aospro-fm-revert.ts
import { createClient } from "@supabase/supabase-js";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim();
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim();
const PW = process.env.E2E_PASSWORD!;
const EMAIL = process.env.E2E_ADMIN_EMAIL!;
const OPTION_IDS = [
  "4eb1ea64-c24e-4110-87b7-21caabce658d", // SOLAR PANEL 18V/105W
  "45006d87-51dc-454d-aea2-ecbf9d3af88e", // Battery 538Wh
  "88dccae9-47cd-474b-bb42-a0256e2267e9", // OPTIC T35
  "a50a9463-fb1d-40a3-b897-48bb124fe15e", // CCT 4000k
  "fd24089c-02b9-49ab-a98a-e2373505abcb", // Spigot 76mm
];

async function main() {
  const sb = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: e } = await sb.auth.signInWithPassword({ email: EMAIL, password: PW });
  if (e) { console.error("admin login failed:", e.message); process.exit(1); }

  const { data: before } = await sb.from("factory_mappings")
    .select("option_id, factory_instruction, factory_code").in("option_id", OPTION_IDS);
  console.log("BEFORE:", (before ?? []).length, "rows");
  for (const r of before ?? []) console.log("  ", (r as any).option_id, "→", (r as any).factory_instruction);

  const { error: delErr } = await sb.from("factory_mappings").delete().in("option_id", OPTION_IDS);
  console.log("delete:", delErr ? `ERR ${delErr.code} ${delErr.message}` : "ok");

  const { data: after } = await sb.from("factory_mappings")
    .select("option_id").in("option_id", OPTION_IDS);
  console.log("AFTER :", (after ?? []).length, "rows (expect 0)");
  await sb.auth.signOut();
}
main().catch((e) => { console.error(e); process.exit(1); });
