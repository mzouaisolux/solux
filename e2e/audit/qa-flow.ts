// =====================================================================
// QA-FLOW — enhanced real-session driver for UX QA (2026-07 full-flow test).
// Extends drive.ts with: console/pageerror/HTTP>=400 capture, a rich `dump`
// step (fields+labels, buttons, links, status badges, notification bell,
// main innerText slice), configurable screenshot dir. Real per-role JWT.
//
//   cd ~/dev/facturation && node --env-file=.env.e2e --experimental-strip-types \
//     e2e/audit/qa-flow.ts <role> <stepsFile.json> <outDir>
//
// Steps DSL (executed in order, errors are caught & logged, run continues):
//   {"goto":"/path"}                          navigate (records HTTP status)
//   {"clickText":"New client"}                click button/link by visible name
//   {"click":"css"}                           click by CSS selector (.first)
//   {"clickNth":{"sel":"css","n":1}}          click nth match
//   {"fill":{"sel":"css","value":"x"}}        fill input/textarea
//   {"fillLabel":{"label":"Name","value":"x"}} fill the field labelled "Name"
//   {"fillPlaceholder":{"ph":"text","value":"x"}}
//   {"type":{"sel":"css","value":"x"}}        type char-by-char (comboboxes)
//   {"press":{"sel":"css","key":"Enter"}}
//   {"select":{"sel":"css","value|index|label":...}}
//   {"selectByOption":{"optionText":"...","value|index":...}}
//   {"check":"css"} / {"uncheck":"css"}
//   {"waitText":"text"} / {"waitMs":1200}
//   {"dump":true}                             rich page dump (the main tool)
//   {"screenshot":"name"}                     PNG into outDir
//   {"capture":"label"}                       record URL + trailing UUID to manifest
//   {"assertText":"t"} / {"assertNotText":"t"}
//   {"note":"free text"}                      echoes a label into the log
// =====================================================================
import { chromium, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PASSWORD = process.env.E2E_PASSWORD || "";
const role = (process.argv[2] || "").toLowerCase();
const stepsFile = process.argv[3];
const OUT = process.argv[4] || path.join("e2e", ".runs", `qa-${role}`);
const email = process.env[`E2E_${role.toUpperCase()}_EMAIL`] || "";
const AUTH = path.join("e2e", ".auth", `${role}.json`);
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.join("e2e", ".runs"), { recursive: true });
const MANIFEST = path.join("e2e", ".runs", "manifest.jsonl");
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const errors: string[] = [];

async function ensureLogin(browser: any): Promise<{ ctx: any; page: Page }> {
  let ctx = await browser.newContext(fs.existsSync(AUTH) ? { storageState: AUTH } : {});
  let page = await ctx.newPage();
  wireErrorCapture(page);
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(600);
  if (new URL(page.url()).pathname.endsWith("/login")) {
    await ctx.close();
    ctx = await browser.newContext(); page = await ctx.newPage(); wireErrorCapture(page);
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', PASSWORD);
    await Promise.all([
      page.waitForURL((u: URL) => !u.pathname.endsWith("/login"), { timeout: 45000 }).catch(() => {}),
      page.click('button:has-text("Sign in")'),
    ]);
    await page.waitForTimeout(800);
  }
  await ctx.storageState({ path: AUTH });
  return { ctx, page };
}

function wireErrorCapture(page: Page): void {
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console.error: ${m.text().slice(0, 200)}`); });
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e.message).slice(0, 200)}`));
  page.on("response", (r) => { const s = r.status(); if (s >= 400 && !r.url().includes("favicon")) errors.push(`HTTP ${s} ${r.request().method()} ${r.url().replace(BASE, "").slice(0, 120)}`); });
}

