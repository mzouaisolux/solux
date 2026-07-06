// =====================================================================
// SEED-ORDER — rebuild a full pipeline on the existing catalogue so the cockpit
// has real data: client → quotation (configured product) → sent → won → launch →
// task list → TLM release → PRODUCTION ORDER. Hardened with element waits
// (Next dev hydration timing) + phase screenshots. Real per-role JWT.
//   node --env-file=.env.local --env-file=.env.e2e --experimental-strip-types e2e/audit/seed-order.ts
// =====================================================================
import { chromium, type Browser, type Page } from "playwright";
import fs from "node:fs";
const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PW = process.env.E2E_PASSWORD || "";
const SHOTS = process.env.SEED_SHOTS || "/tmp/seed";
fs.mkdirSync(SHOTS, { recursive: true });
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const tag = Date.now().toString().slice(-5);
const CLIENT = `QA COCKPIT CLIENT ${tag}`;
const PROJECT = `QA COCKPIT PROJECT ${tag}`;
const CONFIG = { "SOLAR PANEL": "18V/105W", Battery: "538Wh", OPTIC: "T35", CCT: "4000k", Spigot: "76mm" };
const QTY = "10";
const log = (s: string) => console.log(s);
const m: any = { tag, client: CLIENT };
const shot = (p: Page, n: string) => p.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true }).catch(() => {});

