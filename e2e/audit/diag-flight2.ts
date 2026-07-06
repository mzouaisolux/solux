import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
await sb.auth.signInWithPassword({ email: process.env.E2E_ADMIN_EMAIL!, password: process.env.E2E_PASSWORD! });
const { data: docs } = await sb.from("documents").select("id, number, type, status, affair_id, root_document_id, parent_document_id").order("number");
console.log("ALL DOCUMENTS:");
for (const d of (docs ?? []) as any[]) console.log(`  ${d.number} type=${d.type} status=${d.status} affair_id=${d.affair_id ?? "NULL"} root=${d.root_document_id ?? "—"} parent=${(d as any).parent_document_id ?? "—"} id=${d.id}`);
const { data: aff } = await sb.from("affairs").select("id, name");
console.log("\nAFFAIRS:", JSON.stringify(aff));
