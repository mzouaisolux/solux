// =====================================================================
// DEPOSIT → PRODUCTION verification (real operations login).
//   Part A: read-only root-cause inspection of a target order.
//   Part B: record a qualifying deposit on an awaiting order and assert
//           production STARTS (status → In production) + loud flash.
//   node --env-file=.env.e2e --experimental-strip-types e2e/audit/deposit-verify.ts [orderId]
// =====================================================================
import { chromium, type Browser, type Page } from "playwright";

const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PW = process.env.E2E_PASSWORD || "";
const TARGET = process.argv[2] || "8d9abe3b-43c1-48f9-bf8d-b8a6d47ee4aa";

async function login(browser: Browser, role: string): Promise<Page> {
  const email = process.env[`E2E_${role.toUpperCase()}_EMAIL`] || "";
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

const body = (p: Page) => p.evaluate(() => document.body?.innerText || "");

async function statusOf(page: Page): Promise<string> {
  // The authoritative status is the FIRST header pill (next to the
  // "Production order" eyebrow) — NOT a body substring, since labels like
  // "Deposit received" also appear in the payment KPIs and the flash copy.
  return page.evaluate(
    () => document.querySelector(".po-pill")?.textContent?.trim() || "?"
  );
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const page = await login(browser, "operation");

  // ---- Part A: root cause on the target order (read-only) ----------------
  await page.goto(`${BASE}/production/orders/${TARGET}`, { waitUntil: "domcontentloaded", timeout: 40000 });
  await page.waitForTimeout(700);
  const aTxt = await body(page);
  const aStatus = await statusOf(page);
  const hasSpine = aTxt.includes("Next action");
  const naTitle = (aTxt.match(/Next action[\s\S]{0,80}?\n([^\n]+)/)?.[1] || "").trim();
  const gated = /gated on the deposit/i.test(aTxt);
  const reqMatch = aTxt.match(/Required:\s*([A-Z]{3}\s*[\d.,]+)/i);
  console.log("===== PART A · root cause on target order =====");
  console.log("order         :", TARGET);
  console.log("status        :", aStatus);
  console.log("cockpit spine :", hasSpine ? `present — next action: "${naTitle}"` : "MISSING");
  console.log("deposit gate  :", gated ? `expected ${reqMatch?.[1] ?? "?"}` : "no computable deposit expected (→ old silent no-op)");

  // ---- Part B: prove the fix on an awaiting, deposit-gated order ----------
  console.log("\n===== PART B · deposit starts production =====");
  const candidates: string[] = [];
  if (aStatus === "Awaiting deposit" && gated) candidates.push(TARGET);
  // Discover more awaiting orders from the list.
  await page.goto(`${BASE}/production/orders`, { waitUntil: "domcontentloaded", timeout: 40000 });
  await page.waitForTimeout(600);
  const links: string[] = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href*="/production/orders/"]'))
      .map((a) => (a as HTMLAnchorElement).getAttribute("href") || "")
      .map((h) => (h.match(/\/production\/orders\/([0-9a-f-]{36})/i)?.[1] || ""))
      .filter(Boolean)
  );
  for (const id of Array.from(new Set(links))) {
    if (candidates.length >= 3) break;
    if (candidates.includes(id)) continue;
    await page.goto(`${BASE}/production/orders/${id}`, { waitUntil: "domcontentloaded", timeout: 40000 });
    await page.waitForTimeout(400);
    const t = await body(page);
    if (/Awaiting deposit/.test(t) && /gated on the deposit/i.test(t)) candidates.push(id);
  }

  if (!candidates.length) {
    console.log("RESULT: no awaiting-deposit, deposit-gated order available to mutate — Part B skipped.");
    console.log("(Part A still confirms the root cause + cockpit rendering.)");
    await browser.close();
    return;
  }

  const orderId = candidates[0];
  await page.goto(`${BASE}/production/orders/${orderId}`, { waitUntil: "domcontentloaded", timeout: 40000 });
  await page.waitForTimeout(700);
  const before = await statusOf(page);

  // Payment editor auto-opens (next action targets payment); open it if not.
  if (!(await page.locator('input[name="deposit_received_amount"]').count())) {
    await page.getByRole("button").filter({ hasText: /^Payment/ }).first().click().catch(() => {});
    await page.waitForTimeout(300);
  }
  await page.fill('input[name="deposit_received_amount"]', "999999");
  const today = new Date().toISOString().slice(0, 10);
  await page.fill('input[name="deposit_received_at"]', today).catch(() => {});
  await Promise.all([
    page.waitForURL((u) => u.href.includes("flash="), { timeout: 40000 }).catch(() => {}),
    page.click('button:has-text("Save payments")'),
  ]);
  await page.waitForTimeout(900);

  const url = page.url();
  const after = await statusOf(page);
  const afterTxt = await body(page);
  const flashOk = url.includes("flash=production_started");
  const bannerOk = /Production started/i.test(afterTxt);
  const committed = (afterTxt.match(/Committed finish\s*([^\n·]+)/)?.[1] || "").trim();

  console.log("order         :", orderId);
  console.log("status before :", before);
  console.log("status after  :", after);
  console.log("flash param   :", flashOk ? "?flash=production_started ✓" : `MISSING (${url.split("?")[1] ?? "no query"})`);
  console.log("banner        :", bannerOk ? "“Production started” shown ✓" : "MISSING");
  console.log("committed finish:", committed || "(working days not set — banner prompts to set them)");

  const pass = before === "Awaiting deposit" && after === "In production" && flashOk && bannerOk;
  console.log(`\n${pass ? "✅ PASS" : "❌ FAIL"} — recording the deposit ${pass ? "started production" : "did NOT behave as expected"}.`);
  await browser.close();
  if (!pass) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
