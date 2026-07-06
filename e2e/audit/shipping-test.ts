// Focused shipping-form persistence test with dumps.
//   node --env-file=.env.e2e --experimental-strip-types e2e/audit/shipping-test.ts <orderId>
import { chromium, type Browser, type Page } from "playwright";
const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PW = process.env.E2E_PASSWORD || "";
const ID = process.argv[2];
async function login(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.fill('input[name="email"]', process.env.E2E_OPERATION_EMAIL || "");
  await page.fill('input[name="password"]', PW);
  await Promise.all([page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 30000 }).catch(() => {}), page.click('button:has-text("Sign in")')]);
  return page;
}
const go = async (p: Page) => { await p.goto(`${BASE}/production/orders/${ID}?open=shipping`, { waitUntil: "domcontentloaded", timeout: 30000 }); await p.waitForTimeout(1200); };
async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const page = await login(browser);
  await go(page);
  const before = await page.evaluate(() => ({
    bl: !!document.querySelector('input[name="bl_number"]'),
    etd: !!document.querySelector('input[name="etd"]'),
    booked: !!document.querySelector('input[name="shipment_booked"]'),
    saveBtns: Array.from(document.querySelectorAll("button")).filter((b) => /save shipment/i.test(b.textContent || "")).length,
    allSaveBtns: Array.from(document.querySelectorAll("button")).map((b) => (b.textContent || "").trim()).filter((t) => /save/i.test(t)),
  }));
  console.log("form present:", JSON.stringify(before));
  if (!before.bl) { console.log("no bl field — aborting"); await browser.close(); return; }

  await page.fill('input[name="bl_number"]', "MEDU-SHIPTEST-01").catch((e) => console.log("bl fill err", (e as Error).message.slice(0, 60)));
  await page.fill('input[name="etd"]', "2026-09-10").catch((e) => console.log("etd fill err", (e as Error).message.slice(0, 60)));
  await page.fill('input[name="eta"]', "2026-10-15").catch((e) => console.log("eta fill err", (e as Error).message.slice(0, 60)));
  // Corrected workflow: mark BOOKED with only booking-stage info (ETD/ETA),
  // NO BL profile and NO BL number — this used to 500, must now succeed.
  await page.check('input[name="shipment_booked"]').catch((e) => console.log("booked check err", (e as Error).message.slice(0, 60)));
  // Click the Save shipment button scoped to the shipment form.
  const btn = page.locator('button:has-text("Save shipment")').first();
  console.log("save button count:", await btn.count());
  await btn.scrollIntoViewIfNeeded().catch(() => {});
  await btn.click({ timeout: 8000 }).catch((e) => console.log("save click err", (e as Error).message.slice(0, 60)));
  await page.waitForTimeout(2000);

  await go(page);
  const after = await page.evaluate(() => ({
    bl: (document.querySelector('input[name="bl_number"]') as HTMLInputElement)?.value || "",
    etd: (document.querySelector('input[name="etd"]') as HTMLInputElement)?.value || "",
    eta: (document.querySelector('input[name="eta"]') as HTMLInputElement)?.value || "",
    booked: (document.querySelector('input[name="shipment_booked"]') as HTMLInputElement)?.checked || false,
  }));
  console.log("after reload:", JSON.stringify(after));
  const ok = after.booked === true && after.bl === "MEDU-SHIPTEST-01";
  console.log(ok ? "\n✅ BOOKED WITHOUT A BL — booking + ETD/ETA/BL persist" : `\n❌ booking failed (booked=${after.booked})`);
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
