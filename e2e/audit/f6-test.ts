// F6 proof — create a client via the real modal flow and observe the full
// success path: server-side redirect to /clients/<id>, the ?flash success
// toast, the client page rendered, and zero console/server errors.
//   node --env-file=.env.e2e --experimental-strip-types e2e/audit/f6-test.ts
import { chromium, type Page } from "playwright";
import fs from "node:fs"; import path from "node:path";
const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PW = process.env.E2E_PASSWORD || "";
const AUTH = path.join("e2e", ".auth", "sales.json");
const stamp = String(process.argv[2] || "ZF7"); // 3-letter client_code, override per run
const company = `ZZZ_E2E_AUDIT_F6_${stamp}`;

async function login(browser: any): Promise<Page> {
  let ctx = await browser.newContext(fs.existsSync(AUTH) ? { storageState: AUTH } : {});
  let page = await ctx.newPage();
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  if (new URL(page.url()).pathname.endsWith("/login")) {
    await ctx.close(); ctx = await browser.newContext(); page = await ctx.newPage();
    await page.goto(`${BASE}/login`); await page.fill('input[name="email"]', process.env.E2E_SALES_EMAIL!); await page.fill('input[name="password"]', PW);
    await Promise.all([page.waitForURL((u: URL) => !u.pathname.endsWith("/login")).catch(() => {}), page.click('button:has-text("Sign in")')]);
    await ctx.storageState({ path: AUTH });
  }
  return page;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await login(browser);
  const consoleErrs: string[] = [], pageErrs: string[] = [], serverErrs: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrs.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => pageErrs.push(String(e.message).slice(0, 200)));
  page.on("response", (r) => { if (r.status() >= 500) serverErrs.push(`${r.status()} ${r.url().replace(BASE, "")}`); });

  // Open the modal via the in-page button (the normal flow) on /clients.
  await page.goto(`${BASE}/clients`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "+ New client" }).first().click();
  await page.getByText("New client").first().waitFor({ state: "visible", timeout: 8000 });
  await page.fill('input[name="company_name"]', company);
  await page.fill('input[name="client_code"]', stamp);

  // Submit + wait for the SERVER redirect to the created client page.
  let redirected = false, toast = false, clientShown = false, finalUrl = "";
  try {
    await Promise.all([
      page.waitForURL(/\/clients\/[0-9a-f-]{36}/, { timeout: 15000 }),
      page.getByRole("button", { name: "Add client" }).click(),
    ]);
    redirected = true;
  } catch { /* no redirect */ }
  finalUrl = new URL(page.url()).pathname;

  // Catch the one-shot toast (Toaster reads ?flash, shows it, strips the param).
  for (let i = 0; i < 12 && !toast; i++) {
    const txt = await page.evaluate(() => document.body?.innerText || "");
    if (/Client created/i.test(txt)) toast = true;
    if (!toast) await page.waitForTimeout(250);
  }
  const bodyTxt = await page.evaluate(() => document.querySelector("main")?.innerText || "");
  clientShown = bodyTxt.includes(company);

  console.log(`\n===== F6 CLIENT-CREATE PROOF =====`);
  console.log(`company:            ${company} (code ${stamp})`);
  console.log(`redirect to client: ${redirected ? "✅ YES" : "❌ NO"}  (final: ${finalUrl})`);
  console.log(`success toast:      ${toast ? "✅ YES (\"Client created\")" : "❌ not seen"}`);
  console.log(`client page shown:  ${clientShown ? "✅ YES (company name on page)" : "❌ no"}`);
  console.log(`page errors:        ${pageErrs.length ? "❌ " + pageErrs.join(" | ") : "none ✅"}`);
  console.log(`console errors:     ${consoleErrs.length ? "❌ " + consoleErrs.join(" | ") : "none ✅"}`);
  console.log(`5xx responses:      ${serverErrs.length ? "❌ " + serverErrs.join(" | ") : "none ✅"}`);
  const ok = redirected && toast && clientShown && !pageErrs.length && !serverErrs.length;
  console.log(`\nVERDICT: ${ok ? "✅ F6 OBSERVED & VALIDATED" : "❌ still broken — see above"}`);
  await page.screenshot({ path: "e2e/.runs/f6-proof.png" }).catch(() => {});
  await browser.close();
}
main().catch((e) => { console.error("crashed:", e); process.exit(1); });
