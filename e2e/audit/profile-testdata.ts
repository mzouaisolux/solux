// =====================================================================
// Test-data PROFILER (read-only). Signs in as admin and classifies rows
// as TEST (explicit markers) vs OTHER, across the tables that feed the
// bell / feed / dashboard, so we can build an exact deletion manifest
// BEFORE removing anything. Nothing is written or deleted here.
// Run: node --env-file=.env.local --env-file=.env.e2e --experimental-strip-types e2e/audit/profile-testdata.ts
// =====================================================================

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const email = process.env.E2E_ADMIN_EMAIL!;
const password = process.env.E2E_PASSWORD!;

// Explicit test markers seen in the app + likely fixtures.
const TEST_RE =
  /\b(zzz|e2e|test|vocal|xyz\d*|fake|dummy|demo|sample|qa[_-]?|jsclick|foobar|asdf|qwer|lorem|kjdsh|placeholder|do not use|ignore)\b/i;
const isTest = (s: unknown) => typeof s === "string" && TEST_RE.test(s);

function bucket(rows: any[], nameFields: string[]) {
  const test: any[] = [], other: any[] = [];
  for (const r of rows) {
    const hay = nameFields.map((f) => r[f]).filter(Boolean).join(" ");
    (isTest(hay) ? test : other).push(r);
  }
  return { test, other };
}

async function main() {
  const sb = createClient(url, anon, { auth: { persistSession: false } });
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`admin sign-in failed: ${error.message}`);
  console.log(`[profile] admin session ok\n`);

  const count = async (t: string, q?: (x: any) => any) => {
    let query = sb.from(t).select("*", { count: "exact", head: true });
    if (q) query = q(query);
    const { count: c, error: e } = await query;
    return e ? `ERR(${e.message.slice(0, 40)})` : c ?? 0;
  };

  // ---- headline volumes ----
  console.log("=== TABLE VOLUMES ===");
  for (const t of [
    "events", "event_comments", "entity_messages",
    "clients", "affairs", "documents",
    "production_orders", "production_task_lists",
    "project_requests", "planned_actions", "quotation_reminders",
  ]) {
    console.log(`  ${t.padEnd(24)} ${await count(t)}`);
  }

  // ---- clients ----
  const { data: clients } = await sb.from("clients").select("id, company_name, client_code, created_at");
  const cb = bucket(clients ?? [], ["company_name", "client_code"]);
  console.log(`\n=== CLIENTS: ${clients?.length} total → TEST=${cb.test.length}, other=${cb.other.length} ===`);
  console.log("  TEST-marked:");
  for (const c of cb.test) console.log(`    · ${c.company_name}  [${c.client_code ?? "—"}]`);
  console.log("  OTHER (kept as legitimate unless you say otherwise):");
  for (const c of cb.other.slice(0, 40)) console.log(`    · ${c.company_name}  [${c.client_code ?? "—"}]`);

  // ---- affairs ----
  const { data: affairs } = await sb.from("affairs").select("id, name, status, created_at, client_id");
  const ab = bucket(affairs ?? [], ["name"]);
  console.log(`\n=== AFFAIRS: ${affairs?.length} total → TEST=${ab.test.length}, other=${ab.other.length} ===`);
  console.log("  TEST-marked:");
  for (const a of ab.test) console.log(`    · ${a.name}  (${a.status})`);
  console.log("  OTHER:");
  for (const a of ab.other.slice(0, 40)) console.log(`    · ${a.name}  (${a.status})`);

  // ---- documents ----
  const { data: docs } = await sb.from("documents").select("id, number, affair_name, status, client_id");
  const db = bucket(docs ?? [], ["number", "affair_name"]);
  console.log(`\n=== DOCUMENTS: ${docs?.length} total → TEST=${db.test.length}, other=${db.other.length} ===`);
  console.log("  OTHER (sample):");
  for (const d of db.other.slice(0, 30)) console.log(`    · ${d.number}  «${d.affair_name ?? "—"}»  (${d.status})`);

  // ---- production orders / task lists ----
  const { data: pos } = await sb.from("production_orders").select("id, number");
  const pob = bucket(pos ?? [], ["number"]);
  console.log(`\n=== PRODUCTION ORDERS: ${pos?.length} → TEST(by number)=${pob.test.length}, other=${pob.other.length} ===`);
  const { data: tls } = await sb.from("production_task_lists").select("id, number, status");
  const tlb = bucket(tls ?? [], ["number"]);
  console.log(`=== TASK LISTS: ${tls?.length} → TEST(by number)=${tlb.test.length}, other=${tlb.other.length} ===`);
  const underVal = (tls ?? []).filter((t: any) => t.status === "under_validation");
  console.log(`  under_validation (drive the bell review prompt): ${underVal.length} → ${underVal.map((t: any) => t.number).join(", ")}`);

  // ---- entity_messages (the note threads) ----
  const { data: em } = await sb.from("entity_messages").select("*").limit(500);
  const emKeys = em && em[0] ? Object.keys(em[0]) : [];
  console.log(`\n=== ENTITY_MESSAGES: ${em?.length} rows; columns: ${emKeys.join(", ")} ===`);
  const bodyField = ["body", "message", "content", "text", "comment"].find((k) => emKeys.includes(k));
  console.log(`  (body field = ${bodyField ?? "?"})`);
  let emTest = 0;
  for (const m of em ?? []) {
    const b = bodyField ? (m as any)[bodyField] : "";
    if (isTest(b) || isTest((m as any).entity_type)) emTest++;
  }
  console.log(`  bodies matching test markers: ${emTest} / ${em?.length}`);
  console.log("  sample bodies:");
  for (const m of (em ?? []).slice(0, 12)) {
    const b = bodyField ? String((m as any)[bodyField] ?? "") : "";
    console.log(`    · [${(m as any).entity_type}] ${b.slice(0, 70).replace(/\n/g, " ")}`);
  }

  // ---- events age spread ----
  const { data: oldest } = await sb.from("events").select("created_at").order("created_at", { ascending: true }).limit(1);
  const { data: newest } = await sb.from("events").select("created_at").order("created_at", { ascending: false }).limit(1);
  console.log(`\n=== EVENTS age: oldest=${oldest?.[0]?.created_at?.slice(0,10)} newest=${newest?.[0]?.created_at?.slice(0,10)} ===`);

  await sb.auth.signOut();
  console.log("\n[profile] done (read-only).");
}

main().catch((e) => { console.error("[profile] crashed:", e); process.exit(1); });
