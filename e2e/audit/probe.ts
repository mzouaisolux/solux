// =====================================================================
// E2E AUDIT PROBE — real login, real JWT per role (NO View-As bypass).
// Logs in a role via the actual /login server action, then probes a set
// of routes recording the server's real response: final URL after any
// middleware/server redirect (the permission "litmus test"), HTTP status,
// page title, visible nav surface, denial markers, and a screenshot.
//
// Usage (from ~/dev/facturation):
//   node --env-file=.env.e2e --experimental-strip-types \
//     e2e/audit/probe.ts <role> [comma,sep,paths]
//   role ∈ sales|dir|finance|tlm|operation|admin
//
// Reuses .auth/<role>.json if the session is still alive; else re-logins.
// Writes JSON + screenshots under e2e/.runs/audit-<role>/.
// =====================================================================

import { chromium, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PASSWORD = process.env.E2E_PASSWORD || "";
const role = (process.argv[2] || "").toLowerCase();
const email = process.env[`E2E_${role.toUpperCase()}_EMAIL`] || "";

if (!role || !email || !PASSWORD) {
  console.error(`[probe] missing role/email/password. role=${role} email=${email ? "ok" : "MISSING"}`);
  process.exit(1);
}

// Default probe set: each role's own surface + cross-role routes that MUST
// be denied to a restricted account (the permission litmus tests).
const DEFAULT_PATHS = [
  "/dashboard",
  "/morning",
  "/business",
  "/finance",
  "/clients",
  "/projects",
  "/prospects",
  "/prospects/tenders",
  "/pricing",
  "/catalog/products",
  "/catalog/categories",
  "/admin",
  "/admin/users",
  "/admin/diagnostics",
  "/permissions/actions",
];

const paths = (process.argv[3]?.split(",").map((s) => s.trim()).filter(Boolean)) || DEFAULT_PATHS;

const AUTH_DIR = path.join("e2e", ".auth");
const OUT_DIR = path.join("e2e", ".runs", `audit-${role}`);
fs.mkdirSync(AUTH_DIR, { recursive: true });
fs.mkdirSync(OUT_DIR, { recursive: true });
const storageStatePath = path.join(AUTH_DIR, `${role}.json`);

const slug = (p: string) => p.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "root";

const DENIAL_RE = /(not authorized|unauthorized|forbidden|403|access denied|don.t have (permission|access)|no access|accès refusé|non autorisé|permission denied)/i;

async function doLogin(page: Page): Promise<boolean> {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.endsWith("/login") || u.search.includes("error"), { timeout: 45000 }).catch(() => {}),
    page.click('button[type="submit"], button:has-text("Sign in")'),
  ]);
  await page.waitForTimeout(800);
  const url = new URL(page.url());
  if (url.pathname.endsWith("/login")) {
    const err = url.searchParams.get("error") || "(no error param, still on /login)";
    console.error(`[probe] LOGIN FAILED for ${email}: ${err}`);
    return false;
  }
  return true;
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const haveState = fs.existsSync(storageStatePath);
  let context = await browser.newContext(
    haveState ? { storageState: storageStatePath } : {},
  );
  let page = await context.newPage();

  // Auth check / self-heal.
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(600);
  if (new URL(page.url()).pathname.endsWith("/login")) {
    // session dead or never existed → fresh login
    await context.close();
    context = await browser.newContext();
    page = await context.newPage();
    const ok = await doLogin(page);
    if (!ok) {
      await browser.close();
      process.exit(2);
    }
    await context.storageState({ path: storageStatePath });
  }

  // Discover the visible navigation surface (capability-driven nav).
  const navLinks: { href: string; text: string }[] = await page.evaluate(() => {
    const seen = new Set<string>();
    const out: { href: string; text: string }[] = [];
    document.querySelectorAll("nav a[href], aside a[href], header a[href]").forEach((a) => {
      const href = (a as HTMLAnchorElement).getAttribute("href") || "";
      const text = (a.textContent || "").trim().replace(/\s+/g, " ");
      if (href.startsWith("/") && !seen.has(href)) {
        seen.add(href);
        out.push({ href, text });
      }
    });
    return out;
  });

  const results: Record<string, unknown>[] = [];
  for (const p of paths) {
    let status: number | undefined;
    let finalUrl = "";
    let title = "";
    let bodyText = "";
    let err = "";
    try {
      const resp = await page.goto(`${BASE}${p}`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(900); // settle client-side redirects
      status = resp?.status();
      finalUrl = page.url();
      title = await page.title();
      bodyText = await page.evaluate(() => (document.body?.innerText || "").trim());
      await page.screenshot({ path: path.join(OUT_DIR, `${slug(p)}.png`) });
    } catch (e) {
      err = String((e as Error).message || e);
    }
    const finalPath = finalUrl ? new URL(finalUrl).pathname : "";
    const redirected = finalPath !== p && !finalPath.startsWith(p);
    const deniedMarker = DENIAL_RE.test(bodyText.slice(0, 4000));
    const toLogin = finalPath.endsWith("/login");
    results.push({
      requested: p,
      status,
      finalPath,
      redirected,
      toLogin,
      deniedMarker,
      title,
      snippet: bodyText.slice(0, 280).replace(/\n+/g, " ⏎ "),
      err: err || undefined,
    });
  }

  fs.writeFileSync(
    path.join(OUT_DIR, "probe.json"),
    JSON.stringify({ role, email, base: BASE, navLinks, results }, null, 2),
  );

  // Readable summary to stdout.
  console.log(`\n===== ROLE: ${role} (${email}) =====`);
  console.log(`\n--- VISIBLE NAV (${navLinks.length} links) ---`);
  for (const l of navLinks) console.log(`  ${l.href.padEnd(34)} ${l.text}`);
  console.log(`\n--- ROUTE PROBES ---`);
  console.log(
    "REQUESTED".padEnd(24) + "STAT  " + "FINAL".padEnd(26) + "FLAGS",
  );
  for (const r of results as any[]) {
    const flags = [
      r.redirected ? "REDIRECT" : "",
      r.toLogin ? "→LOGIN" : "",
      r.deniedMarker ? "DENIED-MARK" : "",
      r.err ? "ERR" : "",
    ].filter(Boolean).join(" ");
    console.log(
      String(r.requested).padEnd(24) +
        String(r.status ?? "-").padEnd(6) +
        String(r.finalPath).padEnd(26) +
        flags,
    );
  }
  console.log(`\n[probe] wrote ${path.join(OUT_DIR, "probe.json")} + screenshots`);
  await browser.close();
}

main().catch((e) => {
  console.error("[probe] crashed:", e);
  process.exit(1);
});
