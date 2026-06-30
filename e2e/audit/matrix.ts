// =====================================================================
// PHASE A — consolidated permission/visibility matrix across all 6 roles.
// Real login per role (true JWT), probe a comprehensive route set, classify
// each cell: OK / DENY / 404 / ->path (redirect) / ERR. Also dumps the
// visible nav surface per role. Writes matrix.json + prints a table.
//   node --env-file=.env.e2e --experimental-strip-types e2e/audit/matrix.ts
// =====================================================================
import { chromium, type Page, type Browser } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PASSWORD = process.env.E2E_PASSWORD || "";
const ROLES = ["sales", "dir", "tlm", "operation", "finance", "admin"];
const OUT = path.join("e2e", ".runs", "matrix");
fs.mkdirSync(OUT, { recursive: true });

const ROUTES = [
  "/dashboard", "/business", "/forecast",
  "/clients", "/projects", "/prospects", "/prospects/pipeline",
  "/task-lists", "/operations", "/production/orders",
  "/finance", "/cost-entry",
  "/admin/users", "/admin/permissions", "/permissions/actions",
  "/admin/pricing", "/admin/products", "/admin/categories", "/admin/components",
  "/admin/banks", "/admin/sales-conditions", "/admin/events", "/admin/notifications", "/admin/diagnostics",
];
const DENIAL_RE = /(access denied|not authorized|unauthorized|forbidden|don.t have (permission|access)|requires the capability|don.t have access to this section)/i;

async function login(browser: Browser, role: string): Promise<{ ctx: any; page: Page } | null> {
  const email = process.env[`E2E_${role.toUpperCase()}_EMAIL`] || "";
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.endsWith("/login") || u.search.includes("error"), { timeout: 45000 }).catch(() => {}),
    page.click('button:has-text("Sign in")'),
  ]);
  await page.waitForTimeout(700);
  if (new URL(page.url()).pathname.endsWith("/login")) { console.error(`LOGIN FAIL ${role}`); await ctx.close(); return null; }
  return { ctx, page };
}

async function classify(page: Page, route: string): Promise<string> {
  try {
    const resp = await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 40000 });
    await page.waitForTimeout(700);
    const status = resp?.status() ?? 0;
    const finalPath = new URL(page.url()).pathname;
    const body = (await page.evaluate(() => document.body?.innerText || "")).slice(0, 4000);
    if (status === 404 || /This page could not be found/i.test(body)) return "404";
    if (DENIAL_RE.test(body)) return "DENY";
    if (finalPath !== route && !finalPath.startsWith(route)) return `→${finalPath}`;
    return "OK";
  } catch (e) {
    return "ERR";
  }
}

async function navOf(page: Page): Promise<string[]> {
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 40000 });
  await page.waitForTimeout(500);
  return page.evaluate(() => {
    const out = new Set<string>();
    document.querySelectorAll("nav a[href], aside a[href], header a[href]").forEach((a) => {
      const h = (a as HTMLAnchorElement).getAttribute("href") || "";
      const t = (a.textContent || "").trim().replace(/\s+/g, " ");
      if (h.startsWith("/")) out.add(`${h} «${t}»`);
    });
    return [...out];
  });
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const result: Record<string, Record<string, string>> = {};
  const navs: Record<string, string[]> = {};
  for (const role of ROLES) {
    const s = await login(browser, role);
    if (!s) { result[role] = {}; continue; }
    navs[role] = await navOf(s.page);
    result[role] = {};
    for (const r of ROUTES) result[role][r] = await classify(s.page, r);
    await s.ctx.close();
    fs.writeFileSync(path.join(OUT, "matrix.json"), JSON.stringify({ ROUTES, ROLES, result, navs }, null, 2));
    console.log(`done ${role}`);
  }
  await browser.close();

  // Print table
  const col = 7;
  console.log("\n===== PERMISSION / VISIBILITY MATRIX (real sessions) =====");
  console.log("ROUTE".padEnd(24) + ROLES.map((r) => r.slice(0, 6).padEnd(col)).join(""));
  console.log("-".repeat(24 + col * ROLES.length));
  for (const route of ROUTES) {
    console.log(route.padEnd(24) + ROLES.map((r) => (result[r][route] || "-").slice(0, 6).padEnd(col)).join(""));
  }
  console.log("\nlegend: OK=reachable  DENY=access-denied page  404=not found  →x=redirected  ERR=error");
  console.log("\n===== VISIBLE NAV PER ROLE =====");
  for (const role of ROLES) {
    console.log(`\n${role}: ${(navs[role] || []).join("  |  ")}`);
  }
}
main().catch((e) => { console.error("matrix crashed:", e); process.exit(1); });
