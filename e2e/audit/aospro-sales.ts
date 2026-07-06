// AOSPRO+ Task List E2E — SALES phase.
// Creates client + project + quotation, configures AOSPRO+60 with as many
// options as possible, qty 10, then sent -> Won -> Launch Production -> Submit
// task list. Writes e2e/.runs/aospro/manifest.json for the TLM + PDF phases.
//   node --env-file=.env.local --env-file=.env.e2e --experimental-strip-types e2e/audit/aospro-sales.ts
import { chromium, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PW = process.env.E2E_PASSWORD || "";
const OUT = path.join("e2e", ".runs", "aospro");
fs.mkdirSync(OUT, { recursive: true });
const MANIFEST = path.join(OUT, "manifest.json");
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// Test data (identifiable).
const CLIENT = "TEST CLIENT AOSPROPLUS TASKLIST";
const CODE = "TAP";
const PROJECT = "TEST PROJECT FACTORY PDF CHINESE";
const REF = "TEST-AOSPROPLUS-TASKLIST-PDF";
const PRODUCT = "AOSPRO+60";
const QTY = "10";
const CONFIG = {
  "SOLAR PANEL": "18V/105W",
  Battery: "538Wh",
  OPTIC: "T35",
  CCT: "4000k",
  Spigot: "76mm",
};
const OPTIONS = ["IOT", "BIRD SPIKE", "MARINE GRADE TREATMENT", "BATTERY COVER"];

const log = (s: string) => console.log(s);
async function shot(page: Page, n: string) { await page.screenshot({ path: path.join(OUT, `sales-${n}.png`), fullPage: true }).catch(() => {}); }

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
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', PW);
    await Promise.all([page.waitForURL((u: URL) => !u.pathname.endsWith("/login"), { timeout: 45000 }).catch(() => {}), page.click('button:has-text("Sign in")')]);
  }
  await ctx.storageState({ path: AUTH });
  return { ctx, page };
}

