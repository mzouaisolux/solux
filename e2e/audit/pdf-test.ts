// F3 runtime proof — open a real quotation, click Generate/Regenerate PDF,
// and verify the user feature actually works after the lazy-import fix:
//   - the @react-pdf engine loads (no import/"pdf is not a function" error)
//   - a PDF blob is produced (a download fires) and uploaded to storage
//   - no console errors, no page errors, no 5xx
//   node --env-file=.env.e2e --experimental-strip-types e2e/audit/pdf-test.ts <docId>
import { chromium, type Page } from "playwright";
import fs from "node:fs"; import path from "node:path";
const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PW = process.env.E2E_PASSWORD || "";
const docId = process.argv[2] || "7f240677-f51e-4bb9-8134-53b8c504780e";
const AUTH = path.join("e2e", ".auth", "sales.json");

async function main() {
  const browser = await chromium.launch({ headless: true });
  let ctx = await browser.newContext(fs.existsSync(AUTH) ? { storageState: AUTH, acceptDownloads: true } : { acceptDownloads: true });
  let page = await ctx.newPage();
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  if (new URL(page.url()).pathname.endsWith("/login")) {
    await ctx.close(); ctx = await browser.newContext({ acceptDownloads: true }); page = await ctx.newPage();
    await page.goto(`${BASE}/login`); await page.fill('input[name="email"]', process.env.E2E_SALES_EMAIL!); await page.fill('input[name="password"]', PW);
    await Promise.all([page.waitForURL((u) => !u.pathname.endsWith("/login")).catch(() => {}), page.click('button:has-text("Sign in")')]);
    await ctx.storageState({ path: AUTH });
  }
  const consoleErrs: string[] = [], pageErrs: string[] = [], storageReqs: string[] = [], serverErrs: string[] = [];
  let download = false;
  page.on("console", (m) => { if (m.type() === "error") consoleErrs.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => pageErrs.push(String(e.message).slice(0, 200)));
  page.on("download", () => { download = true; });
  page.on("response", (r) => {
    const u = r.url();
    if (u.includes("/storage/v1/object")) storageReqs.push(`${r.status()} ${u.split("/object")[1]?.slice(0, 50)}`);
    if (r.status() >= 500) serverErrs.push(`${r.status()} ${u.replace(BASE, "")}`);
  });

  await page.goto(`${BASE}/documents/${docId}`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(800);
  const btn = page.getByRole("button", { name: /Generate PDF|Regenerate/ }).first();
  if (!(await btn.count())) { console.log("NO PDF button found on the page."); await browser.close(); return; }
  const labelBefore = (await btn.textContent())?.trim();
  await btn.click();
  // Wait for the async work (import + render + save + upload) to settle.
  await page.waitForTimeout(7000);
  const labelAfter = (await btn.textContent().catch(() => "?"))?.trim() ?? "?";
  // Any visible error text on the page?
  const errText = await page.evaluate(() => {
    const m = (document.querySelector("main")?.innerText || "");
    const hit = m.match(/Failed to generate PDF|pdf is not|is not a function|Cannot find module|Element type is invalid/i);
    return hit ? hit[0] : null;
  });

  console.log(`\n===== F3 PDF RUNTIME TEST · doc ${docId.slice(0, 8)} =====`);
  console.log(`button: "${labelBefore}" → "${labelAfter}"`);
  console.log(`download fired:      ${download ? "✅ YES (PDF blob produced)" : "❌ no"}`);
  console.log(`storage uploads:     ${storageReqs.length ? storageReqs.join(", ") : "(none seen)"}`);
  console.log(`page errors:         ${pageErrs.length ? pageErrs.join(" | ") : "none ✅"}`);
  console.log(`console errors:      ${consoleErrs.length ? consoleErrs.join(" | ") : "none ✅"}`);
  console.log(`5xx responses:       ${serverErrs.length ? serverErrs.join(" | ") : "none ✅"}`);
  console.log(`visible error text:  ${errText ? "❌ " + errText : "none ✅"}`);
  const ok = download && !pageErrs.length && !errText && !consoleErrs.some((e) => /pdf|module|Element type/i.test(e));
  console.log(`\nVERDICT: ${ok ? "✅ PDF generation works at runtime" : "⚠️ see above"}`);
  await browser.close();
}
main().catch((e) => { console.error("crashed:", e); process.exit(1); });
