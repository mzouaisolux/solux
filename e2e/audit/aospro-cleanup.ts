// Cleanup the AOSPRO+ E2E test artifacts:
//   (a) revert the 5 GLOBAL factory_mappings the TLM filled with Chinese test text
//   (b) delete the TAP test client + its affair/docs/task-list/order (FK order)
// Uses the admin JWT (anon key). Verifies by re-counting after each step.
//   node --env-file=.env.local --env-file=.env.e2e --experimental-strip-types e2e/audit/aospro-cleanup.ts
import { createClient } from "@supabase/supabase-js";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim();
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim();
const PW = process.env.E2E_PASSWORD!;
const EMAIL = process.env.E2E_ADMIN_EMAIL!;

const clientId = "183863ce-f586-4f32-9669-116e1d30a6ca";
const affairId = "525c2224-0a47-4f60-a3ef-a149d98d651f";
const taskListId = "43b9fca1-cdb3-42fa-9247-b4676854c965";
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

  const count = async (t: string, col: string, val: any) => {
    const q = Array.isArray(val) ? sb.from(t).select("id", { count: "exact", head: true }).in(col, val)
                                 : sb.from(t).select("id", { count: "exact", head: true }).eq(col, val);
    const { count: c, error } = await q;
    return error ? `ERR ${error.code}` : c ?? 0;
  };
  const del = async (t: string, col: string, val: any) => {
    const q = Array.isArray(val) ? sb.from(t).delete().in(col, val) : sb.from(t).delete().eq(col, val);
    const { error } = await q;
    return error ? `ERR ${error.code} ${error.message.slice(0,60)}` : "ok";
  };

  // ---- (a) factory_mappings revert ----
  console.log("\n=== (a) revert 5 global factory_mappings ===");
  console.log("before:", await count("factory_mappings", "option_id", OPTION_IDS));
  console.log("delete:", await del("factory_mappings", "option_id", OPTION_IDS));
  console.log("after :", await count("factory_mappings", "option_id", OPTION_IDS), "(expect 0)");

  // ---- (b) delete client cascade, in FK order ----
  console.log("\n=== (b) delete TAP test data (FK order) ===");
  // production order(s)
  console.log("production_orders del:", await del("production_orders", "affair_id", affairId));
  // task list lines then task list
  console.log("production_task_list_lines del:", await del("production_task_list_lines", "task_list_id", taskListId));
  console.log("production_task_lists del:", await del("production_task_lists", "id", taskListId));
  // document lines then documents (both quotation + proforma share affair_id)
  const { data: docs } = await sb.from("documents").select("id").eq("affair_id", affairId);
  const docIds = (docs ?? []).map((d: any) => d.id);
  console.log("documents to remove:", docIds.length, docIds);
  if (docIds.length) console.log("document_lines del:", await del("document_lines", "document_id", docIds));
  console.log("documents del:", await del("documents", "affair_id", affairId));
  // affair then client
  console.log("affairs del:", await del("affairs", "id", affairId));
  console.log("clients del:", await del("clients", "id", clientId));

  // ---- verify ----
  console.log("\n=== VERIFY (all expect 0) ===");
  console.log("clients        :", await count("clients", "id", clientId));
  console.log("affairs        :", await count("affairs", "id", affairId));
  console.log("documents      :", await count("documents", "affair_id", affairId));
  console.log("task_lists     :", await count("production_task_lists", "id", taskListId));
  console.log("tl_lines       :", await count("production_task_list_lines", "task_list_id", taskListId));
  console.log("orders         :", await count("production_orders", "affair_id", affairId));
  console.log("factory_maps   :", await count("factory_mappings", "option_id", OPTION_IDS));
  await sb.auth.signOut();
}
main().catch((e) => { console.error(e); process.exit(1); });
