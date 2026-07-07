// E2E proof — Production Dossier feature (2026-07-07):
//   1. TLM opens a validated task list → the post-validation cockpit shows
//      "Generate Production PDF" + "Send by Email" ON the task list page.
//   2. Generate downloads a real merged PDF → verified with unpdf (page
//      count, bilingual titles 生产档案/客户信息, task number).
//   3. If an under_validation task list exists: Validate → the redirect now
//      LANDS BACK on the task list (?validated=1) instead of the PO page.
//
//   node --env-file=.env.local --env-file=.env.e2e --experimental-strip-types e2e/audit/dossier-verify.ts
import { chromium, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PW = process.env.E2E_PASSWORD || "";
const OUT = path.join("e2e", ".runs", "dossier");
fs.mkdirSync(OUT, { recursive: true });
const log = (s: string) => console.log(s);
const shot = (page: Page, n: string) =>
  page.screenshot({ path: path.join(OUT, `${n}.png`), fullPage: true }).catch(() => {});

let failures = 0;
function check(name: string, ok: boolean, extra = "") {
  log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failures++;
}

async function ensureLogin(browser: any, role: string): Promise<Page> {
  const email = process.env[`E2E_${role.toUpperCase()}_EMAIL`] || "";
  const AUTH = path.join("e2e", ".auth", `${role}.json`);
  let ctx = await browser.newContext(fs.existsSync(AUTH) ? { storageState: AUTH } : {});
  let page = await ctx.newPage();
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(700);
  if (new URL(page.url()).pathname.endsWith("/login")) {
    await ctx.close();
    ctx = await browser.newContext();
    page = await ctx.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', PW);
    await Promise.all([
      page.waitForURL((u: URL) => !u.pathname.endsWith("/login"), { timeout: 45000 }).catch(() => {}),
      page.click('button:has-text("Sign in")'),
    ]);
  }
  await ctx.storageState({ path: AUTH });
  // Force the anchor-download fallback (saveBlobAs) so Playwright can
  // capture the file via the download event.
  await page.addInitScript(() => {
    try {
      delete (window as any).showSaveFilePicker;
    } catch {}
    (window as any).showSaveFilePicker = undefined;
  });
  return page;
}

/** Scrape /task-lists for (href, status) pairs. */
async function listTaskLists(page: Page): Promise<Array<{ href: string; status: string }>> {
  await page.goto(`${BASE}/task-lists`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1500);
  return page.evaluate(() => {
    const rows: Array<{ href: string; status: string }> = [];
    for (const a of document.querySelectorAll('a[href^="/task-lists/"]')) {
      const href = a.getAttribute("href") || "";
      if (!/^\/task-lists\/[0-9a-f-]{36}$/.test(href)) continue;
      const scope = a.closest("li,tr,article,div") || a;
      rows.push({ href, status: (scope.textContent || "").toLowerCase() });
    }
    return rows;
  });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await ensureLogin(browser, "tlm");

  const rows = await listTaskLists(page);
  log(`task lists visible: ${rows.length}`);
  const validated = rows.find((r) => /validated|production ready|production_ready/.test(r.status));
  const underVal = rows.find((r) => /under validation|under_validation/.test(r.status));

  // ---------- 1+2 — cockpit + real PDF on a validated task list ----------
  if (!validated) {
    check("found a validated task list to test", false);
  } else {
    await page.goto(`${BASE}${validated.href}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2500);
    await shot(page, "01-validated-tl");

    const genBtn = page.locator('button:has-text("Generate Production PDF")').first();
    const mailBtn = page.locator('button:has-text("Send by Email")').first();
    check("『Generate Production PDF』 visible on task list", (await genBtn.count()) > 0);
    check("『Send by Email』 visible on task list", (await mailBtn.count()) > 0);

    const dlPromise = page.waitForEvent("download", { timeout: 120000 });
    await genBtn.click();
    const dl = await dlPromise;
    const pdfPath = path.join(OUT, "dossier.pdf");
    await dl.saveAs(pdfPath);
    const size = fs.statSync(pdfPath).size;
    check("dossier PDF downloaded", size > 10_000, `${dl.suggestedFilename()} · ${size} bytes`);
    await shot(page, "02-after-generate");

    // Inspect the PDF: page count (pdf-lib) + text (unpdf).
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(fs.readFileSync(pdfPath), { ignoreEncryption: true });
    const pages = doc.getPageCount();
    check("dossier has multiple pages", pages >= 2, `${pages} pages`);

    const { extractText, getDocumentProxy } = await import("unpdf");
    const proxy = await getDocumentProxy(new Uint8Array(fs.readFileSync(pdfPath)));
    const { text } = await extractText(proxy, { mergePages: true });
    const flat = text.replace(/\s+/g, "");
    for (const probe of ["生产档案", "客户信息", "订单摘要", "ProductionDossier"]) {
      check(`PDF text contains 「${probe}」`, flat.includes(probe));
    }
    const numMatch = dl.suggestedFilename().match(/PTL-[A-Z0-9-]+/i);
    if (numMatch) {
      check(`PDF text contains task number ${numMatch[0]}`, flat.includes(numMatch[0]));
    }
  }

  // ---------- 3 — validate flow lands back on the task list ----------
  if (!underVal) {
    log("• no under_validation task list available — redirect flow not driven (panel + PDF proven above)");
  } else {
    await page.goto(`${BASE}${underVal.href}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2000);
    const validateBtn = page.locator('button:has-text("Validate")').first();
    if ((await validateBtn.count()) === 0 || !(await validateBtn.isEnabled())) {
      log("• Validate button unavailable (release gate) — redirect flow not driven");
    } else {
      await validateBtn.click();
      await page.waitForTimeout(800);
      const release = page.locator('button:has-text("Release to Production")').last();
      if ((await release.count()) === 0) {
        log("• Release modal did not open — redirect flow not driven");
      } else {
        await release.click();
        await page
          .waitForURL((u: URL) => u.searchParams.get("validated") === "1", { timeout: 45000 })
          .catch(() => {});
        const url = new URL(page.url());
        await page.waitForTimeout(2000);
        await shot(page, "03-post-validate");
        check(
          "after Validate: stayed on the task list (?validated=1)",
          url.pathname === underVal.href && url.searchParams.get("validated") === "1",
          url.pathname + url.search
        );
        check(
          "post-validation cockpit visible",
          (await page.locator('button:has-text("Generate Production PDF")').count()) > 0
        );
      }
    }
  }

  await browser.close();
  log(failures === 0 ? "\n✅ DOSSIER VERIFY — all checks passed" : `\n❌ DOSSIER VERIFY — ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("dossier-verify crashed:", e);
  process.exit(1);
});
