// AOSPRO+ E2E — SALES continuation on the already-saved quotation.
// sent -> Won -> Launch Production -> Submit task list. Updates manifest.
//   node --env-file=.env.local --env-file=.env.e2e --experimental-strip-types e2e/audit/aospro-sales-continue.ts
import { chromium, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PW = process.env.E2E_PASSWORD || "";
const OUT = path.join("e2e", ".runs", "aospro");
const MANIFEST = path.join(OUT, "manifest.json");
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const DOC = "6d31e570-3986-411b-8ade-7aa4510e05ba"; // saved SLX-TAP-26-001

const log = (s: string) => console.log(s);
const shot = (page: Page, n: string) => page.screenshot({ path: path.join(OUT, `cont-${n}.png`), fullPage: true }).catch(() => {});

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
async function buttons(page: Page): Promise<string[]> {
  return page.evaluate(() => [...new Set([...(document.querySelector("main") || document.body).querySelectorAll('button,[role=button],a[href]')].map((b) => (b.textContent || "").trim().replace(/\s+/g, " ")).filter(Boolean))].slice(0, 60));
}
async function statusWord(page: Page): Promise<string> {
  const m = await page.evaluate(() => (document.querySelector("main") || document.body).innerText);
  return ["Needs revision", "Under validation", "Production ready", "Validated", "Cancelled", "Won", "Sent", "Draft", "Deposit received", "In production"].find((s) => m.includes(s)) || "(none)";
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const { ctx, page } = await ensureLogin(browser, "sales");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message.slice(0, 160)));
  const manifest: any = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : {};
  manifest.docId = DOC;
  const docUrl = `${BASE}/documents/${DOC}`;

  // Doc page recon.
  await page.goto(docUrl, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2000);
  log("DOC buttons: " + (await buttons(page)).join(" | "));
  log("DOC status: " + await statusWord(page));
  await shot(page, "01-doc");

  // Mark as sent.
  for (const t of ["Mark as sent", "Mark sent", "Send"]) {
    const b = page.locator(`button:has-text("${t}")`).first();
    if (await b.count()) { await b.click({ timeout: 6000 }).catch(() => {}); log(`clicked '${t}'`); break; }
  }
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Confirm", exact: false }).first().click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await page.goto(docUrl, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1500);
  log("after sent → status: " + await statusWord(page));

  // Mark Won.
  for (const t of ["Mark Won", "Mark as won", "Won"]) {
    const b = page.locator(`button:has-text("${t}")`).first();
    if (await b.count()) { await b.click({ timeout: 6000 }).catch(() => {}); log(`clicked '${t}'`); break; }
  }
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Confirm", exact: false }).first().click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.goto(docUrl, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1500);
  log("after won → status: " + await statusWord(page));
  await shot(page, "02-won");
  log("DOC buttons now: " + (await buttons(page)).join(" | "));

  // Launch Production.
  for (const t of ["Launch Production", "Launch production", "🚀 Launch Production"]) {
    const b = page.locator(`button:has-text("${t}")`).first();
    if (await b.count()) { await b.click({ timeout: 8000 }).catch(() => {}); log(`clicked '${t}'`); break; }
  }
  await page.waitForTimeout(5500);
  let taskListId = new URL(page.url()).pathname.includes("/task-lists/") ? (page.url().match(UUID) || [])[0] || "" : "";
  log("after launch → " + new URL(page.url()).pathname + " taskListId=" + taskListId);
  await shot(page, "03-launched");

  // Fallback: find task list whose number is PTL-SLX-TAP-...
  if (!taskListId) {
    await page.goto(`${BASE}/task-lists`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1500);
    const link = page.locator(`a[href*="/task-lists/"]:has-text("TAP")`).first();
    if (await link.count()) taskListId = ((await link.getAttribute("href")) || "").match(UUID)?.[0] || "";
    log("task list via list (TAP): " + taskListId);
  }
  manifest.taskListId = taskListId;

  // Submit for production validation.
  if (taskListId) {
    await page.goto(`${BASE}/task-lists/${taskListId}`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2000);
    const m = await page.evaluate(() => (document.querySelector("main") || document.body).innerText);
    manifest.taskListNumber = (m.match(/PTL-SLX-[A-Z0-9]+-\d{2}-\d{3,}/) || [])[0] || "";
    log("task list: " + manifest.taskListNumber + " status=" + await statusWord(page));
    log("TL buttons: " + (await buttons(page)).join(" | "));
    await shot(page, "04-tasklist");
    for (const t of ["Submit for production validation", "Submit for validation", "Submit"]) {
      const b = page.locator(`button:has-text("${t}")`).first();
      if (await b.count()) { await b.click({ timeout: 6000 }).catch(() => {}); log(`clicked '${t}'`); break; }
    }
    await page.waitForTimeout(3000);
    await page.getByRole("button", { name: "Confirm", exact: false }).first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await page.goto(`${BASE}/task-lists/${taskListId}`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1500);
    manifest.taskListStatusAfterSubmit = await statusWord(page);
    log("status after submit: " + manifest.taskListStatusAfterSubmit);
    await shot(page, "05-submitted");
  }

  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
  log("\n=== MANIFEST ===\n" + JSON.stringify(manifest, null, 2));
  await ctx.close(); await browser.close();
}
main().catch((e) => { console.error("continue crashed:", e); process.exit(1); });
