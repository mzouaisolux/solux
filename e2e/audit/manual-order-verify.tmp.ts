// =====================================================================
// VERIFY (POST-m155) — Manual production orders in Quick Update.
// Run AFTER applying supabase/migrations/155_manual_production_orders.sql.
//
// Real Operations session, real dev server, real DB writes:
//   1. "+ Add order" button visible for Operations
//   2. Create a manual order (free-text client, total 10 000, deposit 30%)
//   3. Row appears with the "M" pill; Deposit shows 0 / 3,000 (red dot)
//   4. Payment popover exposes Order total / Deposit % + receipt entry;
//      recording the 3 000 deposit turns the state
//   5. The order detail page opens WITHOUT crashing (doc-less order)
//   6. Cleanup: delete the test row (operation JWT via anon REST)
//
// Run (from ~/dev/facturation, dev server on :3000):
//   node --env-file=.env.local --env-file=.env.e2e \
//     --experimental-strip-types e2e/audit/manual-order-verify.tmp.ts
// =====================================================================

import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { BASE_URL, storageStatePath } from "../config.ts";

const NUMBER = `MANU-TEST-${Math.floor(Math.random() * 1_000_000)}`;

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

async function cleanup(): Promise<void> {
  const URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
  const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || "";
  const email = process.env.E2E_OPERATION_EMAIL || "";
  const password = process.env.E2E_PASSWORD || "";
  if (!URL || !ANON || !email || !password) {
    console.log("  (cleanup skipped — missing env)");
    return;
  }
  const sb = createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await sb.auth.signInWithPassword({ email, password });
  const { error } = await sb
    .from("production_orders")
    .delete()
    .eq("number", NUMBER)
    .eq("source", "manual");
  console.log(
    error ? `  (cleanup error: ${error.message})` : `  (cleanup: ${NUMBER} deleted)`
  );
  // NO signOut: global signOut would revoke the browser session's tokens too
}

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    storageState: storageStatePath("operation"),
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  console.log(`[1] Button + modal (as Operations) — test number ${NUMBER}`);
  await page.goto(`${BASE_URL}/production/quick-update`, {
    waitUntil: "networkidle",
  });
  const btn = page.locator("button", { hasText: "+ Add order" });
  check("+ Add order button visible", (await btn.count()) === 1);
  await btn.click();
  check(
    "modal open",
    await page.locator("text=Add order manually").isVisible()
  );

  console.log("[2] Create the manual order");
  await page.fill('input[placeholder*="existing number"]', NUMBER);
  await page.fill('input[placeholder*="Company name"]', "EXCEL TRANSITION CO");
  await page.fill('input[placeholder="32128"]', "10000");
  // deposit % defaults to 30, status defaults to awaiting_deposit
  await page.locator("button", { hasText: "Create order" }).click();
  // router.refresh() re-renders the server page — wait for the row itself,
  // not a fixed delay.
  const row = page.locator("table tbody tr", { hasText: NUMBER });
  const appeared = await row
    .waitFor({ state: "visible", timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  check("row visible in the table", appeared && (await row.count()) === 1);
  check(
    'PO cell carries the "M" manual pill',
    (await row.locator("td").first().locator("span", { hasText: "M" }).count()) >= 1
  );
  check(
    "client shows the free-text name",
    (await row.innerText()).includes("EXCEL TRANSITION CO")
  );
  const depositText = await row
    .locator('[data-qcol="deposit"]')
    .first()
    .innerText();
  check(
    "deposit derives 0 / 3,000 from total×30%",
    /0\s*\/\s*3,000/.test(depositText.replace(/\s+/g, " ")),
    depositText.trim()
  );

  console.log("[3] Payment popover: manual money facts + receipt");
  await row.locator('[data-qcol="deposit"]').first().click();
  check(
    "popover shows Order total field",
    await page.locator("text=Order total").first().isVisible()
  );
  check(
    "popover shows Deposit % field",
    await page.locator("text=Deposit %").first().isVisible()
  );
  // record the deposit receipt
  const popover = page.locator('[role="dialog"]');
  await popover
    .locator("label", { hasText: "Deposit received" })
    .locator("input")
    .fill("3000");
  await popover.locator("button", { hasText: "Save" }).click();
  await page.waitForTimeout(2500);
  const depositAfter = await row
    .locator('[data-qcol="deposit"]')
    .first()
    .innerText();
  check(
    "deposit cell now shows 3,000 / 3,000",
    /3,000\s*\/\s*3,000/.test(depositAfter.replace(/\s+/g, " ")),
    depositAfter.trim()
  );

  console.log("[4] Detail page survives a doc-less order");
  const href = await row.locator("td a").first().getAttribute("href");
  const resp = await page.goto(`${BASE_URL}${href}`, {
    waitUntil: "networkidle",
  });
  check("detail page HTTP 200", resp?.status() === 200, String(resp?.status()));
  check(
    "detail page shows the PO number (no crash)",
    (await page.locator(`text=${NUMBER}`).count()) > 0
  );

  console.log("[5] Reload Quick Update — persistence");
  await page.goto(`${BASE_URL}/production/quick-update`, {
    waitUntil: "networkidle",
  });
  check(
    "manual row persisted after reload",
    (await page.locator("table tbody tr", { hasText: NUMBER }).count()) === 1
  );

  await browser.close();
  console.log("\n[6] Cleanup");
  await cleanup();
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await cleanup();
  process.exit(1);
});
