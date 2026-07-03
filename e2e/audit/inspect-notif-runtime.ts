// =====================================================================
// Runtime notification INSPECTION (facts, no assumptions). Signs in as the
// real admin and queries the authoritative DB state that feeds the bell /
// feed, so we can name the EXACT source of anything that shows up.
// Run: node --env-file=.env.local --env-file=.env.e2e --experimental-strip-types e2e/audit/inspect-notif-runtime.ts
// =====================================================================

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const email = process.env.E2E_ADMIN_EMAIL!;
const password = process.env.E2E_PASSWORD!;

const iso30 = new Date(Date.now() - 30 * 864e5).toISOString();

async function main() {
  const sb = createClient(url, anon, { auth: { persistSession: false } });
  const { error: authErr } = await sb.auth.signInWithPassword({ email, password });
  if (authErr) throw new Error(`admin sign-in failed: ${authErr.message}`);
  console.log(`[inspect] signed in as admin (${email})\n`);

  // ---- 1. How many events are NOTIFICATION-ENABLED (master '*' rows) ----
  const { data: masters, error: mErr } = await sb
    .from("event_routing")
    .select("event_key, enabled")
    .eq("consumer", "notification")
    .eq("role", "*");
  const enabledEvents = (masters ?? []).filter((r: any) => r.enabled !== false);
  console.log("=== OPT-IN MASTER STATE ===");
  if (mErr) console.log(`  (event_routing error: ${mErr.message})`);
  console.log(`  notification-enabled events: ${enabledEvents.length}`);
  if (enabledEvents.length) console.log(`    → ${enabledEvents.map((r: any) => r.event_key).join(", ")}`);

  // per-role channel overrides (would matter only if the event were enabled)
  const { data: perRole } = await sb
    .from("event_routing")
    .select("event_key, role")
    .eq("consumer", "notification")
    .neq("role", "*");
  console.log(`  per-role channel rows (dormant unless enabled): ${(perRole ?? []).length}`);

  // ---- 2. The events table (what the FEED + bell-creation-push read) ----
  const { count: totalEvents } = await sb.from("events").select("*", { count: "exact", head: true });
  const { count: recentEvents } = await sb
    .from("events")
    .select("*", { count: "exact", head: true })
    .gte("created_at", iso30);
  const { data: newest } = await sb
    .from("events")
    .select("event_type, severity, status, created_at")
    .order("created_at", { ascending: false })
    .limit(8);
  console.log("\n=== EVENTS TABLE (audit log; feeds /operations + bell recompute) ===");
  console.log(`  total events (all time): ${totalEvents ?? "?"}`);
  console.log(`  events in last 30 days:  ${recentEvents ?? "?"}  ← the window the bell/feed use`);
  console.log("  newest 8:");
  for (const e of (newest ?? []) as any[]) {
    console.log(`    ${e.created_at?.slice(0, 16)}  ${String(e.event_type).padEnd(26)} sev=${e.severity} status=${e.status}`);
  }

  // How many of the last-30d events WOULD have belled under the OLD system
  // (high/critical) — i.e. what opt-in now suppresses.
  const { count: wouldBell } = await sb
    .from("events")
    .select("*", { count: "exact", head: true })
    .gte("created_at", iso30)
    .in("severity", ["high", "critical"]);
  console.log(`  of those, high/critical (OLD system would bell): ${wouldBell ?? "?"}  ← opt-in now suppresses these`);

  // ---- 3. NON-GATED bell sources -----------------------------------
  console.log("\n=== NON-GATED BELL SOURCES (independent of opt-in) ===");
  // 3a. task lists awaiting validation → the "N awaiting your review" item
  const { count: underVal } = await sb
    .from("production_task_lists")
    .select("*", { count: "exact", head: true })
    .eq("status", "under_validation");
  console.log(`  task lists under_validation (→ review prompt): ${underVal ?? "?"}`);
  // 3b. event comments (→ unread-comment items)
  const { count: comments } = await sb.from("event_comments").select("*", { count: "exact", head: true });
  console.log(`  event_comments total (→ unread-comment items): ${comments ?? "?"}`);
  // 3c. entity messages (→ note threads)
  const { count: messages, error: msgErr } = await sb
    .from("entity_messages")
    .select("*", { count: "exact", head: true });
  console.log(`  entity_messages total (→ note threads): ${msgErr ? "n/a (" + msgErr.message + ")" : messages ?? "?"}`);

  console.log("\n[inspect] done.");
  await sb.auth.signOut();
}

main().catch((e) => {
  console.error("[inspect] crashed:", e);
  process.exit(1);
});
