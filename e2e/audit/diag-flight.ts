// Read-only diagnostic: why a won quote does/doesn't reach "Orders in Flight".
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
await sb.auth.signInWithPassword({ email: process.env.E2E_ADMIN_EMAIL!, password: process.env.E2E_PASSWORD! });

const twelveMonthsAgo = new Date(new Date().getFullYear(), new Date().getMonth() - 11, 1);
console.log("today filter: date >=", twelveMonthsAgo.toISOString().slice(0, 10));

const counts: Record<string, number | null> = {};
for (const t of ["documents", "production_task_lists", "production_orders", "affairs", "clients"]) {
  const { count } = await sb.from(t).select("*", { count: "exact", head: true });
  counts[t] = count;
}
console.log("COUNTS:", JSON.stringify(counts));

const { data: won } = await sb.from("documents").select("id, number, type, status, date, affair_id, affair_name, archived_at").eq("status", "won");
console.log(`\nWON documents (${won?.length ?? 0}):`);
for (const d of (won ?? []) as any[]) {
  const dateOk = !!d.date && new Date(d.date) >= twelveMonthsAgo;
  console.log(`  ${d.number} type=${d.type} date=${d.date ?? "NULL"} within12mo=${dateOk} affair_id=${d.affair_id ?? "NULL"} archived=${!!d.archived_at}`);
}

const { data: tls } = await sb.from("production_task_lists").select("id, number, status, affair_id, quotation_id");
console.log(`\nTASK LISTS (${tls?.length ?? 0}):`);
for (const t of (tls ?? []) as any[]) console.log(`  ${t.number} status=${t.status} affair_id=${t.affair_id ?? "NULL"} quotation_id=${t.quotation_id ?? "NULL"}`);

const { data: pos } = await sb.from("production_orders").select("id, number, status, quotation_id").limit(20);
console.log(`\nPRODUCTION ORDERS (${pos?.length ?? 0}):`);
for (const p of (pos ?? []) as any[]) console.log(`  ${p.number} status=${p.status} quotation_id=${p.quotation_id ?? "NULL"}`);

const wonAffairIds = [...new Set((won ?? []).filter((d: any) => d.type === "quotation" && d.date && new Date(d.date) >= twelveMonthsAgo && !d.archived_at).map((d: any) => d.affair_id).filter(Boolean))];
const tlAffairs = new Set((tls ?? []).map((t: any) => t.affair_id).filter(Boolean));
console.log("\n=== DASHBOARD JOIN (Orders in Flight) ===");
console.log("won-quote affair_ids passing type/date/archive filter:", JSON.stringify(wonAffairIds));
console.log("task-list affair_ids:", JSON.stringify([...tlAffairs]));
console.log("→ MATCHES (shown in flight):", wonAffairIds.filter((a) => tlAffairs.has(a)).length);
