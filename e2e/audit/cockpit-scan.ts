// Inventory scan of production orders (operations login) — surfaces the fields
// that matter for the deposit/production flow so we can pick QA subjects and
// spot inconsistencies (e.g. deposit received but status not In production).
//   node --env-file=.env.e2e --experimental-strip-types e2e/audit/cockpit-scan.ts
import { chromium, type Browser, type Page } from "playwright";
const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PW = process.env.E2E_PASSWORD || "";

async function login(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.fill('input[name="email"]', process.env.E2E_OPERATION_EMAIL || "");
  await page.fill('input[name="password"]', PW);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 45000 }).catch(() => {}),
    page.click('button:has-text("Sign in")'),
  ]);
  return page;
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const page = await login(browser);
  await page.goto(`${BASE}/production/orders`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(600);
  const ids: string[] = await page.evaluate(() =>
    Array.from(new Set(
      Array.from(document.querySelectorAll('a[href*="/production/orders/"]'))
        .map((a) => (a.getAttribute("href") || "").match(/\/production\/orders\/([0-9a-f-]{36})/i)?.[1] || "")
        .filter(Boolean)
    ))
  );
  console.log(`orders found: ${ids.length}\n`);
  const rows: any[] = [];
  for (const id of ids.slice(0, 20)) {
    await page.goto(`${BASE}/production/orders/${id}?open=production`, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(300);
    const d = await page.evaluate(() => {
      const pill = document.querySelector(".po-pill")?.textContent?.trim() || "?";
      const cells: Record<string, string> = {};
      document.querySelectorAll(".po-cell").forEach((c) => {
        const k = c.querySelector(".po-ck")?.textContent?.trim() || "";
        const v = c.querySelector(".po-cv")?.textContent?.trim() || "";
        if (k && !(k in cells)) cells[k] = v;
      });
      const kpis: Record<string, string> = {};
      document.querySelectorAll(".po-kpi").forEach((c) => {
        const k = c.querySelector(".k")?.textContent?.trim() || "";
        const v = c.querySelector(".val")?.textContent?.trim() || "";
        if (k) kpis[k] = v;
      });
      const num = document.querySelector(".po-order-id")?.textContent?.trim() || "";
      const wdInput = document.querySelector('input[name="production_working_days"]') ? "editable" : "locked/absent";
      const locked = /LOCKED/.test(document.body.innerText);
      return { pill, num, wd: cells["Working days"] ?? "?", finish: kpis["Estimated finish"] ?? "?", dep: cells["Deposit received"] ?? cells["Deposit"] ?? "?", wdInput, locked };
    });
    rows.push({ id, ...d });
  }
  console.log("STATUS            | WORK.DAYS | EST.FINISH        | WD FORM        | # / id");
  console.log("-".repeat(100));
  for (const r of rows) {
    console.log(
      `${(r.pill as string).padEnd(17)} | ${String(r.wd).padEnd(9)} | ${String(r.finish).slice(0,17).padEnd(17)} | ${String(r.wdInput).padEnd(14)} | ${r.num} ${r.id.slice(0,8)}`
    );
  }
  // Flag the suspicious ones.
  console.log("\nFLAGS:");
  for (const r of rows) {
    if (r.pill === "Deposit received") console.log(`  ⚠ ${r.id.slice(0,8)} status "Deposit received" (not In production) — deposit paid but production not running`);
    if (r.pill === "In production" && (r.finish === "—" || /not scheduled/i.test(r.finish))) console.log(`  ⚠ ${r.id.slice(0,8)} In production but NO estimated finish (WD form: ${r.wdInput})`);
  }
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