async function pageText(page: Page): Promise<string> {
  return page.evaluate(() => (document.querySelector("main") || document.body).innerText).catch(() => "");
}
async function setSelectByOptionValue(page: Page, optionText: string, fieldLabel: string) {
  try {
    const loc = page.locator(`select:has(option:text-is("${optionText}"))`).first();
    await loc.selectOption({ label: optionText }, { timeout: 8000 });
    log(`   ✓ ${fieldLabel} = ${optionText}`);
  } catch (e) { log(`   ✗ ${fieldLabel} = ${optionText} — ${String((e as Error).message).split("\n")[0].slice(0, 90)}`); }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const { ctx, page } = await ensureLogin(browser, "sales");
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message.slice(0, 160)));
  const manifest: any = { role: "sales", product: PRODUCT, qty: QTY, config: CONFIG, options: OPTIONS, client_name: CLIENT, code: CODE, project: PROJECT, ref: REF };

  // ---- PHASE 2: create client ----
  log("\n=== PHASE 2: create client ===");
  await page.goto(`${BASE}/clients?new=1`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1200);
  await page.getByText("New client", { exact: false }).first().waitFor({ state: "visible", timeout: 12000 }).catch(() => {});
  await page.fill('input[name="company_name"]', CLIENT).catch(async () => { log("   company_name by name failed, trying placeholder"); });
  // client_code may auto-fill from the name; force our unique code.
  const codeInput = page.locator('input[name="client_code"]').first();
  if (await codeInput.count()) { await codeInput.fill(""); await codeInput.fill(CODE); }
  await shot(page, "01-client-form");
  await page.getByRole("button", { name: "Add client", exact: false }).first().click({ timeout: 10000 }).catch(() => log("   ✗ Add client click failed"));
  await page.waitForTimeout(3000);
  let clientId = (page.url().match(UUID) || [])[0] || "";
  manifest.clientId = clientId;
  log(`   client URL: ${new URL(page.url()).pathname}  id=${clientId}`);
  await shot(page, "02-client-created");
  if (!clientId) { log("   !! no client id — dumping and aborting"); log(await pageText(page)); }

  // ---- PHASE 3: quotation + configured product ----
  log("\n=== PHASE 3: quotation + AOSPRO+60 configured ===");
  await page.goto(`${BASE}/documents/new?client=${clientId}`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1500);
  await page.getByText("New quotation", { exact: false }).first().waitFor({ state: "visible", timeout: 12000 }).catch(() => {});

  // Project (affair).
  await page.getByRole("button", { name: "+ New Project", exact: false }).first().click({ timeout: 8000 }).catch(() => log("   ✗ +New Project"));
  await page.waitForTimeout(1000);
  const projInput = page.getByPlaceholder("e.g. SONABEL", { exact: false }).first();
  if (await projInput.count()) { await projInput.fill(PROJECT); }
  else { await page.locator('[role=dialog] input[type=text], input[type=text]').first().fill(PROJECT).catch(() => {}); log("   (used fallback project input)"); }
  await page.getByRole("button", { name: "Create", exact: true }).first().click({ timeout: 8000 }).catch(() => page.getByRole("button", { name: "Create", exact: false }).first().click().catch(() => log("   ✗ Create project")));
  await page.waitForTimeout(2200);
  await shot(page, "03-project-created");

  // Client reference / PO #.
  await page.locator('input[placeholder="optional"]').first().fill(REF).catch(() => log("   (PO# field not found)"));

  // Add product.
  await page.getByRole("button", { name: "+ Add Catalogue Product", exact: false }).first().click({ timeout: 8000 });
  await page.waitForTimeout(1200);
  await page.locator('input[type=search]').first().fill(PRODUCT).catch(() => {});
  await page.waitForTimeout(900);
  await page.getByText(PRODUCT, { exact: true }).first().click({ timeout: 8000 });
  await page.waitForTimeout(2000);
  log("   added product " + PRODUCT);

  // Configure.
  await page.getByRole("button", { name: "Configure now", exact: false }).first().click({ timeout: 8000 }).catch(() => log("   (Configure now not found — maybe already open)"));
  await page.waitForTimeout(1500);
  for (const [field, val] of Object.entries(CONFIG)) await setSelectByOptionValue(page, val, field);
  // OPTIONS toggles (checkbox_group rendered as labels).
  for (const opt of OPTIONS) {
    try { await page.getByText(opt, { exact: true }).first().click({ timeout: 5000 }); log(`   ✓ option ${opt}`); }
    catch (e) { log(`   ✗ option ${opt} — ${String((e as Error).message).split("\n")[0].slice(0, 80)}`); }
  }
  // Client-facing product name (shows on PDF).
  await page.locator('input[placeholder*="SolarMax"]').first().fill("AOS PRO Plus (TEST)").catch(() => {});
  // Quantity.
  await page.locator('input[type=text][placeholder="0"]').first().fill(QTY).catch(() => log("   ✗ qty"));
  log("   set qty " + QTY);
  await shot(page, "04-config-filled");

  // Save draft.
  await page.getByRole("button", { name: "Save as draft", exact: false }).first().click({ timeout: 10000 });
  await page.waitForTimeout(3500);
  const docId = (page.url().match(UUID) || [])[0] || "";
  manifest.docId = docId;
  const txt3 = await pageText(page);
  manifest.docNumber = (txt3.match(/SLX-[A-Z0-9]+-\d{2}-\d{3,}/) || [])[0] || "";
  log(`   saved doc: ${new URL(page.url()).pathname} id=${docId} number=${manifest.docNumber}`);
  await shot(page, "05-quote-saved");

  // ---- PHASE 4: sent -> won -> launch ----
  log("\n=== PHASE 4: sent -> won -> launch ===");
  const docUrl = `${BASE}/documents/${docId}`;
  await page.goto(docUrl, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1500);
  await page.locator('button:has-text("Mark as sent")').first().click({ timeout: 8000 }).catch(() => log("   (Mark as sent not found)"));
  await page.waitForTimeout(2500);
  await page.goto(docUrl, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1500);
  await page.locator('button:has-text("Mark Won"), button:text-is("Mark as won")').first().click({ timeout: 8000 }).catch(() => log("   (Mark Won not found)"));
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Confirm", exact: false }).first().click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await shot(page, "06-won");
  await page.goto(docUrl, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1500);
  await page.locator('button:has-text("Launch Production")').first().click({ timeout: 8000 }).catch(() => log("   (Launch Production not found)"));
  await page.waitForTimeout(5000);
  const afterLaunch = new URL(page.url()).pathname;
  let taskListId = afterLaunch.includes("/task-lists/") ? (page.url().match(UUID) || [])[0] || "" : "";
  log(`   after launch: ${afterLaunch} taskListId=${taskListId}`);
  await shot(page, "07-launched");

  // If launch didn't redirect to the task list, try to find it via /task-lists.
  if (!taskListId) {
    await page.goto(`${BASE}/task-lists`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1500);
    const link = page.locator(`a[href*="/task-lists/"]:has-text("PTL")`).first();
    if (await link.count()) { taskListId = ((await link.getAttribute("href")) || "").match(UUID)?.[0] || ""; log("   found task list via list: " + taskListId); }
  }
  manifest.taskListId = taskListId;

  // ---- PHASE 5: submit task list ----
  log("\n=== PHASE 5: submit task list ===");
  if (taskListId) {
    await page.goto(`${BASE}/task-lists/${taskListId}`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2000);
    const txt5 = await pageText(page);
    manifest.taskListNumber = (txt5.match(/PTL-SLX-[A-Z0-9]+-\d{2}-\d{3,}/) || [])[0] || "";
    log(`   task list number: ${manifest.taskListNumber}`);
    await page.locator('button:has-text("Submit for production validation")').first().click({ timeout: 8000 }).catch(() => log("   (Submit button not found)"));
    await page.waitForTimeout(3000);
    const st = await pageText(page);
    manifest.taskListStatusAfterSubmit = ["Under validation", "Needs revision", "Draft", "Validated", "Production ready"].find((s) => st.includes(s)) || "(unknown)";
    log(`   status after submit: ${manifest.taskListStatusAfterSubmit}`);
    await shot(page, "08-submitted");
  } else { log("   !! no taskListId — cannot submit"); }

  manifest.consoleErrors = errors.slice(0, 25);
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
  log("\n=== MANIFEST ===\n" + JSON.stringify(manifest, null, 2));
  log(`\nconsole errors: ${errors.length}`);
  await ctx.close(); await browser.close();
}
main().catch((e) => { console.error("sales crashed:", e); process.exit(1); });
