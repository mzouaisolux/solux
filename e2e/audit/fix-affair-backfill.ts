// Targeted backfill: attach the orphaned CDJ production chain to its only
// affair ("Eclairage Demo 4 July"), so it re-appears in Orders in Flight.
// Precise IDs only — touches nothing else. Verifies the dashboard join after.
import { createClient } from "@supabase/supabase-js";

const AFFAIR = "2b892a8f-e091-41ce-9f92-57cd805c9c5b";
const PROFORMA = "d4f63d86-1d9c-4099-91ad-84f2215f6a4b";
const QUOTE_003 = "f480ad8d-100c-478d-9854-543bbddbb2ee";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
await sb.auth.signInWithPassword({ email: process.env.E2E_ADMIN_EMAIL!, password: process.env.E2E_PASSWORD! });

async function upd(table: string, match: Record<string, any>) {
  const { data, error } = await sb.from(table).update({ affair_id: AFFAIR }).match(match).is("affair_id", null).select("id");
  return error ? `ERR ${error.message}` : `${data?.length ?? 0} row(s)`;
}

console.log("documents (003):   ", await upd("documents", { id: QUOTE_003 }));
console.log("documents (proforma):", await upd("documents", { id: PROFORMA }));
console.log("task_lists:        ", await upd("production_task_lists", { quotation_id: PROFORMA }));
console.log("production_orders: ", await upd("production_orders", { quotation_id: PROFORMA }));

// verify the join
const twelve = new Date(new Date().getFullYear(), new Date().getMonth() - 11, 1);
const { data: won } = await sb.from("documents").select("affair_id, type, date, archived_at").eq("status", "won");
const { data: tls } = await sb.from("production_task_lists").select("affair_id");
const wonAff = new Set((won ?? []).filter((d: any) => d.type === "quotation" && d.date && new Date(d.date) >= twelve && !d.archived_at).map((d: any) => d.affair_id).filter(Boolean));
const tlAff = new Set((tls ?? []).map((t: any) => t.affair_id).filter(Boolean));
const matches = [...wonAff].filter((a) => tlAff.has(a));
console.log(`\nJOIN CHECK → won-affairs=${[...wonAff].length} tl-affairs=${[...tlAff].length} MATCHES=${matches.length}`);
console.log(matches.length > 0 ? "✓ Orders in Flight will now show the order." : "✗ still no match — investigate further.");