async function login(browser: Browser, role: string): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.fill('input[name="email"]', process.env[`E2E_${role.toUpperCase()}_EMAIL`] || "");
  await page.fill('input[name="password"]', PW);
  await Promise.all([page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 30000 }).catch(() => {}), page.click('button:has-text("Sign in")')]);
  return page;
}
const mainText = (p: Page) => p.evaluate(() => (document.querySelector("main") || document.body).innerText).catch(() => "");

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const page = await login(browser, "sales");
  // Mark Won / Launch Production fire native window.confirm() dialogs — Playwright
  // auto-DISMISSES them by default (that's why Won never applied). Accept them.
  page.on("dialog", (d) => d.accept().catch(() => {}));

  // ---- CLIENT (portal modal via ?new=1; wait for the actual field) ----
  log("\n=== client ===");
  await page.goto(`${BASE}/clients?new=1`, { waitUntil: "domcontentloaded", timeout: 30000 });
  const nameInput = page.locator('input[name="company_name"]');
  await nameInput.waitFor({ state: "visible", timeout: 18000 }).catch(async () => {
    await page.getByRole("button", { name: "+ New client", exact: false }).first().click().catch(() => {});
    await nameInput.waitFor({ state: "visible", timeout: 12000 }).catch(() => {});
  });
  await nameInput.fill(CLIENT);
  await page.waitForTimeout(1000); // code auto-derive + availability debounce
  await shot(page, "01-client");
  await page.getByRole("button", { name: "Add client", exact: true }).click({ timeout: 12000 }).catch(() => log("  ✗ Add client"));
  await page.waitForURL((u) => /\/clients\/[0-9a-f-]{36}/.test(u.href), { timeout: 18000 }).catch(() => {});
  m.clientId = (page.url().match(UUID) || [])[0] || "";
  log(`  clientId=${m.clientId || "(none)"}`);
  if (!m.clientId) { await shot(page, "01b-client-fail"); log("  ABORT: no client"); await browser.close(); process.exit(1); }

  // ---- QUOTATION + PROJECT + PRODUCT ----
  log("\n=== quotation ===");
  await page.goto(`${BASE}/documents/new?client=${m.clientId}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByRole("button", { name: "+ Add Catalogue Product", exact: false }).waitFor({ state: "visible", timeout: 18000 }).catch(() => {});
  await page.waitForTimeout(500);

  // Project (mandatory affair).
  await page.getByRole("button", { name: "+ New Project", exact: false }).first().click({ timeout: 8000 }).catch(() => log("  ✗ +New Project"));
  const projInput = page.getByPlaceholder("e.g. SONABEL", { exact: false }).first();
  await projInput.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  await projInput.fill(PROJECT).catch(async () => { await page.locator('[role=dialog] input[type=text]').first().fill(PROJECT).catch(() => {}); });
  await page.getByRole("button", { name: "Create", exact: true }).first().click({ timeout: 8000 }).catch(() => page.getByRole("button", { name: /Create/i }).first().click().catch(() => log("  ✗ Create project")));
  await page.waitForTimeout(2500);
  await shot(page, "02-project");

  // Add catalogue product — click a real product CARD (not the category chip).
  await page.getByRole("button", { name: "+ Add Catalogue Product", exact: false }).first().click({ timeout: 8000 });
  const search = page.locator('input[type=search]').first();
  await search.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  await search.fill("AOSPRO+100").catch(() => {});
  await page.waitForTimeout(1200);
  await page.getByText("AOSPRO+100", { exact: true }).first().click({ timeout: 8000 }).catch(() => log("  ✗ product card"));
  await page.waitForTimeout(2500);
  await shot(page, "03-product");
  // Manual unit price + quantity (catalogue prices are masked to sales → 0),
  // so the order has a real total → a real 30% deposit threshold to test.
  await page.getByText("UNIT PRICE", { exact: false }).first().locator("xpath=following::input[1]").fill("5000").catch(() => log("  ✗ unit price"));
  await page.getByText("QTY", { exact: true }).first().locator("xpath=following::input[1]").fill(QTY).catch(() => log("  ✗ qty"));
  await page.waitForTimeout(700);
  m.expectedTotal = "50000 (10 × 5000)";
  await shot(page, "04-line");

  // Save as draft.
  await page.getByRole("button", { name: "Save as draft", exact: false }).first().click({ timeout: 10000 }).catch(() => log("  ✗ Save draft"));
  await page.waitForURL((u) => /\/documents\/[0-9a-f-]{36}/.test(u.href), { timeout: 18000 }).catch(() => {});
  m.docId = (page.url().match(UUID) || [])[0] || "";
  m.docNumber = ((await mainText(page)).match(/SLX-[A-Z0-9]+-\d{2}-\d{2,}/) || [])[0] || "";
  log(`  docId=${m.docId || "(none)"} number=${m.docNumber || "?"}`);
  await shot(page, "05-quote");
  if (!m.docId) { log("  ABORT: no quote"); await browser.close(); process.exit(1); }

  // ---- SENT → WON → LAUNCH ----
  log("\n=== sent → won → launch ===");
  const docUrl = `${BASE}/documents/${m.docId}`;
  // 1) Mark as Sent.
  await page.goto(docUrl, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1700);
  await page.locator('button:has-text("Mark as sent")').first().click({ timeout: 7000 }).then(() => log("  clicked Mark as sent")).catch(() => log("  (no Mark as sent)"));
  await page.waitForTimeout(2200);
  // 2) Mark Won — opens an IN-APP MODAL whose confirm button is ALSO "Mark Won".
  await page.goto(docUrl, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1700);
  await page.getByRole("button", { name: "Mark Won", exact: true }).first().click({ timeout: 8000 }).then(() => log("  opened Won modal")).catch(() => log("  (no Mark Won)"));
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: /^Mark Won$|Mark as Sent and Won/ }).last().click({ timeout: 6000 }).then(() => log("  confirmed Won")).catch(() => log("  (no Won confirm)"));
  await page.waitForTimeout(2800);
  // 3) Launch Production (no confirm; appears once Won + no task list yet).
  await page.goto(docUrl, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1900);
  await page.locator('button:has-text("Launch Production")').first().click({ timeout: 8000 }).then(() => log("  clicked Launch Production")).catch(() => log("  (Launch Production not present)"));
  await page.waitForTimeout(5500);
  m.taskListId = page.url().includes("/task-lists/") ? (page.url().match(UUID) || [])[0] || "" : "";
  if (!m.taskListId) {
    await page.goto(`${BASE}/task-lists`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1500);
    const link = page.locator('a[href*="/task-lists/"]').first();
    if (await link.count()) m.taskListId = ((await link.getAttribute("href")) || "").match(UUID)?.[0] || "";
  }
  log(`  taskListId=${m.taskListId || "(none)"}`);
  await shot(page, "06-launched");
  if (m.taskListId) {
    await page.goto(`${BASE}/task-lists/${m.taskListId}`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2200);
    m.taskListNumber = ((await mainText(page)).match(/PTL-SLX-[A-Z0-9]+-\d{2}-\d{2,}/) || [])[0] || "";
    await page.locator('button:has-text("Submit for production validation")').first().click({ timeout: 8000 }).catch(() => log("  (Submit not present)"));
    await page.waitForTimeout(3000);
    await shot(page, "07-submitted");
  }

  // ---- TLM RELEASE ----
  log("\n=== tlm release ===");
  const tlm = await login(browser, "tlm");
  tlm.on("dialog", (d) => d.accept().catch(() => {}));
  if (m.taskListId) {
    await tlm.goto(`${BASE}/task-lists/${m.taskListId}`, { waitUntil: "domcontentloaded" }); await tlm.waitForTimeout(2500);
    for (const t of ["Validate", "Release to production", "Release to Production", "Approve"]) {
      const b = tlm.locator(`button:has-text("${t}")`).first();
      if (await b.count()) { await b.click({ timeout: 8000 }).catch(() => {}); log(`  clicked '${t}'`); break; }
    }
    await tlm.waitForTimeout(1800);
    for (const t of ["Release to production", "Release to Production", "Validate", "Confirm", "Release", "Yes"]) {
      const b = tlm.getByRole("button", { name: t, exact: false }).last();
      if (await b.count()) { await b.click({ timeout: 5000 }).catch(() => {}); log(`  confirmed '${t}'`); break; }
    }
    await tlm.waitForTimeout(3500);
    await shot(tlm, "08-released");
    await tlm.goto(`${BASE}/task-lists/${m.taskListId}`, { waitUntil: "domcontentloaded" }); await tlm.waitForTimeout(1500);
    const body = await mainText(tlm);
    m.taskListStatus = ["Production ready", "Validated", "Under validation", "Needs revision", "Draft"].find((s) => body.includes(s)) || "(unknown)";
    m.releaseBlocker = /mapping|missing|revision|blocked|incomplete/i.test(body) ? (body.match(/[^.\n]*(mapping|missing|revision|blocked|incomplete)[^.\n]*/i)?.[0] || "").trim().slice(0, 140) : "";
    log(`  taskListStatus=${m.taskListStatus}${m.releaseBlocker ? ` · blocker="${m.releaseBlocker}"` : ""}`);
  }

  // ---- VERIFY ORDER ----
  await tlm.goto(`${BASE}/production/orders`, { waitUntil: "domcontentloaded" }); await tlm.waitForTimeout(1500);
  const oids: string[] = await tlm.evaluate(() => Array.from(new Set(Array.from(document.querySelectorAll('a[href*="/production/orders/"]')).map((a) => (a.getAttribute("href") || "").match(/\/production\/orders\/([0-9a-f-]{36})/i)?.[1] || "").filter(Boolean))));
  m.orderId = oids[0] || "";
  if (m.orderId) {
    await tlm.goto(`${BASE}/production/orders/${m.orderId}`, { waitUntil: "domcontentloaded" }); await tlm.waitForTimeout(1300);
    m.orderStatus = await tlm.evaluate(() => document.querySelector(".po-pill")?.textContent?.trim() || "?");
    m.orderNumber = ((await mainText(tlm)).match(/PO-SLX-[A-Z0-9]+-\d{2}-\d{2,}/) || [])[0] || "";
    await shot(tlm, "09-order");
  }
  log("\n===== SEED RESULT =====\n" + JSON.stringify(m, null, 2));
  log(m.orderId
    ? `\n✅ ORDER READY → ${BASE}/production/orders/${m.orderId}  (${m.orderNumber} · ${m.orderStatus})`
    : `\n❌ No order — task list "${m.taskListStatus}"${m.releaseBlocker ? `, blocker: ${m.releaseBlocker}` : ""}. Shots in ${SHOTS}`);
  await browser.close();
  if (!m.orderId) process.exit(2);
}
main().catch((e) => { console.error("seed crashed:", e); process.exit(1); });
