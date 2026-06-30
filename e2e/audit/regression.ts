// =====================================================================
// E2E REGRESSION SUITE — real logins, asserts the core permission matrix
// + the audit fixes (F1 director visibility, F3 document-page 200s). Fast,
// read-only, deterministic. Exit 1 on any failure (CI-able).
//   node --env-file=.env.e2e --experimental-strip-types e2e/audit/regression.ts
// =====================================================================
import { chromium, type Browser, type Page } from "playwright";
const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PW = process.env.E2E_PASSWORD || "";
const fails: string[] = [];
const passes: string[] = [];

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
const DENY_RE = /(access denied|don.t have (permission|access)|requires the capability)/i;
async function classify(page: Page, route: string): Promise<"OK" | "DENY" | "404" | "ERR"> {
  try {
    const r = await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 40000 });
    await page.waitForTimeout(500);
    const body = (await page.evaluate(() => document.body?.innerText || "")).slice(0, 4000);
    if (r?.status() === 404 || /could not be found/i.test(body)) return "404";
    if (DENY_RE.test(body)) return "DENY";
    return "OK";
  } catch { return "ERR"; }
}
function check(name: string, actual: string, expected: string) {
  if (actual === expected) { passes.push(`✓ ${name} = ${actual}`); }
  else { fails.push(`✗ ${name} — expected ${expected}, got ${actual}`); }
}

// route → expected per role. "200" markers asserted via status too.
const MATRIX: Record<string, Record<string, "OK" | "DENY">> = {
  "/permissions/actions": { sales: "DENY", dir: "DENY", tlm: "DENY", operation: "DENY", finance: "DENY" },
  "/finance":             { sales: "DENY", dir: "OK",   tlm: "DENY", operation: "DENY", finance: "OK"   },
  "/prospects":           { sales: "OK",   dir: "OK",   tlm: "DENY", operation: "DENY", finance: "DENY" },
  "/cost-entry":          { sales: "DENY", dir: "DENY", tlm: "DENY", operation: "DENY", finance: "OK"   },
};

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });

  // 1) Permission matrix (litmus per role).
  for (const role of ["sales", "dir", "tlm", "operation", "finance"]) {
    const page = await login(browser, role);
    for (const [route, exp] of Object.entries(MATRIX)) {
      if (!exp[role]) continue;
      check(`[${role}] ${route}`, await classify(page, route), exp[role]);
    }
    await page.context().close();
  }

  // 2) F3 — document pages must render (HTTP 200), not 500.
  {
    const page = await login(browser, "sales");
    for (const route of ["/documents/new"]) {
      const r = await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 45000 });
      check(`[F3] ${route} HTTP`, String(r?.status()), "200");
    }
    // First existing quotation, if any, must also be 200 (the [id] page).
    await page.goto(`${BASE}/clients`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(600);
    const docHref = await page.evaluate(() => {
      const a = [...document.querySelectorAll('a[href^="/documents/"]')].find((x) => /\/documents\/[0-9a-f-]{36}/.test((x as HTMLAnchorElement).getAttribute("href") || ""));
      return a ? (a as HTMLAnchorElement).getAttribute("href") : null;
    });
    if (docHref) {
      const r = await page.goto(`${BASE}${docHref}`, { waitUntil: "domcontentloaded", timeout: 45000 });
      check(`[F3] ${docHref} HTTP`, String(r?.status()), "200");
    } else { passes.push("• [F3] no existing doc link found to assert [id] page (skipped)"); }
    await page.context().close();
  }

  // 3) F1 — sales_director must SEE operational data (non-empty clients list).
  {
    const page = await login(browser, "dir");
    await page.goto(`${BASE}/clients`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(700);
    const clientLinks = await page.evaluate(() => document.querySelectorAll('a[href^="/clients/"]').length);
    check("[F1] dir sees clients (links > 0)", clientLinks > 0 ? "YES" : "NO", "YES");
    await page.context().close();
  }

  await browser.close();
  console.log("\n===== E2E REGRESSION =====");
  for (const p of passes) console.log("  " + p);
  if (fails.length) { console.log("\nFAILURES:"); for (const f of fails) console.log("  " + f); }
  console.log(`\n${fails.length ? "❌ FAIL" : "✅ PASS"} — ${passes.length} ok, ${fails.length} failed`);
  process.exit(fails.length ? 1 : 0);
}
main().catch((e) => { console.error("regression crashed:", e); process.exit(1); });
