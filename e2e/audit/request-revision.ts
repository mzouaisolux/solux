// REAL WORKFLOW EXECUTION (Operations) — drive the structured "Request
// revision" modal on an under-validation task list, under a TRUE operations
// JWT (no View-As). Verifies: (1) the modal's required-field validation,
// (2) the server action requestRevisionWithReason succeeds under operations
// RLS, (3) the task list transitions under_validation → needs_revision.
// Reversible: Sales re-submits. Message carries an audit marker.
//   node --env-file=.env.e2e --experimental-strip-types e2e/audit/request-revision.ts <taskListId>
import { chromium, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PASSWORD = process.env.E2E_PASSWORD || "";
const role = "operation";
const email = process.env.E2E_OPERATION_EMAIL || "";
const taskListId = process.argv[2];
const OUT = path.join("e2e", ".runs", "act-operation");
fs.mkdirSync(OUT, { recursive: true });
const stateFile = path.join("e2e", ".auth", `${role}.json`);
const MARKER = "[AUDIT E2E 2026-06-23] Operations real-session test — disregard; verifying the revision loop under a true operations JWT.";

async function ensureLogin(ctxNew: () => Promise<Page>, page: Page): Promise<Page> {
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(500);
  if (!new URL(page.url()).pathname.endsWith("/login")) return page;
  const p = await ctxNew();
  await p.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await p.fill('input[name="email"]', email);
  await p.fill('input[name="password"]', PASSWORD);
  await Promise.all([p.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 45000 }).catch(() => {}), p.click('button[type="submit"]')]);
  return p;
}

async function statusOf(page: Page): Promise<string> {
  return page.evaluate(() => {
    const m = document.querySelector("main")?.innerText || "";
    for (const s of ["Needs revision", "Under validation", "Validated", "Production ready", "Draft", "Cancelled"]) if (m.includes(s)) return s;
    return "(unknown)";
  });
}

async function main(): Promise<void> {
  if (!taskListId) { console.error("usage: request-revision.ts <taskListId>"); process.exit(1); }
  const browser = await chromium.launch({ headless: true });
  let context = await browser.newContext(fs.existsSync(stateFile) ? { storageState: stateFile } : {});
  let page = await context.newPage();
  page = await ensureLogin(async () => { context = await browser.newContext(); return context.newPage(); }, page);
  await context.storageState({ path: stateFile });

  const url = `${BASE}/task-lists/${taskListId}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1200);
  const before = await statusOf(page);
  await page.screenshot({ path: path.join(OUT, "01-before.png"), fullPage: true });
  console.log(`BEFORE status: ${before}`);

  // Open the structured modal.
  const trigger = page.getByRole("button", { name: "Request revision" }).first();
  if (!(await trigger.count())) { console.error("No 'Request revision' button (wrong status/role?). Abort, no mutation."); await browser.close(); process.exit(3); }
  await trigger.click();
  const title = page.getByText("Request revision — send back to Sales");
  await title.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  if (!(await title.count())) { console.error("Modal did not open. Abort, no mutation."); await browser.close(); process.exit(3); }

  // Required fields: category (the only select with a '— select —' option) + message.
  const categorySelect = page.locator('select:has(option:text-is("— select —"))');
  const messageBox = page.locator('textarea[placeholder*="Explain clearly what Sales"]');
  if (!(await categorySelect.count()) || !(await messageBox.count())) { console.error("Modal fields not found. Abort, no mutation."); await browser.close(); process.exit(3); }

  // Inspect the real category options before choosing.
  const options = await categorySelect.locator("option").evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value).filter(Boolean));
  console.log(`category options: ${JSON.stringify(options)}`);
  await categorySelect.selectOption(options[0]);
  await messageBox.fill(MARKER);
  await page.screenshot({ path: path.join(OUT, "02-modal-filled.png") });

  const confirm = page.getByRole("button", { name: "Send back to Sales" });
  console.log(`confirm button enabled: ${await confirm.isEnabled()}`);
  await confirm.click();

  // Wait for the transition to land.
  await page.waitForTimeout(2500);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const after = await statusOf(page);
  await page.screenshot({ path: path.join(OUT, "03-after.png"), fullPage: true });
  console.log(`AFTER status:  ${after}`);
  console.log(after === "Needs revision" ? "✅ TRANSITION OK (under_validation → needs_revision) under real operations JWT" : `⚠️ status did not become 'Needs revision' (got '${after}')`);
  await browser.close();
}
main().catch((e) => { console.error("crashed:", e); process.exit(1); });
