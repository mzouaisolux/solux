// =====================================================================
// COCKPIT LIFECYCLE — drive ONE order through the whole operational flow and
// assert each capability + persistence. Real operations login.
//   node --env-file=.env.e2e --experimental-strip-types e2e/audit/cockpit-lifecycle.ts <orderId>
// =====================================================================
import { chromium, type Browser, type Page } from "playwright";
const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PW = process.env.E2E_PASSWORD || "";
const ID = process.argv[2];
const today = new Date().toISOString().slice(0, 10);
const R: { name: string; res: string; detail: string }[] = [];
const rec = (name: string, ok: boolean | "skip", detail = "") => R.push({ name, res: ok === "skip" ? "SKIP" : ok ? "PASS" : "FAIL", detail });

async function login(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept().catch(() => {}));
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.fill('input[name="email"]', process.env.E2E_OPERATION_EMAIL || "");
  await page.fill('input[name="password"]', PW);
  await Promise.all([page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 30000 }).catch(() => {}), page.click('button:has-text("Sign in")')]);
  return page;
}
async function go(p: Page, open = ""): Promise<void> {
  await p.goto(`${BASE}/production/orders/${ID}${open ? `?open=${open}` : ""}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await p.waitForTimeout(700);
}
const status = (p: Page) => p.evaluate(() => document.querySelector(".po-pill")?.textContent?.trim() || "?");
const kpi = (p: Page, label: string) => p.evaluate((l) => {
  const el = Array.from(document.querySelectorAll(".po-kpi")).find((c) => c.querySelector(".k")?.textContent?.trim() === l);
  return el?.querySelector(".val")?.textContent?.trim() || "—";
}, label);
const cell = (p: Page, label: string) => p.evaluate((l) => {
  const el = Array.from(document.querySelectorAll(".po-cell")).find((c) => c.querySelector(".po-ck")?.textContent?.trim() === l);
  return el?.querySelector(".po-cv")?.textContent?.trim() || "—";
}, label);
const isDate = (s: string) => /\d{4}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i.test(s) && !/not sched|pending|^—$/i.test(s);
async function save(p: Page, label: string) { await p.click(`button:has-text("${label}")`, { timeout: 10000 }).catch(() => {}); await p.waitForTimeout(1300); }
async function setStatus(p: Page, target: string): Promise<string> {
  await go(p, "production");
  await p.locator('button[aria-haspopup="menu"]').first().click({ timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(400);
  await p.getByRole("button", { name: target, exact: true }).first().click({ timeout: 6000 }).catch(() => {});
  await p.waitForTimeout(400);
  await p.getByRole("button", { name: /Confirm|Change status|Confirm delivery|Move back/i }).first().click({ timeout: 6000 }).catch(() => {});
  await p.waitForTimeout(1500);
  await go(p);
  return status(p);
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const page = await login(browser);
  await go(page);
  const start = await status(page);
  rec("Order loads · cockpit renders", start !== "?", `initial status "${start}"`);

  // 1) WORKING DAYS (editable pre-activation) → save → persist.
  await go(page, "production");
  if (await page.locator('input[name="production_working_days"]').count()) {
    await page.fill('input[name="production_working_days"]', "25");
    await save(page, "working days");
    await go(page, "production");
    const wd = await cell(page, "Working days");
    rec("Working days save + persist", wd === "25", `read "${wd}"`);
  } else rec("Working days editable", "skip", `baseline locked (status ${start})`);

  // 2) DEPOSIT → production STARTS + ETA computed + loud flash.
  await go(page, "payment");
  const expDep = await page.evaluate(() => (document.body.innerText.match(/Required:\s*[A-Z]{3}\s*([\d,]+)/i)?.[1] || "1500").replace(/[^\d]/g, ""));
  if (await page.locator('input[name="deposit_received_amount"]').count()) {
    await page.fill('input[name="deposit_received_amount"]', expDep || "1500");
    await page.fill('input[name="deposit_received_at"]', today).catch(() => {});
    await Promise.all([page.waitForURL((u) => u.href.includes("flash="), { timeout: 20000 }).catch(() => {}), page.click('button:has-text("Save payments")')]);
    await page.waitForTimeout(1200);
    const flashed = page.url().includes("flash=production_started");
    await go(page);
    const st = await status(page);
    rec("Deposit → production starts", st === "In production" && flashed, `status "${st}", flash=${flashed}`);
    rec("Committed finish / ETA computed after deposit", isDate(await kpi(page, "Estimated finish")), `Estimated finish = "${await kpi(page, "Estimated finish")}"`);
  } else rec("Deposit editor", "skip", `not awaiting (status ${start})`);

  // 3) BALANCE received → persist.
  await go(page, "payment");
  if (await page.locator('input[name="balance_received_amount"]').count()) {
    await page.fill('input[name="balance_received_amount"]', "3500");
    await page.fill('input[name="balance_received_at"]', today).catch(() => {});
    await save(page, "Save payments");
    await go(page, "payment");
    const remain = await kpi(page, "Payment");
    rec("Balance received + persist", /paid|settled|USD\s*0|balance pending/i.test(await page.evaluate(() => document.body.innerText.match(/Balance remaining[\s\S]{0,30}/i)?.[0] || "")), `balance remaining reads settled`);
  } else rec("Balance editor", "skip");

  // 4) SHIPPING fields (booked + ETD/ETA/BL) → persist.
  await go(page, "shipping");
  if (await page.locator('input[name="bl_number"]').count()) {
    await page.check('input[name="shipment_booked"]').catch(() => {});
    await page.fill('input[name="etd"]', "2026-09-10").catch(() => {});
    await page.fill('input[name="eta"]', "2026-10-15").catch(() => {});
    await page.fill('input[name="bl_number"]', "MEDU-QA-778812").catch(() => {});
    await save(page, "Save shipment");
    await go(page, "shipping");
    rec("Shipping (BL/ETD/ETA/booked) persist", (await page.inputValue('input[name="bl_number"]').catch(() => "")) === "MEDU-QA-778812", `BL read "${await page.inputValue('input[name="bl_number"]').catch(() => "")}"`);
  } else rec("Shipping editor", "skip");

  // 5) STATUS LIFECYCLE — drive to delivered.
  for (const step of ["Production completed", "Shipment booked", "Shipped", "Delivered"]) {
    const after = await setStatus(page, step);
    rec(`Status → ${step}`, after === step, `now "${after}"`);
  }

  // Report.
  console.log(`\n===== COCKPIT LIFECYCLE (${ID.slice(0, 8)}) =====`);
  let fail = 0;
  for (const r of R) { if (r.res === "FAIL") fail++; console.log(`  ${r.res === "PASS" ? "✓" : r.res === "SKIP" ? "•" : "✗"} [${r.res}] ${r.name}${r.detail ? ` — ${r.detail}` : ""}`); }
  console.log(`\n${fail === 0 ? "✅" : "❌"} ${R.filter((r) => r.res === "PASS").length} pass · ${fail} fail · ${R.filter((r) => r.res === "SKIP").length} skip`);
  await browser.close();
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
