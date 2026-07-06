// TLM: set the task-list production_notes (top-level) to Chinese + save header.
//   node --env-file=.env.local --env-file=.env.e2e --experimental-strip-types e2e/audit/aospro-set-prodnotes.ts
import { chromium, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";
const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PW = process.env.E2E_PASSWORD || "";
const TL = "43b9fca1-cdb3-42fa-9247-b4676854c965";
const NOTE_PROD = "备注：这是一个PDF中文字符测试";
async function ensureLogin(browser: any, role: string): Promise<Page> {
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
  return page;
}
async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await ensureLogin(browser, "tlm");
  await page.goto(`${BASE}/task-lists/${TL}`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2500);
  const ta = page.locator('textarea[placeholder*="Top-level production instructions" i]').first();
  console.log("prod-notes textarea count:", await ta.count());
  await ta.fill(NOTE_PROD).catch((e) => console.log("fill err: " + e.message.split("\n")[0]));
  await page.locator('button:has-text("Save header")').first().click({ timeout: 6000 }).catch((e) => console.log("save err: " + e.message.split("\n")[0]));
  await page.waitForTimeout(2500);
  console.log("done");
  await browser.close();
}
main().catch((e) => { console.error("crashed:", e); process.exit(1); });
