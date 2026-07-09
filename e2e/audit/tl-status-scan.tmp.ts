import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
await sb.auth.signInWithPassword({ email: process.env.E2E_ADMIN_EMAIL!, password: process.env.E2E_PASSWORD! });
const { data } = await sb.from("production_task_lists").select("id, number, status, date").order("date", { ascending: false }).limit(10);
for (const t of data ?? []) console.log(t.status.padEnd(18), t.number, t.date);
