import { chromium } from "playwright";
const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PW = process.env.E2E_PASSWORD || "";
const OUT = process.argv[3] || "/tmp/po.png";
const id = process.argv[2];
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1280, height: 2200 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.fill('input[name="email"]', process.env.E2E_OPERATION_EMAIL || "");
await page.fill('input[name="password"]', PW);
await Promise.all([
  page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 45000 }).catch(() => {}),
  page.click('button:has-text("Sign in")'),
]);
await page.goto(`${BASE}/production/orders/${id}`, { waitUntil: "networkidle", timeout: 45000 });
await page.waitForTimeout(900);
await page.screenshot({ path: OUT, fullPage: true });
console.log("shot:", OUT);
await b.close();
