// Affair page = ERP operational starting point, not CRM-first (owner
// 2026-07-10). Verifies with a REAL sales session that:
//   • the CRM "Next Action / Plan / Schedule Call" block is GONE,
//   • a brand-new project shows the Get-started banner (Create New
//     Quotation + New Request),
//   • the header carries a prominent "+ New Quotation" CTA,
//   • the Requests section lists the affair's Service Requests,
//   • Conversation moved BELOW Documents (kept, demoted).
//
//   node --env-file=.env.local --env-file=.env.e2e --experimental-strip-types e2e/audit/affair-erp-landing.ts
import { chromium, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PW = process.env.E2E_PASSWORD || "";

// Real affairs visible to the sales role (probed 2026-07-10):
const AFFAIR_NEW = "fd0ccc15-09d1-48e2-97fe-5400a58e4052"; // 0 quotations, 0 SRs
const AFFAIR_ESTABLISHED = "b9379903-0264-44ee-82bb-5e380d81e2ab"; // 3 quotations
const AFFAIR_WITH_SR = "b2207a15-e0d9-4e0d-95e9-04d477f71cb9"; // 1 linked SR
const SR_ID = "54b067d9-a54a-4ff3-b123-6b807198998c";

let pass = 0, fail = 0;
function check(label: string, ok: boolean) {
  console.log(`  ${ok ? "✓" : "✗ FAIL"} ${label}`);
  ok ? pass++ : fail++;
}

async function ensureLogin(browser: any, role: string): Promise<{ ctx: any; page: Page }> {
  const email = process.env[`E2E_${role.toUpperCase()}_EMAIL`] || "";
  const AUTH = path.join("e2e", ".auth", `${role}.json`);
  let ctx = await browser.newContext(fs.existsSync(AUTH) ? { storageState: AUTH } : {});
  let page = await ctx.newPage();
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(700);
  if (new URL(page.url()).pathname.endsWith("/login")) {
    await ctx.close(); ctx = await browser.newContext(); page = await ctx.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.fill('input[name="email"]', email); await page.fill('input[name="password"]', PW);
    await Promise.all([page.waitForURL((u: URL) => !u.pathname.endsWith("/login"), { timeout: 45000 }).catch(() => {}), page.click('button:has-text("Sign in")')]);
  }
  await ctx.storageState({ path: AUTH });
  return { ctx, page };
}

async function audit(page: Page, affairId: string) {
  await page.goto(`${BASE}/affairs/${affairId}`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1500);
  return page.evaluate(() => {
    const body = document.body.innerText;
    const labels = [...document.querySelectorAll("h3")].map((h) => (h.textContent || "").trim());
    // Some section headings embed a count ("Quotations0") — match by prefix.
    const pos = (t: string) => labels.findIndex((l) => l.toLowerCase().startsWith(t));
    return {
      body,
      hasNextAction: /next action/i.test(body),
      hasPlanCta: /every live deal needs one|Plan reminder/i.test(body),
      hasScheduleCall: [...document.querySelectorAll("select")].some((s) =>
        [...s.options].some((o) => /^call$/i.test(o.textContent || ""))
      ),
      hasGetStarted: body.includes("Start working on this project"),
      hasCreateQuotationCta: body.includes("+ Create New Quotation"),
      hasHeaderNewQuotation: body.includes("+ New Quotation"),
      hasNewRequest: body.includes("New Request"),
      requestsPos: pos("requests"),
      quotationsPos: pos("quotations"),
      documentsPos: pos("documents"),
      conversationPos: pos("conversation"),
    };
  });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const { ctx, page } = await ensureLogin(browser, "sales");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 160)));

  console.log("\n== NEW project (0 quotations) — the post-creation landing ==");
  let r = await audit(page, AFFAIR_NEW);
  check("CRM 'Next Action' block absent", !r.hasNextAction && !r.hasPlanCta);
  check("CRM 'Call' planner absent", !r.hasScheduleCall);
  check("Get-started banner present", r.hasGetStarted);
  check("'+ Create New Quotation' CTA present", r.hasCreateQuotationCta);
  check("header '+ New Quotation' present", r.hasHeaderNewQuotation);
  check("'New Request' hub present", r.hasNewRequest);
  check("Requests section present (empty state)", r.requestsPos >= 0 && r.body.includes("No requests yet"));
  check(
    "order: Quotations → Requests → Documents → Conversation",
    r.quotationsPos >= 0 && r.requestsPos > r.quotationsPos &&
    r.documentsPos > r.requestsPos && r.conversationPos > r.documentsPos
  );

  console.log("\n== ESTABLISHED project (3 quotations) ==");
  r = await audit(page, AFFAIR_ESTABLISHED);
  check("CRM 'Next Action' block absent", !r.hasNextAction && !r.hasPlanCta);
  check("Get-started banner GONE once quotations exist", !r.hasGetStarted);
  check("header '+ New Quotation' present", r.hasHeaderNewQuotation);
  check("Conversation demoted below Documents", r.conversationPos > r.documentsPos && r.documentsPos > 0);

  console.log("\n== Project WITH a linked Service Request ==");
  r = await audit(page, AFFAIR_WITH_SR);
  check("Requests section lists the SR", r.body.includes("Affaire Test 5 July"));
  check("SR status shown", /quotation generated/i.test(r.body));
  const srLink = await page.locator(`a[href="/projects/${SR_ID}"]`).count();
  check("SR row links to /projects/[id]", srLink > 0);

  console.log(`\npage errors: ${errors.length}`);
  for (const e of errors.slice(0, 5)) console.log("  " + e);
  console.log(fail === 0 ? `\nALL ${pass} CHECKS PASSED` : `\n${fail} CHECK(S) FAILED (${pass} ok)`);
  await ctx.close(); await browser.close();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error("audit crashed:", e); process.exit(1); });
