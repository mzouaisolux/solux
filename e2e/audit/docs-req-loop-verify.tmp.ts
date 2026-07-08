// =====================================================================
// VERIFY — Shipping-docs requirements loop, RESOLUTION side:
//   pending request (already sent) → Sales saves the client's BL profile
//   → po.docs_requirements_resolved emitted → gate re-armed (a new
//   request succeeds) → resolve again to leave a clean state.
// =====================================================================
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { BASE_URL, storageStatePath } from "../config.ts";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(),
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim(),
  { auth: { persistSession: false } }
);
await sb.auth.signInWithPassword({
  email: process.env.E2E_OPERATION_EMAIL!,
  password: process.env.E2E_PASSWORD!,
});
// NO signOut anywhere — global signOut revokes the browser sessions.

const { data: po } = await sb
  .from("production_orders")
  .select("id, number, client_id")
  .ilike("number", "PO-SLX-AFR%")
  .limit(1)
  .maybeSingle();
if (!po?.client_id) { console.log("no AFR order/client — abort"); process.exit(1); }
console.log(`order ${po.number} · client ${po.client_id}`);

async function lastEvent(type: string): Promise<string | null> {
  const { data } = await sb
    .from("events").select("created_at")
    .eq("entity_type", "production_order").eq("entity_id", po!.id)
    .eq("event_type", type)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data?.created_at ?? null;
}

const reqBefore = await lastEvent("po.docs_requirements_requested");
check("a request is pending before the test", !!reqBefore, reqBefore ?? "");

const browser = await chromium.launch();

// [1] Sales side: save the client's BL profile (= reviewed the checklist)
async function saveProfileAs(role: "admin" | "sales"): Promise<boolean> {
  const ctx = await browser.newContext({ storageState: storageStatePath(role) });
  const page = await ctx.newPage();
  await page.goto(`${BASE_URL}/clients/${po!.client_id}/edit`, { waitUntil: "networkidle" });
  const btn = page.locator("button", { hasText: "Save BL profile" });
  if ((await btn.count()) === 0) { await ctx.close(); return false; }
  await btn.click();
  await page.locator("text=Saved").first().waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await ctx.close();
  return true;
}
const saved = await saveProfileAs("admin");
check("BL profile saved (as admin, same action Sales uses)", saved);

const resAfter = await lastEvent("po.docs_requirements_resolved");
check(
  "po.docs_requirements_resolved emitted after the save",
  !!resAfter && (!reqBefore || Date.parse(resAfter) > Date.parse(reqBefore)),
  resAfter ?? "(none)"
);

// [2] Gate re-armed: a new request from Operations succeeds
const opCtx = await browser.newContext({ storageState: storageStatePath("operation") });
const opPage = await opCtx.newPage();
await opPage.goto(`${BASE_URL}/production/quick-update`, { waitUntil: "networkidle" });
const afr = opPage.locator("table tbody tr", { hasText: "PO-SLX-AFR" }).first();
await afr.locator('[data-qcol="documents"]').first().click();
const dialog = opPage.locator('[role="dialog"]');
await dialog.waitFor({ state: "visible" });
await dialog.locator("button", { hasText: "Request requirements from Sales" }).click();
await opPage.waitForTimeout(2500);
const req2 = await lastEvent("po.docs_requirements_requested");
check(
  "gate re-armed — a NEW request lands after resolution",
  !!req2 && !!reqBefore && Date.parse(req2) > Date.parse(reqBefore),
  req2 ?? "(none)"
);
await opCtx.close();

// [3] leave clean: resolve the new request too
await saveProfileAs("admin");
const resFinal = await lastEvent("po.docs_requirements_resolved");
check(
  "final resolution closes the loop (clean state)",
  !!resFinal && !!req2 && Date.parse(resFinal) > Date.parse(req2),
  resFinal ?? "(none)"
);

await browser.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
