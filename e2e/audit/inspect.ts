// =====================================================================
// E2E AUDIT INSPECT — deep-dive a few pages under a real role session.
// Dumps the *actionable* surface: headings, buttons, in-content links,
// tables (headers + row count + sample), form fields, and full main text.
// Reuses .auth/<role>.json (self-heals if dead).
//
// Usage (from ~/dev/facturation):
//   node --env-file=.env.e2e --experimental-strip-types \
//     e2e/audit/inspect.ts <role> /path1,/path2
// =====================================================================

import { chromium, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PASSWORD = process.env.E2E_PASSWORD || "";
const role = (process.argv[2] || "").toLowerCase();
const email = process.env[`E2E_${role.toUpperCase()}_EMAIL`] || "";
const paths = (process.argv[3] || "/dashboard").split(",").map((s) => s.trim()).filter(Boolean);

const AUTH_DIR = path.join("e2e", ".auth");
const OUT_DIR = path.join("e2e", ".runs", `inspect-${role}`);
fs.mkdirSync(OUT_DIR, { recursive: true });
const storageStatePath = path.join(AUTH_DIR, `${role}.json`);
const slug = (p: string) => p.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "root";

async function doLogin(page: Page): Promise<boolean> {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.endsWith("/login") || u.search.includes("error"), { timeout: 45000 }).catch(() => {}),
    page.click('button[type="submit"], button:has-text("Sign in")'),
  ]);
  await page.waitForTimeout(800);
  return !new URL(page.url()).pathname.endsWith("/login");
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  let context = await browser.newContext(
    fs.existsSync(storageStatePath) ? { storageState: storageStatePath } : {},
  );
  let page = await context.newPage();
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(500);
  if (new URL(page.url()).pathname.endsWith("/login")) {
    await context.close();
    context = await browser.newContext();
    page = await context.newPage();
    if (!(await doLogin(page))) { console.error("login failed"); await browser.close(); process.exit(2); }
    await context.storageState({ path: storageStatePath });
  }

  for (const p of paths) {
    await page.goto(`${BASE}${p}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(1200);
    const finalPath = new URL(page.url()).pathname;
    const data = await page.evaluate(() => {
      const txt = (el: Element | null) => (el?.textContent || "").trim().replace(/\s+/g, " ");
      const main = document.querySelector("main") || document.body;
      const headings = [...main.querySelectorAll("h1,h2,h3")].map((h) => `${h.tagName}: ${txt(h)}`).slice(0, 40);
      const buttons = [...new Set([...main.querySelectorAll('button,[role="button"],input[type="submit"],a[role="button"]')]
        .map((b) => txt(b) || (b as HTMLInputElement).value || "").filter(Boolean))].slice(0, 60);
      const links = [...new Set([...main.querySelectorAll("a[href]")]
        .map((a) => { const h = (a as HTMLAnchorElement).getAttribute("href") || ""; return h.startsWith("/") ? `${h}  «${txt(a)}»` : ""; })
        .filter(Boolean))].slice(0, 60);
      const tables = [...main.querySelectorAll("table")].map((t) => {
        const head = [...t.querySelectorAll("thead th, thead td")].map((c) => txt(c));
        const rows = t.querySelectorAll("tbody tr");
        const firstRow = rows[0] ? [...rows[0].querySelectorAll("td,th")].map((c) => txt(c)) : [];
        return { headers: head, rowCount: rows.length, firstRow };
      });
      const fields = [...main.querySelectorAll("input,select,textarea")]
        .map((f) => { const e = f as HTMLInputElement; return `${e.tagName.toLowerCase()}[${e.type || ""}] name=${e.name || "?"} ph="${e.placeholder || ""}"`; })
        .slice(0, 40);
      // role-ish tab strips / filter pills
      const tabs = [...new Set([...main.querySelectorAll('[role="tab"],[class*="tab" i] button,nav[aria-label] a')].map((t) => txt(t)).filter(Boolean))].slice(0, 30);
      return {
        h1: txt(main.querySelector("h1")),
        headings, buttons, links, tables, fields, tabs,
        fullText: (main as HTMLElement).innerText.trim().slice(0, 3500),
      };
    });
    await page.screenshot({ path: path.join(OUT_DIR, `${slug(p)}.png`), fullPage: true });
    fs.writeFileSync(path.join(OUT_DIR, `${slug(p)}.json`), JSON.stringify({ requested: p, finalPath, ...data }, null, 2));

    console.log(`\n${"=".repeat(70)}\nPAGE ${p}  →  ${finalPath}`);
    console.log(`HEADINGS: ${data.headings.join(" | ")}`);
    if (data.tabs.length) console.log(`TABS/FILTERS: ${data.tabs.join(" | ")}`);
    console.log(`BUTTONS (${data.buttons.length}): ${data.buttons.join(" | ")}`);
    if (data.fields.length) console.log(`FIELDS: ${data.fields.join(" ; ")}`);
    console.log(`IN-CONTENT LINKS (${data.links.length}):`);
    for (const l of data.links) console.log(`   ${l}`);
    for (const t of data.tables) console.log(`TABLE headers=[${t.headers.join(" | ")}] rows=${t.rowCount} firstRow=[${t.firstRow.join(" | ")}]`);
    console.log(`--- MAIN TEXT (3500) ---\n${data.fullText}`);
  }
  await browser.close();
}

main().catch((e) => { console.error("inspect crashed:", e); process.exit(1); });
