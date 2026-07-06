// AOSPRO+ E2E — Won -> Launch Production -> Submit task list (doc already 'sent').
//   node --env-file=.env.local --env-file=.env.e2e --experimental-strip-types e2e/audit/aospro-won-launch.ts
import { chromium, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PW = process.env.E2E_PASSWORD || "";
const OUT = path.join("e2e", ".runs", "aospro");
const MANIFEST = path.join(OUT, "manifest.json");
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const DOC = "6d31e570-3986-411b-8ade-7aa4510e05ba";
const log = (s: string) => console.log(s);
const shot = (page: Page, n: string) => page.screenshot({ path: path.join(OUT, `wl-${n}.png`), fullPage: true }).catch(() => {});
const dlgButtons = (page: Page) => page.evaluate(() => {
  const d = document.querySelector('[role=dialog]');
  const scope = d || document.querySelector("main") || document.body;
  return { hasDialog: !!d, buttons: [...new Set([...scope.querySelectorAll('button,[role=button]')].map((b) => (b.textContent || "").trim().replace(/\s+/g, " ")).filter(Boolean))].slice(0, 40) };
});

async function ensureLogin(browser: any, role: string): Promise<{ ctx: any; page: Page }> {
  const email = process.env[`E2E_${role.toUpperCase()}_EMAIL`] || "";
  const AUTH = path.join("e2e", ".auth", `${role}.json`);
  let ctx = await browser.newContext(fs.existsSync(AUTH) ? { storageState: AUTH } : {});
  let page = await ctx.newPage();
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(700);
  if (new URL(page.url()).pathname.endsWith("/login")) {
    await ctx.close(); ctx = await browser.newContext(); page = await ctx.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.fill('input[name="email"]', email); await page.fill('input[name="password"]', PW);
    await Promise.all([page.waitForURL((u: URL) => !u.pathname.endsWith("/login"), { timeout: 45000 }).catch(() => {}), page.click('button:has-text("Sign in")')]);
  }
  await ctx.storageState({ path: AUTH });
  return { ctx, page };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const { ctx, page } = await ensureLogin(browser, "sales");
  const manifest: any = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : {};
  const docUrl = `${BASE}/documents/${DOC}`;

  // WON — clicking "Mark Won" opens a custom modal (no role=dialog) with
  // Cancel + green "Mark Won". The modal's confirm is the LAST "Mark Won".
  await page.goto(docUrl, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1800);
  await page.locator('button:has-text("Mark Won")').first().click({ timeout: 8000 }).catch((e) => log("open-modal click err: " + e.message.split("\n")[0]));
  await page.getByText("Mark this quotation as Won?", { exact: false }).first().waitFor({ state: "visible", timeout: 6000 }).catch(() => log("won-modal text not seen"));
  await shot(page, "01-won-armed");
  await page.getByRole("button", { name: "Mark Won", exact: true }).last().click({ timeout: 6000 }).catch((e) => log("confirm click err: " + e.message.split("\n")[0]));
  log("clicked modal Mark Won (confirm)");
  await page.waitForTimeout(3000);
  await shot(page, "02-after-won");

  // LAUNCH PRODUCTION
  await page.goto(docUrl, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1800);
  log("post-won buttons: " + (await dlgButtons(page)).buttons.join(" | "));
  let launched = false;
  for (const t of ["Launch Production", "Launch production", "Generate task list", "Generate production task list", "Create task list"]) {
    const b = page.locator(`button:has-text("${t}")`).first();
    if (await b.count()) { await b.click({ timeout: 8000 }).catch(() => {}); log(`clicked '${t}'`); launched = true; break; }
  }
  await page.waitForTimeout(5500);
  let taskListId = new URL(page.url()).pathname.includes("/task-lists/") ? (page.url().match(UUID) || [])[0] || "" : "";
  log(`after launch → ${new URL(page.url()).pathname} taskListId=${taskListId} (launched=${launched})`);
  await shot(page, "03-launched");
  if (!taskListId) {
    await page.goto(`${BASE}/task-lists`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1500);
    const link = page.locator(`a[href*="/task-lists/"]:has-text("TAP")`).first();
    if (await link.count()) taskListId = ((await link.getAttribute("href")) || "").match(UUID)?.[0] || "";
    log("task list via list(TAP): " + taskListId);
  }
  manifest.taskListId = taskListId;

  // SUBMIT
  if (taskListId) {
    await page.goto(`${BASE}/task-lists/${taskListId}`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2000);
    const m = await page.evaluate(() => (document.querySelector("main") || document.body).innerText);
    manifest.taskListNumber = (m.match(/PTL-SLX-[A-Z0-9]+-\d{2}-\d{3,}/) || [])[0] || "";
    log("task list: " + manifest.taskListNumber + " buttons: " + (await dlgButtons(page)).buttons.join(" | "));
    await shot(page, "04-tasklist-draft");
    for (const t of ["Submit for production validation", "Submit for validation", "Submit"]) {
      const b = page.locator(`button:has-text("${t}")`).first();
      if (await b.count()) { await b.click({ timeout: 6000 }).catch(() => {}); log(`clicked '${t}'`); break; }
    }
    await page.waitForTimeout(2000);
    const db2 = await dlgButtons(page);
    if (db2.hasDialog) { for (const t of ["Submit", "Confirm", "Yes"]) { const b = page.locator(`[role=dialog] button:has-text("${t}")`).first(); if (await b.count()) { await b.click().catch(() => {}); log(`confirmed submit via '${t}'`); break; } } }
    await page.waitForTimeout(2500);
    await shot(page, "05-submitted");
  }
  manifest.docId = DOC;
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
  log("\n=== MANIFEST ===\n" + JSON.stringify(manifest, null, 2));
  await ctx.close(); await browser.close();
}
main().catch((e) => { console.error("won-launch crashed:", e); process.exit(1); });