async function richDump(page: Page): Promise<void> {
  await page.waitForTimeout(300);
  const d = await page.evaluate(() => {
    const t = (e: Element | null) => (e?.textContent || "").trim().replace(/\s+/g, " ");
    const main = document.querySelector("main") || document.body;
    const headings = [...main.querySelectorAll("h1,h2,h3")].map((h) => t(h)).filter(Boolean).slice(0, 30);
    const buttons = [...new Set([...main.querySelectorAll('button,[role="button"],input[type="submit"],a[class*="btn"],a[class*="button"]')].map((b) => t(b) || (b as HTMLInputElement).value).filter(Boolean))].slice(0, 60);
    // fields with associated label text
    const fields = [...main.querySelectorAll("input,select,textarea")].map((f) => {
      const e = f as HTMLInputElement;
      let label = "";
      if (e.id) { const l = document.querySelector(`label[for="${e.id}"]`); if (l) label = (l.textContent || "").trim().replace(/\s+/g, " "); }
      if (!label) { const p = e.closest("label"); if (p) label = (p.textContent || "").trim().replace(/\s+/g, " "); }
      const opts = e.tagName === "SELECT" ? " {" + [...(e as unknown as HTMLSelectElement).options].map((o) => o.text.trim()).slice(0, 12).join("|") + "}" : "";
      return `${e.tagName.toLowerCase()}[${e.type || ""}] name=${e.name || "?"}${label ? ` label="${label.slice(0, 40)}"` : ""}${e.placeholder ? ` ph="${e.placeholder}"` : ""}${e.value ? ` val="${String(e.value).slice(0, 24)}"` : ""}${opts}`;
    }).slice(0, 60);
    const links = [...new Set([...main.querySelectorAll("a[href]")].map((a) => { const h = (a as HTMLAnchorElement).getAttribute("href") || ""; return h.startsWith("/") ? `${h} «${t(a).slice(0, 28)}»` : ""; }).filter(Boolean))].slice(0, 40);
    const tables = [...main.querySelectorAll("table")].map((tb) => ({ headers: [...tb.querySelectorAll("thead th")].map((c) => t(c)), rows: tb.querySelectorAll("tbody tr").length }));
    // status-ish badges
    const badges = [...new Set([...main.querySelectorAll('[class*="badge"],[class*="status"],[class*="chip"],[class*="pill"],[class*="tag"]')].map((b) => t(b)).filter((x) => x && x.length < 40))].slice(0, 20);
    // notification bell count (header, outside main)
    let bell = "";
    const bellEl = document.querySelector('[class*="bell"],[aria-label*="notif" i],[href*="notif"]') || [...document.querySelectorAll("header *,nav *")].find((e) => /^\d+\+?$/.test((e.textContent || "").trim()) && (e.textContent || "").trim().length <= 3);
    if (bellEl) bell = (bellEl.textContent || "").trim().replace(/\s+/g, " ").slice(0, 30);
    const bodyText = ((main as HTMLElement).innerText || "").replace(/\n{2,}/g, "\n").trim().slice(0, 1800);
    return { headings, buttons, fields, links, tables, badges, bell, bodyText };
  });
  const L: string[] = [];
  L.push(`URL: ${new URL(page.url()).pathname}${new URL(page.url()).search}`);
  L.push(`HEADINGS: ${d.headings.join(" | ")}`);
  L.push(`BUTTONS: ${d.buttons.join(" | ")}`);
  if (d.badges.length) L.push(`BADGES/STATUS: ${d.badges.join(" | ")}`);
  if (d.bell) L.push(`BELL/NOTIF: ${d.bell}`);
  if (d.fields.length) L.push(`FIELDS:\n  - ${d.fields.join("\n  - ")}`);
  if (d.links.length) L.push(`LINKS: ${d.links.join("  ")}`);
  for (const tb of d.tables) L.push(`TABLE[${tb.headers.join(" | ")}] rows=${tb.rows}`);
  L.push(`--- MAIN TEXT ---\n${d.bodyText}\n--- /TEXT ---`);
  console.log(L.join("\n"));
}

