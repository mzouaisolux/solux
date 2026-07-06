import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
await sb.auth.signInWithPassword({ email: process.env.E2E_ADMIN_EMAIL!, password: process.env.E2E_PASSWORD! });
const { data: docs } = await sb.from("documents").select("id, number, type, status, affair_id, root_document_id").order("number");
console.log("ALL DOCUMENTS (", docs?.length, "):");
for (const d of (docs ?? []) as any[]) console.log(`  ${d.number.padEnd(18)} type=${String(d.type).padEnd(10)} status=${String(d.status).padEnd(16)} affair_id=${d.affair_id ?? "NULL"}  id=${d.id}`);
