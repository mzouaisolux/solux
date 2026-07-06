// TLM: add Chinese notes to the task list, then validate/release to production.
//   node --env-file=.env.local --env-file=.env.e2e --experimental-strip-types e2e/audit/aospro-tlm-validate.ts
import { chromium, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";
const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PW = process.env.E2E_PASSWORD || "";
const OUT = path.join("e2e", ".runs", "aospro");
const TL = "43b9fca1-cdb3-42fa-9247-b4676854c965";
const NOTE_PROD = "备注：这是一个PDF中文字符测试";
const NOTE_TECH = "包装要求：纸箱包装，防水保护";
const log = (s: string) => console.log(s);
const shot = (page: Page, n: string) => page.screenshot({ path: path.join(OUT, `val-${n}.png`), fullPage: true }).catch(() => {});

async function ensureLogin(browser: any, role: string): Promise<Page> {
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
  return page;
}
const buttons = (page: Page) => page.evaluate(() => [...new Set([...(document.querySelector("main") || document.body).querySelectorAll('button,[role=button]')].map((b) => (b.textContent || "").trim().replace(/\s+/g, " ")).filter(Boolean))].slice(0, 50));

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await ensureLogin(browser, "tlm");
  await page.goto(`${BASE}/task-lists/${TL}`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2500);
  await shot(page, "01-open");

  // Dump textareas to locate production / technical notes.
  const areas = await page.evaluate(() => [...document.querySelectorAll("textarea")].map((a, i) => {
    const e = a as HTMLTextAreaElement; const wrap = e.closest("div,label,section"); const lab = wrap?.querySelector("label,span,legend,h3,h4");
    return { i, ph: e.placeholder || "", label: (lab?.textContent || "").trim().replace(/\s+/g, " ").slice(0, 50), val: (e.value || "").slice(0, 20) };
  }));
  log("TEXTAREAS: " + JSON.stringify(areas));
  log("BUTTONS: " + (await buttons(page)).join(" | "));

  // Fill notes by matching label/placeholder keywords, then save header/section.
  async function fillNote(keywords: string[], value: string, tag: string) {
    for (const a of areas) {
      const hay = (a.label + " " + a.ph).toLowerCase();
      if (keywords.some((k) => hay.includes(k))) {
        const ta = page.locator("textarea").nth(a.i);
        await ta.fill(value).catch(() => {});
        log(`  filled ${tag} into textarea[${a.i}] (label="${a.label}")`);
        return true;
      }
    }
    log(`  (${tag}: no matching textarea)`); return false;
  }
  await fillNote(["production note", "production", "notes for", "instruction"], NOTE_PROD, "production_notes");
  await fillNote(["technical", "internal"], NOTE_TECH, "technical_notes");
  // Save any header/notes section.
  for (const t of ["Save header", "Save notes", "Save"]) {
    const b = page.locator(`button:has-text("${t}")`).first();
    if (await b.count()) { await b.click({ timeout: 5000 }).catch(() => {}); log(`clicked '${t}'`); await page.waitForTimeout(1500); break; }
  }
  await shot(page, "02-notes-saved");

  // VALIDATE / RELEASE.
  await page.goto(`${BASE}/task-lists/${TL}`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2000);
  log("pre-validate buttons: " + (await buttons(page)).join(" | "));
  let clicked = "";
  for (const t of ["Validate", "Release to production", "Release to Production", "Approve", "Mark validated"]) {
    const b = page.locator(`button:has-text("${t}")`).first();
    if (await b.count()) { await b.click({ timeout: 8000 }).catch(() => {}); clicked = t; log(`clicked '${t}'`); break; }
  }
  await page.waitForTimeout(1800);
  await shot(page, "03-validate-modal");
  log("modal buttons: " + (await buttons(page)).join(" | "));
  // Confirm in modal (custom modal, no role=dialog → use last matching).
  for (const t of ["Release to production", "Release to Production", "Validate", "Confirm", "Release", "Yes"]) {
    const b = page.getByRole("button", { name: t, exact: false }).last();
    if (await b.count()) { await b.click({ timeout: 5000 }).catch(() => {}); log(`confirmed via '${t}'`); break; }
  }
  await page.waitForTimeout(3500);
  await shot(page, "04-after-validate");
  await page.goto(`${BASE}/task-lists/${TL}`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1500);
  const body = await page.evaluate(() => (document.querySelector("main") || document.body).innerText);
  const status = ["Production ready", "Validated", "Under validation", "Needs revision", "Draft"].find((s) => body.includes(s)) || "(unknown)";
  log("post-validate status word: " + status);
  await shot(page, "05-final");
  await browser.close();
}
main().catch((e) => { console.error("tlm-validate crashed:", e); process.exit(1); });
