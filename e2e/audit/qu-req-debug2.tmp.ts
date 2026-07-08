import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
const browser = await chromium.launch();
const ctx = await browser.newContext({ storageState: "e2e/.auth/operation.json" });
const page = await ctx.newPage();
await page.goto("http://localhost:3000/production/quick-update", { waitUntil: "networkidle" });
const afr = page.locator("table tbody tr", { hasText: "PO-SLX-AFR" }).first();
await afr.locator('[data-qcol="documents"]').first().click();
const dialog = page.locator('[role="dialog"]');
await dialog.waitFor({ state: "visible" });
await dialog.locator("button", { hasText: "Request requirements from Sales" }).click();
// poll for any toast text within 6s
const seen = new Set<string>();
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(300);
  const body = await page.evaluate(() => document.body.innerText);
  for (const m of body.matchAll(/(Request sent[^\n]*|Request already[^\n]*|Missing required[^\n]*|Could not[^\n]*|not linked[^\n]*|already sent[^\n]*|error[^\n]{0,80})/gi)) seen.add(m[0]);
}
console.log("toasts seen:", JSON.stringify([...seen], null, 1));
await browser.close();

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(), process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim(), { auth: { persistSession: false } });
await sb.auth.signInWithPassword({ email: process.env.E2E_OPERATION_EMAIL!, password: process.env.E2E_PASSWORD! });
const { data, error } = await sb.from("events").select("created_at, message").eq("event_type", "po.docs_requirements_requested").order("created_at", { ascending: false }).limit(3);
console.log("events:", error?.message ?? JSON.stringify(data, null, 1));
