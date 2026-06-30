// =====================================================================
// Generic real-session workflow driver. Executes a JSON step list under a
// true role JWT. Lets the audit drive any UI workflow without a bespoke
// script per action. Logs every step; appends captured URLs/UUIDs to a
// manifest for traceability + cleanup.
//   node --env-file=.env.e2e --experimental-strip-types e2e/audit/drive.ts <role> <stepsFile.json> [label]
//
// Steps (array of objects, executed in order):
//   {"goto":"/path"}                       navigate
//   {"clickText":"New client"}             click button/link by visible name (.first)
//   {"click":"css"}                        click by CSS selector
//   {"fill":{"sel":"css","value":"x"}}     fill input/textarea
//   {"fillPlaceholder":{"ph":"text","value":"x"}}
//   {"select":{"sel":"css","value|index|label":...}}
//   {"selectByOption":{"optionText":"...","value|index":...}}  // select whose option list contains optionText
//   {"waitText":"text"}                    wait until text visible
//   {"waitMs":1200}
//   {"snapshot":true}                      dump headings/buttons/fields/links/tables/status
//   {"screenshot":"name"}
//   {"capture":"label"}                    record URL + trailing UUID to manifest
//   {"readStatus":true}                    print current workflow status word
//   {"assertText":"text"} / {"assertNotText":"text"}
// =====================================================================
import { chromium, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PASSWORD = process.env.E2E_PASSWORD || "";
const role = (process.argv[2] || "").toLowerCase();
const stepsFile = process.argv[3];
const runLabel = process.argv[4] || role;
const email = process.env[`E2E_${role.toUpperCase()}_EMAIL`] || "";
const AUTH = path.join("e2e", ".auth", `${role}.json`);
const OUT = path.join("e2e", ".runs", `drive-${role}`);
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.join("e2e", ".runs"), { recursive: true });
const MANIFEST = path.join("e2e", ".runs", "manifest.jsonl");
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

async function ensureLogin(browser: any): Promise<{ ctx: any; page: Page }> {
  let ctx = await browser.newContext(fs.existsSync(AUTH) ? { storageState: AUTH } : {});
  let page = await ctx.newPage();
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(500);
  if (new URL(page.url()).pathname.endsWith("/login")) {
    await ctx.close();
    ctx = await browser.newContext(); page = await ctx.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', PASSWORD);
    await Promise.all([page.waitForURL((u: URL) => !u.pathname.endsWith("/login"), { timeout: 45000 }).catch(() => {}), page.click('button:has-text("Sign in")')]);
  }
  await ctx.storageState({ path: AUTH });
  return { ctx, page };
}

async function snapshot(page: Page): Promise<void> {
  const d = await page.evaluate(() => {
    const t = (e: Element | null) => (e?.textContent || "").trim().replace(/\s+/g, " ");
    const main = document.querySelector("main") || document.body;
    const headings = [...main.querySelectorAll("h1,h2,h3")].map((h) => t(h)).filter(Boolean).slice(0, 25);
    const buttons = [...new Set([...main.querySelectorAll('button,[role="button"],input[type="submit"]')].map((b) => t(b) || (b as HTMLInputElement).value).filter(Boolean))].slice(0, 50);
    const fields = [...main.querySelectorAll("input,select,textarea")].map((f) => { const e = f as HTMLInputElement; return `${e.tagName.toLowerCase()}[${e.type || ""}] name=${e.name || "?"} ph="${e.placeholder || ""}"${e.value ? ` val="${String(e.value).slice(0,20)}"` : ""}`; }).slice(0, 50);
    const links = [...new Set([...main.querySelectorAll("a[href]")].map((a) => { const h = (a as HTMLAnchorElement).getAttribute("href") || ""; return h.startsWith("/") ? `${h} «${t(a)}»` : ""; }).filter(Boolean))].slice(0, 40);
    const tables = [...main.querySelectorAll("table")].map((tb) => ({ headers: [...tb.querySelectorAll("thead th")].map((c) => t(c)), rows: tb.querySelectorAll("tbody tr").length }));
    return { headings, buttons, fields, links, tables };
  });
  console.log(`   ┌ SNAPSHOT`);
  console.log(`   │ headings: ${d.headings.join(" | ")}`);
  console.log(`   │ buttons: ${d.buttons.join(" | ")}`);
  if (d.fields.length) console.log(`   │ fields:\n   │   ${d.fields.join("\n   │   ")}`);
  if (d.links.length) console.log(`   │ links: ${d.links.join("  ")}`);
  for (const tb of d.tables) console.log(`   │ table[${tb.headers.join("|")}] rows=${tb.rows}`);
  console.log(`   └`);
}

