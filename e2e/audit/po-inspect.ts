// Read-only precise inspection of a production order cockpit (operations login).
//   node --env-file=.env.e2e --experimental-strip-types e2e/audit/po-inspect.ts <id> [<id> ...]
import { chromium, type Browser, type Page } from "playwright";
const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PW = process.env.E2E_PASSWORD || "";

async function login(browser: Browser): Promise<Page> {
  const email = process.env.E2E_OPERATION_EMAIL || "";
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PW);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 45000 }).catch(() => {}),
    page.click('button:has-text("Sign in")'),
  ]);
  return page;
}

async function main(): Promise<void> {
  const ids = process.argv.slice(2);
  const browser = await chromium.launch({ headless: true });
  const page = await login(browser);
  for (const id of ids) {
    await page.goto(`${BASE}/production/orders/${id}`, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(500);
    const info = await page.evaluate(() => {
      const txt = document.body?.innerText || "";
      // Header status = the FIRST .po-pill after the "Production order" eyebrow.
      const pill = document.querySelector(".po-pill")?.textContent?.trim() || "(none)";
      const eyebrows = Array.from(document.querySelectorAll(".eyebrow")).map((e) => e.textContent?.trim());
      const kpis = Array.from(document.querySelectorAll(".po-kpi .k")).map((e) => e.textContent?.trim());
      const naIdx = txt.indexOf("Next action");
      const naTitle = naIdx >= 0 ? txt.slice(naIdx, naIdx + 90).split("\n").filter(Boolean)[1] ?? "" : "";
      return {
        headerPill: pill,
        hasSpine: eyebrows.includes("Next action"),
        naTitle: naTitle.trim(),
        hasQueue: eyebrows.includes("Needs attention"),
        kpiLabels: kpis,
      };
    });
    console.log(`\n=== ${id} ===`);
    console.log("header status pill :", info.headerPill);
    console.log("cognition spine    :", info.hasSpine ? `present — Next action: "${info.naTitle}"` : "MISSING");
    console.log("attention queue    :", info.hasQueue ? "present" : "none");
    console.log("live-status KPIs   :", info.kpiLabels.join(" · ") || "(none)");
  }
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
