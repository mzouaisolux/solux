// Smoke test — load the demo-critical pages per role, confirm they RENDER
// (real content, no crash/error boundary). Read-only.
//   node --env-file=.env.e2e --experimental-strip-types e2e/audit/smoke.ts
import { chromium, type Browser, type Page } from "playwright";
const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PW = process.env.E2E_PASSWORD || "";
const ORDER_A = "01d488b7-00d6-45d7-b51d-af789b2b136d"; // delivered
const ORDER_B = "30a5c945-dd40-4080-91e9-f8332825dd52"; // awaiting deposit
const ERR = /application error|internal server error|something went wrong|unhandled runtime|Element type is invalid|client-side exception|Digest:/i;
const results: string[] = [];
let fails = 0;

async function login(browser: Browser, role: string): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.fill('input[name="email"]', process.env[`E2E_${role.toUpperCase()}_EMAIL`] || "");
  await page.fill('input[name="password"]', PW);
  await Promise.all([page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 30000 }).catch(() => {}), page.click('button:has-text("Sign in")')]);
  return page;
}

async function check(page: Page, role: string, path: string): Promise<void> {
  try {
    const r = await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(900);
    const body = await page.evaluate(() => (document.querySelector("main") || document.body).innerText).catch(() => "");
    const http = r?.status() ?? 0;
    const crashed = ERR.test(body) || body.trim().length < 20;
    const notFound = /could not be found|404/i.test(body);
    const ok = !crashed && !notFound && http < 500;
    if (!ok) fails++;
    results.push(`  ${ok ? "✓" : "✗"} [${role}] ${path} — HTTP ${http}${crashed ? " · CRASH/empty" : ""}${notFound ? " · 404" : ""} · ${body.trim().length} chars`);
  } catch (e) {
    fails++;
    results.push(`  ✗ [${role}] ${path} — nav error: ${(e as Error).message.slice(0, 50)}`);
  }
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });

  const ops = await login(browser, "operation");
  for (const p of ["/dashboard", "/clients", "/projects", "/task-lists", "/operations", "/production/orders", `/production/orders/${ORDER_A}`, `/production/orders/${ORDER_B}`, "/order-follow-up"]) await check(ops, "operation", p);

  const sales = await login(browser, "sales");
  for (const p of ["/dashboard", "/clients", "/business", "/forecast", "/projects", "/documents/new"]) await check(sales, "sales", p);

  const tlm = await login(browser, "tlm");
  for (const p of ["/dashboard", "/task-lists", "/production/orders", `/production/orders/${ORDER_B}`]) await check(tlm, "tlm", p);

  const fin = await login(browser, "finance");
  for (const p of ["/dashboard", "/finance", "/cost-entry"]) await check(fin, "finance", p);

  console.log("===== SMOKE (page render) =====");
  results.forEach((r) => console.log(r));
  console.log(`\n${fails === 0 ? "✅" : "❌"} ${results.length - fails}/${results.length} pages render OK · ${fails} problem(s)`);
  await browser.close();
  if (fails) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
