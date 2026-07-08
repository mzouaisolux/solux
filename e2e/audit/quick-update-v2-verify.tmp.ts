// =====================================================================
// VERIFY — Quick Update v2 improvements (owner brief 2026-07-08 #2):
//   1. Production Due shows planned vs actual dates (not just "+5d")
//   2. Deposit/Balance show the receipt date under the amounts
//   3. Incoterm column (workflow: from quotation · manual: editable)
//   4. Documents popover: real checklist + "Request requirements from
//      Sales" (event + anti-duplicate guard)
// Real Operations session, real DB. Creates a manual order (CIF) to test
// the manual incoterm path, then deletes it.
//
// Run: node --env-file=.env.local --env-file=.env.e2e \
//        --experimental-strip-types e2e/audit/quick-update-v2-verify.tmp.ts
// =====================================================================

import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { BASE_URL, storageStatePath } from "../config.ts";

const NUMBER = `MANU-V2-${Math.floor(Math.random() * 1_000_000)}`;

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

function opClient() {
  const URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
  const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || "";
  return createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function cleanup(): Promise<void> {
  const sb = opClient();
  await sb.auth.signInWithPassword({
    email: process.env.E2E_OPERATION_EMAIL || "",
    password: process.env.E2E_PASSWORD || "",
  });
  await sb.from("production_orders").delete().eq("number", NUMBER).eq("source", "manual");
  // NO signOut: global signOut would revoke the browser session's tokens too
  console.log(`  (cleanup: ${NUMBER})`);
}

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    storageState: storageStatePath("operation"),
    viewport: { width: 1600, height: 900 },
  });
  const page = await context.newPage();

  console.log("[1] Columns: Incoterm present, order preserved");
  await page.goto(`${BASE_URL}/production/quick-update`, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    localStorage.removeItem("qu2:cols");
    localStorage.removeItem("qu2:widths");
  });
  await page.reload({ waitUntil: "networkidle" });
  const headers = await page.$$eval("table thead th", (ths) =>
    ths.map((th) => (th.textContent ?? "").trim())
  );
  check(
    "Incoterm column sits between Factory Delay and Carrier",
    headers.indexOf("Incoterm") === headers.indexOf("Factory Delay") + 1 &&
      headers.indexOf("Carrier") === headers.indexOf("Incoterm") + 1,
    headers.join(" | ")
  );

  console.log("[2] Production Due: planned vs current dates on the delayed order");
  const afr = page.locator("table tbody tr", { hasText: "PO-SLX-AFR" }).first();
  const dueText = (await afr.locator("td").nth(6).innerText()).replace(/\s+/g, " ");
  check(
    "delayed order shows current date + 'plan <date> · +Nd' (real dates, not just a delta)",
    /\d+ \w{3} \d{2}/.test(dueText) && /plan \d+ \w{3} \d{2} .*\+\d+d/.test(dueText),
    dueText
  );

  console.log("[3] Deposit shows the receipt date");
  const depText = (await afr.locator('[data-qcol="deposit"]').first().innerText()).replace(/\s+/g, " ");
  check(
    "paid deposit shows 'recd <date>' under the amounts",
    /32,128 \/ 32,128/.test(depText) && /recd \d+ \w{3} \d{2}/.test(depText),
    depText
  );

  console.log("[4] Incoterm cell: workflow order reads the quotation");
  const incoText = (await afr.locator("td").nth(8).innerText()).trim();
  check("workflow order shows an incoterm (or — if quote has none)", incoText.length > 0, incoText);

  console.log("[5] Documents popover: checklist + request to Sales");
  await afr.locator('[data-qcol="documents"]').first().click();
  const dialog = page.locator('[role="dialog"]');
  await dialog.waitFor({ state: "visible", timeout: 5000 });
  const checklistCount = await dialog.locator("li").count();
  check("requirement checklist lists the actual documents", checklistCount >= 3, `${checklistCount} items`);
  const itemText = (await dialog.locator("li").first().innerText()).replace(/\s+/g, " ");
  check("items carry a ready/missing state", /(ready|mandatory|required|optional)/.test(itemText), itemText);
  const reqBtn = dialog.locator("button", { hasText: "Request requirements from Sales" });
  check("request button present", (await reqBtn.count()) === 1);
  await reqBtn.click();
  await page.waitForTimeout(2000);
  const body1 = await page.evaluate(() => document.body.innerText);
  check("request sent (toast)", body1.includes("Request sent to Sales"), body1.match(/(Request sent[^\n]*|Missing[^\n]*|Could not[^\n]*|not linked[^\n]*|already sent[^\n]*)/)?.[0] ?? "(no toast)");

  // event landed?
  const sb = opClient();
  await sb.auth.signInWithPassword({
    email: process.env.E2E_OPERATION_EMAIL || "",
    password: process.env.E2E_PASSWORD || "",
  });
  const { data: evs } = await sb
    .from("events")
    .select("id, message")
    .eq("event_type", "po.docs_requirements_requested")
    .order("created_at", { ascending: false })
    .limit(1);
  check(
    "po.docs_requirements_requested event in DB",
    (evs ?? []).length === 1,
    evs?.[0]?.message?.slice(0, 60) ?? ""
  );

  // anti-duplicate: second click must refuse
  await afr.locator('[data-qcol="documents"]').first().click();
  await dialog.waitFor({ state: "visible", timeout: 5000 });
  await dialog.locator("button", { hasText: "Request requirements from Sales" }).click();
  await page.waitForTimeout(2000);
  const body2 = await page.evaluate(() => document.body.innerText);
  check("second request blocked (anti-duplicate)", body2.includes("already sent"), body2.match(/already sent[^\n]*/)?.[0] ?? "(no toast)");
  await page.keyboard.press("Escape");

  console.log("[6] Manual order: incoterm editable (CIF via modal)");
  await page.locator("button", { hasText: "+ Add order" }).click();
  await page.fill('input[placeholder*="existing number"]', NUMBER);
  await page.locator("label", { hasText: "Incoterm" }).locator("select").selectOption("CIF");
  await page.locator("button", { hasText: "Create order" }).click();
  const manualRow = page.locator("table tbody tr", { hasText: NUMBER });
  await manualRow.waitFor({ state: "visible", timeout: 15000 });
  const manualInco = manualRow.locator('input[data-qcol="incoterm"]');
  check("manual row's incoterm is an editable input", (await manualInco.count()) === 1);
  check("incoterm persisted as CIF", (await manualInco.inputValue()) === "CIF");
  // edit inline → FOB, reload, verify
  await manualInco.fill("FOB");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2000);
  await page.reload({ waitUntil: "networkidle" });
  const after = await page
    .locator("table tbody tr", { hasText: NUMBER })
    .locator('input[data-qcol="incoterm"]')
    .inputValue();
  check("inline incoterm edit round-trips the DB (CIF→FOB)", after === "FOB", after);

  await page.screenshot({ path: "e2e/.runs/quick-update-v2.png" });
  await browser.close();
  console.log("\n[7] Cleanup");
  await cleanup();
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await cleanup();
  process.exit(1);
});
