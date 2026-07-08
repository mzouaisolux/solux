import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const ctx = await browser.newContext({ storageState: "e2e/.auth/operation.json" });
const page = await ctx.newPage();
const errs: string[] = [];
page.on("console", m => { if (m.type() === "error") errs.push(m.text().slice(0, 300)); });
page.on("response", async r => {
  if (r.request().method() === "POST" && r.url().includes("quick-update")) {
    console.log("POST", r.status(), (await r.text()).slice(0, 400));
  }
});
await page.goto("http://localhost:3000/production/quick-update", { waitUntil: "networkidle" });
console.log("url ok, rows:", await page.locator("table tbody tr").count());
const afr = page.locator("table tbody tr", { hasText: "PO-SLX-AFR" }).first();
await afr.locator('[data-qcol="documents"]').first().click();
const dialog = page.locator('[role="dialog"]');
await dialog.waitFor({ state: "visible" });
await dialog.locator("button", { hasText: "Request requirements from Sales" }).click();
await page.waitForTimeout(3500);
const body = await page.evaluate(() => document.body.innerText);
const i = body.indexOf("Missing");
console.log("toast ctx:", JSON.stringify(body.slice(Math.max(0, i - 100), i + 250)));
console.log("console errors:", errs.slice(0, 3));
await browser.close();
