// Recon the /factory-mapping grid as TLM: structure + how to edit the 5 cells.
//   node --env-file=.env.local --env-file=.env.e2e --experimental-strip-types e2e/audit/aospro-fm-recon.ts
import { chromium, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";
const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PW = process.env.E2E_PASSWORD || "";
const OUT = path.join("e2e", ".runs", "aospro");
const TARGETS = ["18V/105W", "538Wh", "T35", "4000k", "76mm"];

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
  const r = await page.goto(`${BASE}/factory-mapping`, { waitUntil: "domcontentloaded", timeout: 45000 });
  console.log("goto /factory-mapping status", r?.status(), "url", new URL(page.url()).pathname);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, "fm-01-initial.png"), fullPage: true });

  const overview = await page.evaluate(() => {
    const t = (e: Element | null) => (e?.textContent || "").trim().replace(/\s+/g, " ");
    const main = document.querySelector("main") || document.body;
    const searchInputs = [...main.querySelectorAll('input[type=search],input[placeholder]')].map((i) => `${(i as HTMLInputElement).type}|ph="${(i as HTMLInputElement).placeholder}"`).slice(0, 12);
    const buttons = [...new Set([...main.querySelectorAll('button,[role=button]')].map((b) => t(b)).filter(Boolean))].slice(0, 40);
    const tableHeaders = [...main.querySelectorAll("thead th, [role=columnheader]")].map((h) => t(h)).slice(0, 15);
    const totalInputs = main.querySelectorAll("input,textarea").length;
    const totalRows = main.querySelectorAll("tbody tr, [role=row]").length;
    return { searchInputs, buttons, tableHeaders, totalInputs, totalRows };
  });
  console.log("SEARCH INPUTS:", overview.searchInputs.join("  ||  "));
  console.log("BUTTONS:", overview.buttons.join(" | "));
  console.log("TABLE HEADERS:", overview.tableHeaders.join(" | "));
  console.log("total inputs:", overview.totalInputs, "total rows:", overview.totalRows);

  // Try searching for one target to see how the grid narrows + row structure.
  const search = page.locator('input[type=search], input[placeholder*="earch" i]').first();
  if (await search.count()) {
    await search.fill("18V/105W"); console.log("\ntyped search 18V/105W"); await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT, "fm-02-search.png"), fullPage: true });
  } else console.log("\nNO search box found");

  // For each target value, describe the row + editable inputs around it.
  for (const val of TARGETS) {
    const info = await page.evaluate((v) => {
      const t = (e: Element | null) => (e?.textContent || "").trim().replace(/\s+/g, " ");
      // find a cell/element whose exact text is the option value
      const el = [...document.querySelectorAll("td,th,div,span")].find((e) => (e.textContent || "").trim() === v && e.children.length === 0);
      if (!el) return { v, found: false };
      const row = el.closest("tr,[role=row],li") || el.parentElement;
      const inputs = [...(row?.querySelectorAll("input,textarea") || [])].map((i) => {
        const e = i as HTMLInputElement; return `${e.tagName.toLowerCase()}[${e.type || "textarea"}] ph="${e.placeholder || ""}" val="${(e.value || "").slice(0, 20)}"`;
      });
      return { v, found: true, rowTag: (row as HTMLElement)?.tagName, rowText: t(row).slice(0, 80), inputs };
    }, val);
    console.log(JSON.stringify(info));
  }
  await browser.close();
}
main().catch((e) => { console.error("fm-recon crashed:", e); process.exit(1); });
