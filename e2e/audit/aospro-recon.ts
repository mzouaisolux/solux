// Recon: dump the quotation builder + AOSPRO+ product config DOM so we can
// script option filling precisely. Read-only (never saves the draft).
//   node --env-file=.env.local --env-file=.env.e2e --experimental-strip-types e2e/audit/aospro-recon.ts
import { chromium, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PW = process.env.E2E_PASSWORD || "";
const ZEA = "42ebf688-5b40-455d-9b6f-4b4dd6a8a40d"; // existing test client
const OUT = path.join("e2e", ".runs", "aospro");
fs.mkdirSync(OUT, { recursive: true });

async function ensureLogin(browser: any, role: string): Promise<Page> {
  const email = process.env[`E2E_${role.toUpperCase()}_EMAIL`] || "";
  const AUTH = path.join("e2e", ".auth", `${role}.json`);
  let ctx = await browser.newContext(fs.existsSync(AUTH) ? { storageState: AUTH } : {});
  let page = await ctx.newPage();
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(600);
  if (new URL(page.url()).pathname.endsWith("/login")) {
    await ctx.close();
    ctx = await browser.newContext(); page = await ctx.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', PW);
    await Promise.all([
      page.waitForURL((u: URL) => !u.pathname.endsWith("/login"), { timeout: 45000 }).catch(() => {}),
      page.click('button:has-text("Sign in")'),
    ]);
  }
  await ctx.storageState({ path: AUTH });
  return page;
}

async function dump(page: Page, label: string) {
  const d = await page.evaluate(() => {
    const t = (e: Element | null) => (e?.textContent || "").trim().replace(/\s+/g, " ");
    const sel = (e: Element) => {
      const el = e as HTMLElement;
      const id = el.id ? `#${el.id}` : "";
      const tid = el.getAttribute("data-testid");
      const nm = (el as HTMLInputElement).name;
      return `${el.tagName.toLowerCase()}${id}${tid ? `[data-testid=${tid}]` : ""}${nm ? `[name=${nm}]` : ""}`;
    };
    const main = document.querySelector("main") || document.body;
    const selects = [...main.querySelectorAll("select")].map((s) => ({
      sel: sel(s), name: (s as HTMLSelectElement).name,
      options: [...s.querySelectorAll("option")].map((o) => (o.textContent || "").trim()).slice(0, 30),
    }));
    const inputs = [...main.querySelectorAll("input,textarea")].map((i) => {
      const e = i as HTMLInputElement;
      return `${sel(e)} type=${e.type || "textarea"} ph="${e.placeholder || ""}" val="${String(e.value || "").slice(0, 24)}" ${e.checked ? "CHECKED" : ""}`;
    });
    // Checkbox-group option labels (checkbox + nearby text).
    const checkboxes = [...main.querySelectorAll('input[type=checkbox]')].map((c) => {
      const lab = (c.closest("label") || c.parentElement)?.textContent?.trim().replace(/\s+/g, " ") || "";
      return `${sel(c)} label="${lab.slice(0, 40)}" ${(c as HTMLInputElement).checked ? "CHECKED" : ""}`;
    });
    const root = document.querySelector('[role=dialog]') ? document.body : main; // include modal
    const buttons = [...new Set([...root.querySelectorAll('button,[role=button],a[href]')].map((b) => t(b)).filter(Boolean))].slice(0, 90);
    const combos = [...root.querySelectorAll('[role=combobox],[aria-haspopup],[cmdk-input]')].map((c) => `${sel(c)} «${t(c).slice(0,30)}»`).slice(0, 20);
    // Anything mentioning AOSPRO — how products are listed in the picker.
    const aos = [...root.querySelectorAll("*")].filter((e) => {
      const txt = (e.textContent || "").trim();
      return /AOSPRO\+?\d/.test(txt) && txt.length < 44 && e.children.length <= 1;
    }).map((e) => `${sel(e)} «${t(e)}»`).slice(0, 30);
    // Field labels near config controls.
    const labels = [...root.querySelectorAll("label,legend,h3,h4")].map((l) => t(l)).filter(Boolean).slice(0, 70);
    return { selects, inputs, checkboxes, buttons, aos, labels, combos };
  });
  const lines: string[] = [];
  lines.push(`\n########## DUMP: ${label} :: ${page.url()}`);
  lines.push(`--- SELECTS (${d.selects.length}) ---`);
  for (const s of d.selects) lines.push(`  ${s.sel}  options=[${s.options.join(" | ")}]`);
  lines.push(`--- INPUTS/TEXTAREAS (${d.inputs.length}) ---`);
  for (const i of d.inputs) lines.push(`  ${i}`);
  lines.push(`--- CHECKBOXES (${d.checkboxes.length}) ---`);
  for (const c of d.checkboxes) lines.push(`  ${c}`);
  lines.push(`--- COMBOBOXES (${d.combos.length}) ---`);
  for (const c of d.combos) lines.push(`  ${c}`);
  lines.push(`--- AOSPRO ELEMENTS (${d.aos.length}) ---`);
  for (const a of d.aos) lines.push(`  ${a}`);
  lines.push(`--- LABELS/HEADINGS (${d.labels.length}) ---`);
  lines.push(`  ${d.labels.join(" | ")}`);
  lines.push(`--- BUTTONS/LINKS (${d.buttons.length}) ---`);
  lines.push(`  ${d.buttons.join(" | ")}`);
  const out = lines.join("\n");
  console.log(out);
  fs.appendFileSync(path.join(OUT, "recon.log"), out + "\n");
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await ensureLogin(browser, "sales");
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message.slice(0, 200)));

  console.log("== goto /documents/new ==");
  const r = await page.goto(`${BASE}/documents/new?client=${ZEA}`, { waitUntil: "domcontentloaded", timeout: 45000 });
  console.log("status", r?.status());
  await page.waitForTimeout(1500);
  await page.getByText("New quotation", { exact: false }).first().waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  await dump(page, "01-new-quotation-initial");
  await page.screenshot({ path: path.join(OUT, "01-initial.png"), fullPage: true });

  // Open the catalogue product picker.
  try {
    await page.getByRole("button", { name: "+ Add Catalogue Product", exact: false }).first().click({ timeout: 8000 });
    console.log("clicked + Add Catalogue Product");
    await page.waitForTimeout(1500);
  } catch (e) { console.log("add-catalogue err:", String((e as Error).message).split("\n")[0]); }
  await dump(page, "02-product-picker");
  await page.screenshot({ path: path.join(OUT, "02-picker.png"), fullPage: true });

  // In the picker, try typing to search then click AOSPRO+60.
  try {
    const search = page.locator('input[type=search],input[placeholder*="earch" i],[cmdk-input]').first();
    if (await search.count()) { await search.fill("AOSPRO+60"); console.log("typed search AOSPRO+60"); await page.waitForTimeout(900); }
  } catch (e) { console.log("search err:", String((e as Error).message).split("\n")[0]); }
  await dump(page, "03-picker-searched");
  await page.screenshot({ path: path.join(OUT, "03-picker-searched.png"), fullPage: true });

  // Click the exact AOSPRO+60 (avoid IoT sibling).
  let added = false;
  for (const name of ["AOSPRO+60", "AOSPRO+30"]) {
    try {
      const btn = page.getByText(name, { exact: true }).first();
      if (await btn.count()) { await btn.click({ timeout: 8000 }); console.log(`clicked product ${name}`); added = true; break; }
    } catch (e) { console.log(`click ${name} err:`, String((e as Error).message).split("\n")[0]); }
  }
  if (!added) console.log("!! could not add a product by exact text");
  await page.waitForTimeout(2500);
  await dump(page, "04-after-product-added");
  await page.screenshot({ path: path.join(OUT, "04-added.png"), fullPage: true });

  // Open the per-line configurator.
  try {
    await page.getByRole("button", { name: "Configure now", exact: false }).first().click({ timeout: 8000 });
    console.log("clicked Configure now");
    await page.waitForTimeout(1800);
  } catch (e) { console.log("configure err:", String((e as Error).message).split("\n")[0]); }
  await dump(page, "05-configurator-open");
  await page.screenshot({ path: path.join(OUT, "05-configurator.png"), fullPage: true });

  // Dump each config select's options + surrounding label precisely.
  const cfg = await page.evaluate(() => {
    const t = (e: Element | null) => (e?.textContent || "").trim().replace(/\s+/g, " ");
    const root = document.querySelector('[role=dialog]') || document.querySelector("main") || document.body;
    const fieldSelects = [...root.querySelectorAll("select")].map((s) => {
      const wrap = s.closest("div,fieldset,label");
      const lab = wrap?.querySelector("label,span,legend");
      return { label: t(lab).slice(0, 40), options: [...s.querySelectorAll("option")].map((o) => (o.textContent || "").trim()) };
    });
    const groups = [...root.querySelectorAll('input[type=checkbox]')].map((c) => {
      const lab = (c.closest("label") || c.parentElement)?.textContent?.trim().replace(/\s+/g, " ") || "";
      return lab.slice(0, 40);
    });
    const numberInputs = [...root.querySelectorAll('input[type=number],input[inputmode=numeric]')].map((i) => {
      const e = i as HTMLInputElement; const wrap = e.closest("div,label"); const lab = wrap?.querySelector("label,span");
      return `label="${t(lab).slice(0,30)}" val=${e.value}`;
    });
    return { fieldSelects, groups, numberInputs };
  });
  console.log("\n== CONFIGURATOR FIELDS ==");
  for (const f of cfg.fieldSelects) console.log(`  SELECT [${f.label}] -> ${f.options.join(" | ")}`);
  console.log("  CHECKBOX LABELS:", cfg.groups.join(" | "));
  console.log("  NUMBER INPUTS:", cfg.numberInputs.join("  ||  "));

  // Look for a quantity input + config controls specifically.
  console.log("\n== CONSOLE ERRORS (" + errors.length + ") ==");
  for (const e of errors.slice(0, 20)) console.log("  " + e);

  await browser.close();
}
main().catch((e) => { console.error("recon crashed:", e); process.exit(1); });
