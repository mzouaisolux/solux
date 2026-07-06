// Capture the browser-generated Factory PDF from the task list page.
//   node --env-file=.env.local --env-file=.env.e2e --experimental-strip-types e2e/audit/aospro-pdf.ts
import { chromium, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";
const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PW = process.env.E2E_PASSWORD || "";
const OUT = path.join("e2e", ".runs", "aospro");
const TL = "43b9fca1-cdb3-42fa-9247-b4676854c965";
const PDF = path.join(OUT, "factory.pdf");

async function ensureLogin(browser: any, role: string): Promise<{ ctx: any; page: Page }> {
  const email = process.env[`E2E_${role.toUpperCase()}_EMAIL`] || "";
  const AUTH = path.join("e2e", ".auth", `${role}.json`);
  let ctx = await browser.newContext({ acceptDownloads: true, ...(fs.existsSync(AUTH) ? { storageState: AUTH } : {}) });
  let page = await ctx.newPage();
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(700);
  if (new URL(page.url()).pathname.endsWith("/login")) {
    await ctx.close(); ctx = await browser.newContext({ acceptDownloads: true }); page = await ctx.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.fill('input[name="email"]', email); await page.fill('input[name="password"]', PW);
    await Promise.all([page.waitForURL((u: URL) => !u.pathname.endsWith("/login"), { timeout: 45000 }).catch(() => {}), page.click('button:has-text("Sign in")')]);
  }
  await ctx.storageState({ path: AUTH });
  return { ctx, page };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const { ctx, page } = await ensureLogin(browser, "tlm");
  const errors: string[] = [];
  const allConsole: string[] = [];
  page.on("console", (m) => { allConsole.push(`[${m.type()}] ${m.text().slice(0, 200)}`); if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message.slice(0, 200)));
  // Force the anchor-download fallback: the File System Access picker has no UI headless.
  await page.addInitScript(() => { try { delete (window as any).showSaveFilePicker; } catch {} });

  await page.goto(`${BASE}/task-lists/${TL}`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2500);
  const btn = page.locator('button:has-text("Factory PDF")').first();
  console.log("Factory PDF button present:", await btn.count());

  let ok = false;
  const dlPromise = page.waitForEvent("download", { timeout: 60000 }).then(async (d) => { await d.saveAs(PDF); console.log("downloaded:", d.suggestedFilename()); ok = true; }).catch((e) => console.log("no download event:", String((e as Error).message).split("\n")[0]));
  await btn.click({ timeout: 8000 }).catch((e) => console.log("click err: " + e.message.split("\n")[0]));
  // Poll button text transitions while generating.
  for (let i = 0; i < 24; i++) {
    const s = await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => /Factory PDF|Generating|Downloaded/.test(x.textContent || "")); const p = b?.parentElement?.querySelector("p"); return { t: (b?.textContent || "").trim(), e: (p?.textContent || "").trim() }; });
    if (i === 0 || s.t !== "📄 Factory PDF" || s.e) console.log(`  t+${i*0.5}s button="${s.t}" err="${s.e}"`);
    if (ok) break;
    await page.waitForTimeout(500);
  }
  await dlPromise;
  await page.waitForTimeout(1000);
  // Button feedback / inline error.
  const feedback = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /Factory PDF|Generating|Downloaded/.test(x.textContent || ""));
    const errEl = b?.parentElement?.querySelector("p");
    return { buttonText: (b?.textContent || "").trim(), error: (errEl?.textContent || "").trim() };
  });
  console.log("button feedback:", JSON.stringify(feedback));
  console.log("console errors (" + errors.length + "):");
  for (const e of errors.slice(0, 15)) console.log("  " + e);

  if (ok && fs.existsSync(PDF)) {
    const st = fs.statSync(PDF);
    console.log(`\nPDF saved: ${PDF} (${st.size} bytes)`);
  }
  await ctx.close(); await browser.close();
}
main().catch((e) => { console.error("pdf capture crashed:", e); process.exit(1); });
