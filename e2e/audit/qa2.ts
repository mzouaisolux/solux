// =====================================================================
// qa2.ts — Enhanced real-session UX-audit driver (Playwright, true JWT).
// Superset of drive.ts: every snapshot captures form LABELS, required
// markers, select options, button disabled-state, alerts/toasts, and a
// truncated main-text dump (for "does the user see a reminder?" checks).
// Writes a JSON transcript + per-step screenshots to <outDir> so the
// auditing agent can read exact UI state back.
//   node --env-file=.env.e2e --experimental-strip-types \
//     e2e/audit/qa2.ts <role> <stepsFile.json> <outDir>
//
// Steps: same DSL as drive.ts plus richer `snapshot`.
//   {"goto":"/path"} {"clickText":"x"} {"click":"css"} {"fill":{"sel","value"}}
//   {"fillPlaceholder":{"ph","value"}} {"fillLabel":{"label","value"}}
//   {"select":{"sel","value|index|label"}} {"selectByOption":{"optionText","index|value"}}
//   {"selectLabel":{"label","index|label|value"}}  // select found by its field label
//   {"check":"css"} {"clickNth":{"sel","n"}} {"waitText":"x"} {"waitMs":n}
//   {"snapshot":true} {"screenshot":"name"} {"capture":"label"} {"readStatus":true}
//   {"assertText":"x"} {"assertNotText":"x"} {"note":"free text into transcript"}
// =====================================================================
import { chromium, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PASSWORD = process.env.E2E_PASSWORD || "";
const role = (process.argv[2] || "").toLowerCase();
const stepsFile = process.argv[3];
const outDir = process.argv[4] || path.join("e2e", ".runs", `qa2-${role}`);
const EMAIL_ENV: Record<string, string> = { director: "E2E_DIR_EMAIL" };
const email = process.env[EMAIL_ENV[role] || `E2E_${role.toUpperCase()}_EMAIL`] || "";
const AUTH = path.join("e2e", ".auth", `${role}.json`);
fs.mkdirSync(outDir, { recursive: true });
const MANIFEST = path.join(outDir, "manifest.jsonl");
const TRANSCRIPT = path.join(outDir, "transcript.json");
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const transcript: any[] = [];
let shotN = 0;

async function ensureLogin(browser: any): Promise<{ ctx: any; page: Page }> {
  let ctx = await browser.newContext(fs.existsSync(AUTH) ? { storageState: AUTH } : {});
  let page = await ctx.newPage();
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(600);
  if (new URL(page.url()).pathname.endsWith("/login")) {
    await ctx.close();
    ctx = await browser.newContext(); page = await ctx.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', PASSWORD);
    await Promise.all([
      page.waitForURL((u: URL) => !u.pathname.endsWith("/login"), { timeout: 60000 }).catch(() => {}),
      page.click('button:has-text("Sign in")'),
    ]);
    await page.waitForTimeout(800);
  }
  await ctx.storageState({ path: AUTH });
  return { ctx, page };
}

async function richSnapshot(page: Page): Promise<any> {
  return page.evaluate(() => {
    const clean = (s: string | null | undefined) => (s || "").trim().replace(/\s+/g, " ");
    const t = (e: Element | null) => clean(e?.textContent);
    const pageMain = (document.querySelector("main") as HTMLElement) || document.body;
    // Detect an open modal/drawer overlay (rendered in a portal outside <main>).
    const overlay = [...document.querySelectorAll(
      '[role="dialog"],[aria-modal="true"],[class*="modal"],[class*="Modal"],[class*="drawer"],[class*="Drawer"],[class*="Dialog"],[class*="sheet"],[class*="Sheet"]'
    )].find((e) => {
      const r = (e as HTMLElement).getBoundingClientRect();
      return r.width > 200 && r.height > 120 && e.querySelector("input,select,textarea,button");
    }) as HTMLElement | undefined;
    const main = overlay || pageMain;
    const dialogOpen = !!overlay;

    const labelFor = (el: HTMLElement): string => {
      const aria = el.getAttribute("aria-label");
      if (aria) return clean(aria);
      const lb = el.getAttribute("aria-labelledby");
      if (lb) { const r = lb.split(/\s+/).map((id) => t(document.getElementById(id))).filter(Boolean).join(" "); if (r) return r; }
      const id = (el as HTMLInputElement).id;
      if (id) { const l = document.querySelector(`label[for="${CSS.escape(id)}"]`); if (l) return t(l); }
      const wrap = el.closest("label"); if (wrap) return clean(wrap.textContent);
      // nearest preceding label-ish text within same field container
      let p: Element | null = el.parentElement;
      for (let i = 0; i < 3 && p; i++) {
        const lab = p.querySelector("label, .label, [class*='label']");
        if (lab && lab !== el) return t(lab);
        p = p.parentElement;
      }
      return "";
    };

    const isRequired = (el: HTMLElement): boolean => {
      if ((el as HTMLInputElement).required) return true;
      if (el.getAttribute("aria-required") === "true") return true;
      const lbl = labelFor(el);
      return /\*|\brequired\b|\bobligatoire\b/i.test(lbl);
    };

    const fieldEls = [...main.querySelectorAll("input,select,textarea")] as HTMLElement[];
    const fields = fieldEls.filter((f) => (f as HTMLInputElement).type !== "hidden").slice(0, 60).map((f) => {
      const e = f as HTMLInputElement;
      const base: any = {
        tag: e.tagName.toLowerCase(),
        type: e.type || "",
        name: e.name || "",
        label: labelFor(e),
        required: isRequired(e),
        placeholder: e.placeholder || "",
        value: e.value ? String(e.value).slice(0, 40) : "",
        disabled: (e as HTMLInputElement).disabled || e.getAttribute("aria-disabled") === "true",
      };
      if (e.tagName.toLowerCase() === "select") {
        base.options = [...(e as unknown as HTMLSelectElement).options].map((o) => clean(o.textContent)).slice(0, 25);
      }
      return base;
    });

    const buttons = [...main.querySelectorAll('button,[role="button"],input[type="submit"],a[class*="btn"]')].map((b) => {
      const el = b as HTMLButtonElement;
      const label = clean(el.textContent) || el.value || "";
      return label ? { label, disabled: el.disabled || el.getAttribute("aria-disabled") === "true" } : null;
    }).filter(Boolean).filter((v, i, a) => a.findIndex((x) => x!.label === v!.label) === i).slice(0, 60);

    const headings = [...main.querySelectorAll("h1,h2,h3")].map(t).filter(Boolean).slice(0, 30);

    // alerts / toasts / errors / required-warnings anywhere on page
    const alertSel = '[role="alert"],[aria-live],[class*="toast"],[class*="alert"],[class*="error"],[class*="flash"],[class*="warning"],[class*="banner"]';
    const alerts = [...new Set([...document.querySelectorAll(alertSel)].map(t).filter((s) => s && s.length < 300))].slice(0, 20);

    const links = [...new Set([...main.querySelectorAll("a[href]")].map((a) => {
      const h = (a as HTMLAnchorElement).getAttribute("href") || "";
      return h.startsWith("/") ? `${h} «${t(a)}»` : "";
    }).filter(Boolean))].slice(0, 40);

    const tables = [...main.querySelectorAll("table")].map((tb) => ({
      headers: [...tb.querySelectorAll("thead th")].map(t),
      rows: tb.querySelectorAll("tbody tr").length,
    }));

    const mainText = clean(main.innerText).slice(0, 6000);

    // Raw button list in DOM order (NOT deduped) — needed to target repeated
    // buttons like per-row "Save · Order only" precisely by index.
    const buttonsRaw = [...main.querySelectorAll('button,[role="button"],input[type="submit"]')]
      .map((b, i) => `${i}:${clean((b as HTMLButtonElement).textContent) || (b as HTMLInputElement).value}`)
      .filter((s) => s.split(":").slice(1).join(":")).slice(0, 120);

    return { url: location.pathname + location.search, dialogOpen, headings, fields, buttons, buttonsRaw, alerts, links, tables, mainText };
  });
}

function printSnap(i: number, d: any) {
  console.log(`\n── SNAPSHOT @ ${d.url}${d.dialogOpen ? " [MODAL/DRAWER OPEN]" : ""}`);
  if (d.headings.length) console.log(`H: ${d.headings.join(" | ")}`);
  if (d.alerts.length) console.log(`⚠ ALERTS: ${d.alerts.join("  ┃  ")}`);
  for (const f of d.fields) {
    const req = f.required ? " *REQ" : "";
    const dis = f.disabled ? " [disabled]" : "";
    const opts = f.options ? ` opts={${f.options.join(", ")}}` : "";
    const val = f.value ? ` val="${f.value}"` : "";
    console.log(`  · ${f.tag}[${f.type}] label="${f.label}" ph="${f.placeholder}"${req}${dis}${val}${opts}`);
  }
  const btns = d.buttons.map((b: any) => (b.disabled ? `${b.label}⊘` : b.label));
  if (btns.length) console.log(`B: ${btns.join(" | ")}`);
  if (d.links.length) console.log(`L: ${d.links.join("  ")}`);
  for (const tb of d.tables) console.log(`T[${tb.headers.join("|")}] rows=${tb.rows}`);
  if (d.mainText) console.log(`TXT: ${d.mainText}`);
}

async function statusWord(page: Page): Promise<string> {
  return page.evaluate(() => {
    const m = (document.querySelector("main") as HTMLElement)?.innerText || "";
    for (const s of ["Needs revision", "Needs modification", "Under validation", "Awaiting", "Pending",
      "Ready for pricing", "Priced", "Production ready", "Validated", "Approved", "Rejected",
      "Submitted", "Draft", "Cancelled", "Won", "Lost", "Sent", "Deposit received", "In production", "Completed"])
      if (m.includes(s)) return s;
    return "(none)";
  });
}

async function shot(page: Page, name: string) {
  shotN++;
  const file = path.join(outDir, `${String(shotN).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true }).catch(() => {});
  return file;
}

async function main(): Promise<void> {
  if (!role || !stepsFile) { console.error("usage: qa2.ts <role> <stepsFile> <outDir>"); process.exit(1); }
  const steps = JSON.parse(fs.readFileSync(stepsFile, "utf8")) as any[];
  const browser = await chromium.launch({ headless: true });
  const { ctx, page } = await ensureLogin(browser);
  // Auto-accept native confirm()/alert() dialogs (e.g. "Mark Won" confirmation),
  // and record their message text — the wording is itself a UX artifact.
  page.on("dialog", async (d) => {
    transcript.push({ dialog: { type: d.type(), message: d.message() } });
    console.log(`   [dialog:${d.type()}] "${d.message()}" → accept`);
    await d.accept().catch(() => {});
  });
  console.log(`\n=== QA2 ${role} (${email}) · ${steps.length} steps · out=${outDir} ===`);
  let i = 0;
  let lastStatus = 0;
  for (const step of steps) {
    i++;
    const key = Object.keys(step)[0];
    const rec: any = { i, step };
    try {
      if (step.goto) {
        let r = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          try { r = await page.goto(`${BASE}${step.goto}`, { waitUntil: "domcontentloaded", timeout: 60000 }); break; }
          catch (e) { if (attempt === 1) throw e; await page.waitForTimeout(1500); }
        }
        await page.waitForTimeout(1000);
        lastStatus = r?.status() || 0;
        rec.result = `goto ${step.goto} → ${new URL(page.url()).pathname} [${lastStatus}]`;
      }
      else if (step.clickText) { await page.getByRole("button", { name: step.clickText, exact: false }).first().or(page.getByRole("link", { name: step.clickText, exact: false }).first()).click({ timeout: 12000 }); await page.waitForTimeout(1000); rec.result = `clickText "${step.clickText}" → ${new URL(page.url()).pathname}`; }
      else if (step.click) { await page.locator(step.click).first().click({ timeout: 12000 }); await page.waitForTimeout(900); rec.result = `click ${step.click} → ${new URL(page.url()).pathname}`; }
      else if (step.clickNth) { await page.locator(step.clickNth.sel).nth(step.clickNth.n).click({ timeout: 12000 }); await page.waitForTimeout(900); rec.result = `clickNth ${step.clickNth.sel}#${step.clickNth.n}`; }
      else if (step.fill) { await page.locator(step.fill.sel).first().fill(String(step.fill.value), { timeout: 12000 }); rec.result = `fill ${step.fill.sel} = "${step.fill.value}"`; }
      else if (step.fillNth) { await page.locator(step.fillNth.sel).nth(step.fillNth.n).fill(String(step.fillNth.value), { timeout: 12000 }); rec.result = `fillNth ${step.fillNth.sel}#${step.fillNth.n} = "${step.fillNth.value}"`; }
      else if (step.typeSaveByAnchor) {
        // Real char-by-char typing (fires keydown/keyup/input so React commits state),
        // then blur, then click the row's save button. Fixes fill()-not-persisting.
        const ta = page.locator(`xpath=(//*[contains(normalize-space(.),"${step.typeSaveByAnchor.anchor}")])[last()]/following::textarea[1]`).first();
        await ta.click({ timeout: 12000 });
        await ta.fill("");
        await ta.pressSequentially(String(step.typeSaveByAnchor.value), { delay: 8 });
        await ta.blur().catch(() => {});
        await page.waitForTimeout(400);
        await ta.locator(`xpath=following::button[contains(normalize-space(.),"${step.typeSaveByAnchor.scope}")][1]`).click({ timeout: 12000 });
        await page.waitForTimeout(2500);
        rec.result = `typeSaveByAnchor "${step.typeSaveByAnchor.anchor}" [${step.typeSaveByAnchor.scope}]`;
      }
      else if (step.saveByAnchor) {
        // Anchor on a unique field-label text, target the textarea that follows it,
        // fill it, then click the first following button containing `scope`.
        const ta = page.locator(`xpath=(//*[contains(normalize-space(.),"${step.saveByAnchor.anchor}")])[last()]/following::textarea[1]`).first();
        await ta.fill(String(step.saveByAnchor.value), { timeout: 12000 });
        await page.waitForTimeout(300);
        await ta.locator(`xpath=following::button[contains(normalize-space(.),"${step.saveByAnchor.scope}")][1]`).click({ timeout: 12000 });
        await page.waitForTimeout(1200);
        rec.result = `saveByAnchor "${step.saveByAnchor.anchor}" [${step.saveByAnchor.scope}]`;
      }
      else if (step.saveAfterPlaceholder) {
        // Fill the textarea matched by placeholder, then click the FIRST button after it
        // (in document order) whose text contains `scope` — i.e. that row's save button.
        const ta = page.getByPlaceholder(step.saveAfterPlaceholder.ph, { exact: false }).first();
        await ta.fill(String(step.saveAfterPlaceholder.value), { timeout: 12000 });
        await page.waitForTimeout(300);
        await ta.locator(`xpath=following::button[contains(normalize-space(.),"${step.saveAfterPlaceholder.scope}")][1]`).click({ timeout: 12000 });
        await page.waitForTimeout(1200);
        rec.result = `saveAfterPlaceholder "${step.saveAfterPlaceholder.ph}" [${step.saveAfterPlaceholder.scope}]`;
      }
      else if (step.factorySave) {
        // Locate the innermost factory-field row (contains the label text AND a textarea),
        // fill its textarea, then click its scope button ("Save · Order only" / "Save · For client").
        const row = page.locator(`:is(div,li,section):has-text("${step.factorySave.label}")`).filter({ has: page.locator("textarea") }).last();
        await row.locator("textarea").first().fill(String(step.factorySave.value), { timeout: 12000 });
        await page.waitForTimeout(300);
        await row.getByRole("button", { name: step.factorySave.scope, exact: false }).first().click({ timeout: 12000 });
        await page.waitForTimeout(1200);
        rec.result = `factorySave "${step.factorySave.label}" [${step.factorySave.scope}]`;
      }
      else if (step.fillPlaceholder) { await page.getByPlaceholder(step.fillPlaceholder.ph, { exact: false }).first().fill(String(step.fillPlaceholder.value)); rec.result = `fillPlaceholder "${step.fillPlaceholder.ph}"`; }
      else if (step.fillPlaceholderNth) { await page.getByPlaceholder(step.fillPlaceholderNth.ph, { exact: false }).nth(step.fillPlaceholderNth.n).fill(String(step.fillPlaceholderNth.value)); rec.result = `fillPlaceholderNth "${step.fillPlaceholderNth.ph}"#${step.fillPlaceholderNth.n}`; }
      else if (step.fillLabel) { await page.getByLabel(step.fillLabel.label, { exact: false }).first().fill(String(step.fillLabel.value)); rec.result = `fillLabel "${step.fillLabel.label}"`; }
      else if (step.select) { const l = page.locator(step.select.sel).first(); const o: any = step.select.index != null ? { index: step.select.index } : step.select.label != null ? { label: step.select.label } : { value: String(step.select.value) }; await l.selectOption(o); rec.result = `select ${step.select.sel} ${JSON.stringify(o)}`; }
      else if (step.selectLabel) { const l = page.getByLabel(step.selectLabel.label, { exact: false }).first(); const o: any = step.selectLabel.index != null ? { index: step.selectLabel.index } : step.selectLabel.label2 != null ? { label: step.selectLabel.label2 } : { value: String(step.selectLabel.value) }; await l.selectOption(o); rec.result = `selectLabel "${step.selectLabel.label}"`; }
      else if (step.selectByOption) { const l = page.locator(`select:has(option:text-is("${step.selectByOption.optionText}"))`).first(); const o: any = step.selectByOption.index != null ? { index: step.selectByOption.index } : step.selectByOption.value != null ? { value: String(step.selectByOption.value) } : { label: step.selectByOption.optionText }; await l.selectOption(o); rec.result = `selectByOption ~"${step.selectByOption.optionText}"`; }
      else if (step.check) { await page.locator(step.check).first().check({ timeout: 12000 }); rec.result = `check ${step.check}`; }
      else if (step.checkLabel) { await page.getByLabel(step.checkLabel, { exact: false }).first().check({ timeout: 12000 }); rec.result = `checkLabel "${step.checkLabel}"`; }
      else if (step.uncheckLabel) { await page.getByLabel(step.uncheckLabel, { exact: false }).first().uncheck({ timeout: 12000 }); rec.result = `uncheckLabel "${step.uncheckLabel}"`; }
      else if (step.clickLabelText) { await page.locator(`label:has-text("${step.clickLabelText}")`).first().click({ timeout: 12000 }); await page.waitForTimeout(400); rec.result = `clickLabelText "${step.clickLabelText}"`; }
      else if (step.waitText) { await page.getByText(step.waitText, { exact: false }).first().waitFor({ state: "visible", timeout: 15000 }); rec.result = `waitText "${step.waitText}" ✓`; }
      else if (step.waitMs != null) { await page.waitForTimeout(step.waitMs); rec.result = `waitMs ${step.waitMs}`; }
      else if (step.snapshot) { const d = await richSnapshot(page); rec.snapshot = d; printSnap(i, d); rec.result = `snapshot @ ${d.url}`; }
      else if (step.screenshot) { const f = await shot(page, step.screenshot); rec.result = `screenshot ${path.basename(f)}`; }
      else if (step.capture) { const u = page.url(); const id = (u.match(UUID_RE) || [])[0] || ""; fs.appendFileSync(MANIFEST, JSON.stringify({ role, capture: step.capture, url: u, id }) + "\n"); rec.result = `capture ${step.capture}: ${new URL(u).pathname} id=${id}`; rec.captured = { url: u, id }; }
      else if (step.readStatus) { const s = await statusWord(page); rec.result = `status → ${s}`; }
      else if (step.assertText) { const ok = await page.getByText(step.assertText, { exact: false }).first().count(); rec.result = `assertText "${step.assertText}" → ${ok ? "PRESENT" : "ABSENT"}`; }
      else if (step.assertNotText) { const ok = await page.getByText(step.assertNotText, { exact: false }).first().count(); rec.result = `assertNotText "${step.assertNotText}" → ${ok ? "PRESENT(!)" : "absent"}`; }
      else if (step.note) { rec.result = `NOTE: ${step.note}`; }
      else rec.result = `(unknown step ${key})`;
      console.log(`${i}. ${rec.result}`);
    } catch (e) {
      rec.error = String((e as Error).message).split("\n")[0].slice(0, 200);
      console.log(`${i}. ✗ ERROR on ${key}: ${rec.error}`);
      // auto-capture on error for diagnosis
      await shot(page, `error-step${i}`);
    }
    transcript.push(rec);
  }
  fs.writeFileSync(TRANSCRIPT, JSON.stringify(transcript, null, 2));
  await ctx.close();
  await browser.close();
  console.log(`\n=== done. transcript: ${TRANSCRIPT} ===`);
}
main().catch((e) => { console.error("qa2 crashed:", e); process.exit(1); });
