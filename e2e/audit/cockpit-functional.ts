// =====================================================================
// COCKPIT FUNCTIONAL TEST — real operations login. Exercises each editable
// capability and asserts PERSISTENCE (save → reload → read back). Also repairs
// the two bugs' victims (deposit_received dead-end; started-without-working-days
// with no ETA). Read-write: mutates test orders on purpose.
//   node --env-file=.env.e2e --experimental-strip-types e2e/audit/cockpit-functional.ts
// NOTE: uses domcontentloaded (NOT networkidle — Next dev HMR never idles).
// =====================================================================
import { chromium, type Browser, type Page } from "playwright";
const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PW = process.env.E2E_PASSWORD || "";
const results: { name: string; res: string; detail: string }[] = [];
const rec = (name: string, ok: boolean | "skip", detail = "") =>
  results.push({ name, res: ok === "skip" ? "SKIP" : ok ? "PASS" : "FAIL", detail });

async function login(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.fill('input[name="email"]', process.env.E2E_OPERATION_EMAIL || "");
  await page.fill('input[name="password"]', PW);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 30000 }).catch(() => {}),
    page.click('button:has-text("Sign in")'),
  ]);
  return page;
}
async function go(p: Page, id: string, open = ""): Promise<void> {
  await p.goto(`${BASE}/production/orders/${id}${open ? `?open=${open}` : ""}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await p.waitForTimeout(700);
}
const headerStatus = (p: Page) => p.evaluate(() => document.querySelector(".po-pill")?.textContent?.trim() || "?");
const kpi = (p: Page, label: string) => p.evaluate((l) => {
  const el = Array.from(document.querySelectorAll(".po-kpi")).find((c) => c.querySelector(".k")?.textContent?.trim() === l);
  return el?.querySelector(".val")?.textContent?.trim() || "—";
}, label);
const isDate = (s: string) => /\d{4}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i.test(s) && !/not sched|^—$/i.test(s);
async function save(p: Page, label: string): Promise<void> {
  await p.click(`button:has-text("${label}")`, { timeout: 10000 }).catch(() => {});
  await p.waitForTimeout(1200);
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const page = await login(browser);
  await page.goto(`${BASE}/production/orders`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(700);
  const ids: string[] = await page.evaluate(() => Array.from(new Set(
    Array.from(document.querySelectorAll('a[href*="/production/orders/"]'))
      .map((a) => (a.getAttribute("href") || "").match(/\/production\/orders\/([0-9a-f-]{36})/i)?.[1] || "").filter(Boolean)
  )));

  const cat = { dep: [] as any[], inprod: [] as any[], await: [] as any[], other: [] as any[] };
  for (const id of ids) {
    await go(page, id);
    const s = await headerStatus(page);
    const f = await kpi(page, "Estimated finish");
    (s === "Deposit received" ? cat.dep : s === "In production" ? cat.inprod : s === "Awaiting deposit" ? cat.await : cat.other).push({ id, status: s, finish: f });
  }
  console.log("inventory:", JSON.stringify(cat));

  // TEST 1 · BUG B: working-days editable after start-without-WD, and setting it computes the ETA.
  const noEta = cat.inprod.find((o) => !isDate(o.finish));
  if (noEta) {
    await go(page, noEta.id, "production");
    const wd = await page.locator('input[name="production_working_days"]').count();
    rec("BUG B · working-days form re-appears (was locked)", wd > 0, `order ${noEta.id.slice(0,8)}`);
    if (wd > 0) {
      await page.fill('input[name="production_working_days"]', "20");
      await save(page, "working days");
      await go(page, noEta.id, "production");
      const f = await kpi(page, "Estimated finish");
      rec("BUG B · setting working days computes Estimated finish", isDate(f), `Estimated finish = "${f}"`);
    }
  } else rec("BUG B · working-days recovery", "skip", "no In-production-without-ETA order");

  // TEST 2 · BUG A: deposit_received advances to In production on payment save.
  const dep = cat.dep[0];
  if (dep) {
    await go(page, dep.id, "payment");
    await save(page, "Save payments");
    await go(page, dep.id);
    const st = await headerStatus(page);
    rec("BUG A · deposit_received → In production on payment save", st === "In production", `order ${dep.id.slice(0,8)} now "${st}"`);
  } else rec("BUG A · deposit_received advance", "skip", "no deposit_received order");

  const subj = (cat.inprod[0] || cat.dep[0] || cat.await[0] || cat.other[0])?.id;

  // TEST 3 · payment notes persist.
  if (subj) {
    const token = "QA-note-" + subj.slice(0, 5);
    await go(page, subj, "payment");
    if (await page.locator('input[name="payment_notes"]').count()) {
      await page.fill('input[name="payment_notes"]', token);
      await save(page, "Save payments");
      await go(page, subj, "payment");
      const val = await page.inputValue('input[name="payment_notes"]').catch(() => "");
      rec("Payment notes persist", val === token, `read back "${val}"`);
    } else rec("Payment notes persist", "skip", "field absent");
  }

  // TEST 4 · shipment BL number persist.
  if (subj) {
    const bl = "QA-BL-" + subj.slice(0, 5);
    await go(page, subj, "shipping");
    if (await page.locator('input[name="bl_number"]').count()) {
      await page.fill('input[name="bl_number"]', bl);
      await page.fill('input[name="etd"]', "2026-09-01").catch(() => {});
      await save(page, "Save shipment");
      await go(page, subj, "shipping");
      const val = await page.inputValue('input[name="bl_number"]').catch(() => "");
      rec("Shipment BL number persist", val === bl, `read back "${val}"`);
    } else rec("Shipment persist", "skip", "field absent");
  }

  // TEST 5 · status change via StatusSelect persists.
  const t5 = cat.inprod.find((o) => o.id !== noEta?.id) || cat.inprod[0];
  if (t5) {
    try {
      await go(page, t5.id, "production");
      await page.locator('button[aria-haspopup="menu"]').first().click({ timeout: 8000 });
      await page.waitForTimeout(400);
      await page.getByRole("button", { name: "Production completed" }).first().click({ timeout: 8000 });
      await page.waitForTimeout(400);
      await page.getByRole("button", { name: /Confirm|Change status/ }).first().click({ timeout: 8000 });
      await page.waitForTimeout(1200);
      await go(page, t5.id);
      const st = await headerStatus(page);
      rec("Status change via StatusSelect persists", st === "Production completed", `order ${t5.id.slice(0,8)} → "${st}"`);
    } catch (e) { rec("Status change via StatusSelect persists", false, `interaction: ${(e as Error).message.slice(0,50)}`); }
  } else rec("Status change", "skip", "no In-production order");

  console.log("\n===== COCKPIT FUNCTIONAL RESULTS =====");
  let fail = 0;
  for (const r of results) { if (r.res === "FAIL") fail++; console.log(`  ${r.res === "PASS" ? "✓" : r.res === "SKIP" ? "•" : "✗"} [${r.res}] ${r.name}${r.detail ? ` — ${r.detail}` : ""}`); }
  console.log(`\n${fail === 0 ? "✅" : "❌"} ${results.filter(r=>r.res==="PASS").length} pass · ${fail} fail · ${results.filter(r=>r.res==="SKIP").length} skip`);
  await browser.close();
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
