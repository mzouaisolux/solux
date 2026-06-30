// Diagnostic: navigate under a real role and capture server/client errors.
//   node --env-file=.env.e2e --experimental-strip-types e2e/audit/diag.ts <role> <path>
import { chromium, type Page } from "playwright";
import fs from "node:fs"; import path from "node:path";
const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PW = process.env.E2E_PASSWORD || "";
const role = (process.argv[2] || "").toLowerCase();
const target = process.argv[3] || "/dashboard";
const email = process.env[`E2E_${role.toUpperCase()}_EMAIL`] || "";
const AUTH = path.join("e2e", ".auth", `${role}.json`);

async function login(browser: any): Promise<Page> {
  let ctx = await browser.newContext(fs.existsSync(AUTH) ? { storageState: AUTH } : {});
  let page = await ctx.newPage();
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 45000 });
  if (new URL(page.url()).pathname.endsWith("/login")) {
    await ctx.close(); ctx = await browser.newContext(); page = await ctx.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.fill('input[name="email"]', email); await page.fill('input[name="password"]', PW);
    await Promise.all([page.waitForURL((u: URL) => !u.pathname.endsWith("/login"), { timeout: 45000 }).catch(() => {}), page.click('button:has-text("Sign in")')]);
    await ctx.storageState({ path: AUTH });
  }
  return page;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await login(browser);
  const consoleErrs: string[] = []; const pageErrs: string[] = []; const failed: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrs.push(m.text().slice(0, 300)); });
  page.on("pageerror", (e) => pageErrs.push(String(e.message).slice(0, 400)));
  page.on("response", (r) => { if (r.status() >= 500) failed.push(`${r.status()} ${r.url().replace(BASE, "")}`); });
  const resp = await page.goto(`${BASE}${target}`, { waitUntil: "load", timeout: 45000 }).catch((e) => { console.log("goto threw:", String(e).slice(0,200)); return null; });
  await page.waitForTimeout(1500);
  console.log(`\nMAIN STATUS: ${resp?.status()}  → ${new URL(page.url()).pathname}`);
  console.log(`5xx RESPONSES (${failed.length}):`); failed.slice(0, 10).forEach((f) => console.log("  " + f));
  console.log(`PAGEERRORS (${pageErrs.length}):`); pageErrs.slice(0, 6).forEach((e) => console.log("  " + e));
  console.log(`CONSOLE ERRORS (${consoleErrs.length}):`); consoleErrs.slice(0, 8).forEach((e) => console.log("  " + e));
  // Try to open the Next dev error overlay (bottom-left red indicator) and read it.
  await page.evaluate(() => {
    const portal = document.querySelector("nextjs-portal");
    const btn = portal?.shadowRoot?.querySelector("button");
    (btn as HTMLButtonElement | null)?.click();
  }).catch(() => {});
  await page.waitForTimeout(800);
  const overlay = await page.evaluate(() => {
    const texts: string[] = [];
    document.querySelectorAll("nextjs-portal").forEach((p) => {
      const t = (p.shadowRoot?.textContent || "").replace(/\s+/g, " ").trim();
      if (t) texts.push(t);
    });
    return texts.join(" || ").slice(0, 1200);
  });
  console.log(`NEXT OVERLAY: ${overlay || "(empty)"}`);
  await page.screenshot({ path: "e2e/.runs/diag-doc500.png", fullPage: false }).catch(() => {});
  await browser.close();
}
main().catch((e) => { console.error("diag crashed:", e); process.exit(1); });
