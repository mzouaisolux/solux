// Verify insurance is RATE-driven in the quotation builder + additional-charges
// description is wide. Real sales login.
//   node --env-file=.env.e2e --experimental-strip-types e2e/audit/insurance-verify.ts
import { chromium, type Browser, type Page } from "playwright";
const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PW = process.env.E2E_PASSWORD || "";
async function login(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept().catch(() => {}));
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.fill('input[name="email"]', process.env.E2E_SALES_EMAIL || "");
  await page.fill('input[name="password"]', PW);
  await Promise.all([page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 30000 }).catch(() => {}), page.click('button:has-text("Sign in")')]);
  return page;
}
const insuranceShown = (p: Page) =>
  p.evaluate(() => Number((document.body.innerText.match(/Insurance =\s*[A-Z]{3}\s*([\d.,]+)/i)?.[1] || "0").replace(/,/g, "")));

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const page = await login(browser);
  await page.goto(`${BASE}/documents/new`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByRole("button", { name: "+ Add Catalogue Product", exact: false }).waitFor({ state: "visible", timeout: 18000 }).catch(() => {});
  await page.waitForTimeout(600);
  // Project (mandatory).
  await page.getByRole("button", { name: "+ New Project", exact: false }).first().click({ timeout: 8000 }).catch(() => {});
  const pj = page.getByPlaceholder("e.g. SONABEL", { exact: false }).first();
  await pj.waitFor({ state: "visible", timeout: 6000 }).catch(() => {});
  await pj.fill("QA INSURANCE").catch(() => {});
  await page.getByRole("button", { name: "Create", exact: true }).first().click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(2000);
  // Product + unit price 5000 → goods base = 5000 (no freight).
  await page.getByRole("button", { name: "+ Add Catalogue Product", exact: false }).first().click({ timeout: 6000 }).catch(() => {});
  await page.locator('input[type=search]').first().fill("AOSPRO+100").catch(() => {});
  await page.waitForTimeout(1000);
  await page.getByText("AOSPRO+100", { exact: true }).first().click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await page.getByText("UNIT PRICE", { exact: false }).first().locator("xpath=following::input[1]").fill("5000").catch(() => {});
  await page.waitForTimeout(800);

  const rateInput = page.locator('input[aria-label="Insurance rate in per mille"]');
  await rateInput.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  console.log("base (goods) = 5000, no freight\n");
  const cases: { rate: string; expect: number }[] = [
    { rate: "1", expect: 5 },     // 1‰   → 5000 × 0.001
    { rate: "2", expect: 10 },    // 2‰   → 5000 × 0.002
    { rate: "0.5", expect: 2.5 }, // 0.5‰ → 5000 × 0.0005
  ];
  let pass = 0;
  for (const c of cases) {
    await rateInput.fill(c.rate);
    await page.waitForTimeout(500);
    const shown = await insuranceShown(page);
    const ok = Math.abs(shown - c.expect) < 0.005;
    if (ok) pass++;
    console.log(`  ${ok ? "✓" : "✗"} rate ${c.rate}‰ → Insurance shown ${shown} (expected ${c.expect})`);
  }

  // Additional-charge description width.
  await page.getByRole("button", { name: "+ Add charge", exact: false }).first().click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(500);
  const descW = await page.locator('input[placeholder*="ECTN"], input[placeholder*="Name"]').first().evaluate((el) => Math.round((el as HTMLElement).clientWidth)).catch(() => 0);
  const descOk = descW >= 240;
  console.log(`\n  ${descOk ? "✓" : "✗"} additional-charge description width = ${descW}px (want ≥ 240 — usable)`);

  console.log(`\n${pass === cases.length && descOk ? "✅ PASS" : "❌ FAIL"} — insurance rate-driven (${pass}/${cases.length}) + description ${descOk ? "usable" : "TOO NARROW"}`);
  await browser.close();
  if (pass !== cases.length || !descOk) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