async function main(): Promise<void> {
  if (!role || !stepsFile) { console.error("usage: qa-flow.ts <role> <stepsFile> [outDir]"); process.exit(1); }
  const steps = JSON.parse(fs.readFileSync(stepsFile, "utf8")) as any[];
  const browser = await chromium.launch({ headless: true });
  const { ctx, page } = await ensureLogin(browser);
  await page.setViewportSize({ width: 1440, height: 1000 });
  console.log(`\n=== QA-FLOW ${role} (${email}) · ${steps.length} steps · out=${OUT} ===`);
  let i = 0;
  for (const step of steps) {
    i++;
    const key = Object.keys(step)[0];
    const errMark = errors.length;
    try {
      if (step.goto != null) { const r = await page.goto(`${BASE}${step.goto}`, { waitUntil: "domcontentloaded", timeout: 45000 }); await page.waitForTimeout(900); console.log(`\n${i}. GOTO ${step.goto} → ${new URL(page.url()).pathname} [HTTP ${r?.status()}]`); }
      else if (step.clickText != null) { await page.getByRole("button", { name: step.clickText, exact: false }).first().or(page.getByRole("link", { name: step.clickText, exact: false }).first()).click({ timeout: 12000 }); await page.waitForTimeout(1000); console.log(`\n${i}. CLICKTEXT "${step.clickText}" → ${new URL(page.url()).pathname}`); }
      else if (step.click != null) { await page.locator(step.click).first().click({ timeout: 12000 }); await page.waitForTimeout(900); console.log(`\n${i}. CLICK ${step.click}`); }
      else if (step.clickNth != null) { await page.locator(step.clickNth.sel).nth(step.clickNth.n).click({ timeout: 12000 }); await page.waitForTimeout(900); console.log(`\n${i}. CLICKNTH ${step.clickNth.sel}[${step.clickNth.n}]`); }
      else if (step.fill != null) { await page.locator(step.fill.sel).first().fill(String(step.fill.value), { timeout: 12000 }); console.log(`\n${i}. FILL ${step.fill.sel} = "${step.fill.value}"`); }
      else if (step.fillLabel != null) { await page.getByLabel(step.fillLabel.label, { exact: false }).first().fill(String(step.fillLabel.value), { timeout: 12000 }); console.log(`\n${i}. FILLLABEL "${step.fillLabel.label}" = "${step.fillLabel.value}"`); }
      else if (step.fillPlaceholder != null) { await page.getByPlaceholder(step.fillPlaceholder.ph, { exact: false }).first().fill(String(step.fillPlaceholder.value)); console.log(`\n${i}. FILLPH "${step.fillPlaceholder.ph}"`); }
      else if (step.type != null) { await page.locator(step.type.sel).first().click(); await page.locator(step.type.sel).first().pressSequentially(String(step.type.value), { delay: 40 }); await page.waitForTimeout(600); console.log(`\n${i}. TYPE ${step.type.sel} = "${step.type.value}"`); }
      else if (step.press != null) { await page.locator(step.press.sel).first().press(step.press.key); await page.waitForTimeout(500); console.log(`\n${i}. PRESS ${step.press.key}`); }
      else if (step.select != null) { const l = page.locator(step.select.sel).first(); const o: any = step.select.index != null ? { index: step.select.index } : step.select.label != null ? { label: step.select.label } : { value: String(step.select.value) }; await l.selectOption(o); console.log(`\n${i}. SELECT ${step.select.sel} ${JSON.stringify(o)}`); }
      else if (step.selectByOption != null) { const l = page.locator(`select:has(option:text-is("${step.selectByOption.optionText}"))`).first(); const o: any = step.selectByOption.index != null ? { index: step.selectByOption.index } : step.selectByOption.value != null ? { value: String(step.selectByOption.value) } : { label: step.selectByOption.optionText }; await l.selectOption(o); console.log(`\n${i}. SELECTBYOPTION ~"${step.selectByOption.optionText}"`); }
      else if (step.selectContains != null) { const l = page.locator(`select:has(option:has-text("${step.selectContains.has}"))`).first(); const o: any = step.selectContains.index != null ? { index: step.selectContains.index } : step.selectContains.label != null ? { label: step.selectContains.label } : { value: String(step.selectContains.value) }; await l.selectOption(o); console.log(`\n${i}. SELECTCONTAINS has="${step.selectContains.has}" ${JSON.stringify(o)}`); }
      else if (step.selectLabel != null) { const l = page.getByLabel(step.selectLabel.label, { exact: false }).first(); const o: any = step.selectLabel.index != null ? { index: step.selectLabel.index } : step.selectLabel.value != null ? { value: String(step.selectLabel.value) } : { label: step.selectLabel.option }; await l.selectOption(o); console.log(`\n${i}. SELECTLABEL "${step.selectLabel.label}" ${JSON.stringify(o)}`); }
      else if (step.check != null) { await page.locator(step.check).first().check({ timeout: 8000 }); console.log(`\n${i}. CHECK ${step.check}`); }
      else if (step.uncheck != null) { await page.locator(step.uncheck).first().uncheck({ timeout: 8000 }); console.log(`\n${i}. UNCHECK ${step.uncheck}`); }
      else if (step.waitText != null) { await page.getByText(step.waitText, { exact: false }).first().waitFor({ state: "visible", timeout: 15000 }); console.log(`\n${i}. WAITTEXT "${step.waitText}" ✓`); }
      else if (step.waitMs != null) { await page.waitForTimeout(step.waitMs); console.log(`\n${i}. WAITMS ${step.waitMs}`); }
      else if (step.dump != null) { console.log(`\n${i}. DUMP:`); await richDump(page); }
      else if (step.screenshot != null) { const p = path.join(OUT, `${step.screenshot}.png`); await page.screenshot({ path: p, fullPage: true }); console.log(`\n${i}. SHOT ${p}`); }
      else if (step.capture != null) { const u = page.url(); const id = (u.match(UUID_RE) || [])[0] || ""; fs.appendFileSync(MANIFEST, JSON.stringify({ role, capture: step.capture, url: u, id }) + "\n"); console.log(`\n${i}. CAPTURE ${step.capture}: ${new URL(u).pathname} id=${id}`); }
      else if (step.assertText != null) { const ok = await page.getByText(step.assertText, { exact: false }).first().count(); console.log(`\n${i}. ASSERT "${step.assertText}" → ${ok ? "✓ PRESENT" : "✗ ABSENT"}`); }
      else if (step.assertNotText != null) { const ok = await page.getByText(step.assertNotText, { exact: false }).first().count(); console.log(`\n${i}. ASSERTNOT "${step.assertNotText}" → ${ok ? "✗ PRESENT(!)" : "✓ absent"}`); }
      else if (step.note != null) { console.log(`\n${i}. NOTE: ${step.note}`); }
      else console.log(`\n${i}. (unknown step ${key})`);
    } catch (e) {
      console.log(`\n${i}. ✗ ERROR on ${key}: ${String((e as Error).message).split("\n")[0].slice(0, 200)}`);
    }
    // surface any errors that occurred during this step
    const newErrs = errors.slice(errMark);
    if (newErrs.length) console.log(`   ⚠ ${newErrs.length} runtime issue(s): ${[...new Set(newErrs)].slice(0, 6).join(" ; ")}`);
  }
  await ctx.close();
  await browser.close();
  console.log(`\n=== DONE. total runtime issues captured: ${errors.length} ===`);
}
main().catch((e) => { console.error("qa-flow crashed:", e); process.exit(1); });
