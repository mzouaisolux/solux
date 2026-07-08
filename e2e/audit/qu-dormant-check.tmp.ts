import { chromium } from "@playwright/test";
const browser = await chromium.launch();
for (const role of ["operation", "admin"]) {
  const ctx = await browser.newContext({ storageState: `e2e/.auth/${role}.json` });
  const page = await ctx.newPage();
  await page.goto("http://localhost:3000/production/quick-update", { waitUntil: "networkidle" });
  const btn = await page.locator("text=+ Add order").count();
  console.log(`${role}: "+ Add order" count = ${btn} (expected 0 pre-m155)`);
  await ctx.close();
}
await browser.close();