async function statusWord(page: Page): Promise<string> {
  return page.evaluate(() => {
    const m = document.querySelector("main")?.innerText || "";
    for (const s of ["Needs revision", "Under validation", "Production ready", "Validated", "Draft", "Cancelled", "Won", "Sent", "Rejected", "Deposit received", "In production", "Completed"]) if (m.includes(s)) return s;
    return "(none)";
  });
}

async function main(): Promise<void> {
  if (!role || !stepsFile) { console.error("usage: drive.ts <role> <stepsFile> [label]"); process.exit(1); }
  const steps = JSON.parse(fs.readFileSync(stepsFile, "utf8")) as any[];
  const browser = await chromium.launch({ headless: true });
  const { ctx, page } = await ensureLogin(browser);
  console.log(`\n=== DRIVE ${role} (${email}) · ${steps.length} steps · label=${runLabel} ===`);
  let i = 0;
  for (const step of steps) {
    i++;
    const key = Object.keys(step)[0];
    try {
      if (step.goto) { const r = await page.goto(`${BASE}${step.goto}`, { waitUntil: "domcontentloaded", timeout: 45000 }); await page.waitForTimeout(800); console.log(`${i}. goto ${step.goto} → ${new URL(page.url()).pathname} [${r?.status()}]`); }
      else if (step.clickText) { await page.getByRole("button", { name: step.clickText, exact: false }).first().or(page.getByRole("link", { name: step.clickText, exact: false }).first()).click({ timeout: 10000 }); await page.waitForTimeout(800); console.log(`${i}. clickText "${step.clickText}" → ${new URL(page.url()).pathname}`); }
      else if (step.click) { await page.locator(step.click).first().click({ timeout: 10000 }); await page.waitForTimeout(700); console.log(`${i}. click ${step.click}`); }
      else if (step.fill) { await page.locator(step.fill.sel).first().fill(String(step.fill.value), { timeout: 10000 }); console.log(`${i}. fill ${step.fill.sel} = "${step.fill.value}"`); }
      else if (step.fillPlaceholder) { await page.getByPlaceholder(step.fillPlaceholder.ph, { exact: false }).first().fill(String(step.fillPlaceholder.value)); console.log(`${i}. fillPlaceholder "${step.fillPlaceholder.ph}"`); }
      else if (step.select) { const l = page.locator(step.select.sel).first(); const o: any = step.select.index != null ? { index: step.select.index } : step.select.label != null ? { label: step.select.label } : { value: String(step.select.value) }; await l.selectOption(o); console.log(`${i}. select ${step.select.sel} ${JSON.stringify(o)}`); }
      else if (step.selectByOption) { const l = page.locator(`select:has(option:text-is("${step.selectByOption.optionText}"))`).first(); const o: any = step.selectByOption.index != null ? { index: step.selectByOption.index } : step.selectByOption.value != null ? { value: String(step.selectByOption.value) } : { label: step.selectByOption.optionText }; await l.selectOption(o); console.log(`${i}. selectByOption ~"${step.selectByOption.optionText}" ${JSON.stringify(o)}`); }
      else if (step.waitText) { await page.getByText(step.waitText, { exact: false }).first().waitFor({ state: "visible", timeout: 12000 }); console.log(`${i}. waitText "${step.waitText}" ✓`); }
      else if (step.waitMs != null) { await page.waitForTimeout(step.waitMs); console.log(`${i}. waitMs ${step.waitMs}`); }
      else if (step.snapshot) { console.log(`${i}. snapshot:`); await snapshot(page); }
      else if (step.screenshot) { await page.screenshot({ path: path.join(OUT, `${step.screenshot}.png`), fullPage: true }); console.log(`${i}. screenshot ${step.screenshot}.png`); }
      else if (step.capture) { const u = page.url(); const id = (u.match(UUID_RE) || [])[0] || ""; fs.appendFileSync(MANIFEST, JSON.stringify({ role, label: runLabel, capture: step.capture, url: u, id }) + "\n"); console.log(`${i}. capture ${step.capture}: ${new URL(u).pathname} id=${id}`); }
      else if (step.readStatus) { console.log(`${i}. readStatus → ${await statusWord(page)}`); }
      else if (step.assertText) { const ok = await page.getByText(step.assertText, { exact: false }).first().count(); console.log(`${i}. assertText "${step.assertText}" → ${ok ? "✓ PRESENT" : "✗ ABSENT"}`); }
      else if (step.assertNotText) { const ok = await page.getByText(step.assertNotText, { exact: false }).first().count(); console.log(`${i}. assertNotText "${step.assertNotText}" → ${ok ? "✗ PRESENT(!)": "✓ absent"}`); }
      else console.log(`${i}. (unknown step ${key})`);
    } catch (e) {
      console.log(`${i}. ✗ ERROR on ${key}: ${String((e as Error).message).split("\n")[0].slice(0, 160)}`);
    }
  }
  await ctx.close();
  await browser.close();
}
main().catch((e) => { console.error("drive crashed:", e); process.exit(1); });
